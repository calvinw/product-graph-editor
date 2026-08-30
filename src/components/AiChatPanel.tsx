import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUp, Download, GripVertical, KeyRound, MessageSquarePlus, Settings2, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createOpenRouterTransport, type ModelMessage } from "@/ai/chatTransport"
import {
  formatRemoteToolResult, mergeToolDefinitions, parseMcpToolArguments, remoteConfirmationSummary,
  requiresToolConfirmation,
} from "@/ai/mcpRegistry"
import {
  appToolDefinitions, confirmationSummary, executeAppTool, listViews, type AppToolRuntime, type ViewToolCall,
} from "@/ai/viewTools"
import { McpServerSettings } from "@/components/McpServerSettings"
import { useMcpServers } from "@/hooks/useMcpServers"

type MessageSegment =
  | { kind: "text"; id: string; content: string }
  | { kind: "tool"; id: string; name: string; output: unknown; error?: boolean }

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  segments: MessageSegment[]
  streaming?: boolean
}

/**
 * Drop a trailing tool round that never completed, so the transcript stays
 * valid for the next request.
 *
 * A provider rejects an assistant message carrying `tool_calls` unless every
 * call id is answered by a following `tool` message. An aborted turn can leave
 * exactly that, so trim the assistant message and its partial results.
 */
function repairTranscript(transcript: ModelMessage[]) {
  let index = transcript.length - 1
  while (index >= 0 && !(transcript[index].role === "assistant" && transcript[index].tool_calls?.length)) index -= 1
  if (index === -1) return
  const answered = new Set(transcript.slice(index + 1).filter((message) => message.role === "tool").map((message) => message.tool_call_id))
  if (transcript[index].tool_calls?.every((call) => answered.has(call.id))) return
  transcript.length = index
}

const MODELS = [
  "openai/gpt-5.6-luna",
  "google/gemini-3.7-flash",
  "google/gemini-3-flash-preview",
  "deepseek/deepseek-v4-flash-0731",
  "qwen/qwen3.7-flash",
  "openai/gpt-4o-mini",
] as const
const ENDPOINT = import.meta.env.VITE_OPENROUTER_ENDPOINT ?? "https://openrouter.ai/api/v1/chat/completions"
const MODEL_STORAGE = "product-graph-editor:chat-model"
const WIDTH_STORAGE = "product-graph-editor:chat-width"
const API_KEY_STORAGE = "product-graph-editor:chat-api-key"

function storedValue(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random()}`
}

function extractCellText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractCellText).join("")
  if (isValidElement(node)) return extractCellText((node.props as { children?: ReactNode }).children)
  return ""
}

function tableRows(children: ReactNode): string[][] {
  const rows: string[][] = []
  for (const section of Children.toArray(children)) {
    if (!isValidElement(section)) continue
    for (const row of Children.toArray((section.props as { children?: ReactNode }).children)) {
      if (!isValidElement(row)) continue
      rows.push(Children.toArray((row.props as { children?: ReactNode }).children)
        .filter(isValidElement)
        .map((cell) => extractCellText((cell.props as { children?: ReactNode }).children).trim()))
    }
  }
  return rows
}

function delimitedTable(rows: string[][], delimiter: string) {
  const escape = (value: string) => delimiter === ","
    ? /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    : value.replace(new RegExp(delimiter, "g"), " ")
  return rows.map((row) => row.map(escape).join(delimiter)).join("\n")
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  const rows = tableRows(children)
  return (
    <div className="ai-chat-table-wrap">
      <table className="ai-chat-table">{children}</table>
      <div className="ai-chat-table-actions">
        <Button variant="ghost" size="sm" type="button" onClick={() => downloadText("table.csv", delimitedTable(rows, ","), "text/csv")}><Download aria-hidden="true" />CSV</Button>
        <Button variant="ghost" size="sm" type="button" onClick={() => downloadText("table.tsv", delimitedTable(rows, "\t"), "text/tab-separated-values")}><Download aria-hidden="true" />TSV</Button>
      </div>
    </div>
  )
}

const markdownComponents = { table: MarkdownTable }

/** How many full YAML reads stay in the transcript before older ones are stubbed. */
const KEPT_SOURCE_READS = 1

/**
 * Replace all but the most recent `get_yaml_source` results with a short
 * placeholder, so the conversation does not accumulate a full copy of the
 * document per read.
 *
 * Nothing is lost: the document is always retrievable by calling the tool
 * again, and the version handshake means the model cannot silently rely on a
 * pruned copy anyway — a proposal built from stale content is rejected.
 */
function pruneStaleSourceReads(messages: ModelMessage[], sourceReadIds: string[]) {
  const stale = new Set(sourceReadIds.slice(0, -KEPT_SOURCE_READS))
  if (!stale.size) return
  for (const message of messages) {
    if (message.role !== "tool" || !message.tool_call_id || !stale.has(message.tool_call_id)) continue
    if (message.content?.startsWith("{\"pruned\"")) continue
    message.content = JSON.stringify({
      pruned: true,
      reason: "Superseded by a later get_yaml_source call. Call get_yaml_source again if you need the document.",
    })
  }
}

function systemPrompt(runtime: AppToolRuntime) {
  return `You are the assistant embedded in PRISM Product Graph Editor. Use only the registered tools. You can inspect bounded workspace, graph, YAML-structure, and LCA-result summaries; change graph presentation and selection; navigate views; and propose registered model, calculation, download, export, and deletion actions. Actions marked for confirmation must be approved by the user in the application before they run. You can read the complete YAML with get_yaml_source and propose a rewrite with propose_yaml_edit. Always call get_yaml_source immediately before proposing, and pass its version token back as basedOnVersion: a proposal written against a document that has since changed is rejected, and you must re-read and rewrite it. Send the complete document, never a patch or a fragment, and preserve existing comments and formatting. A proposal is written to the editor as an unsaved draft for the user to review and save; it is never applied automatically, so never claim an edit has been applied. Never claim access to unregistered application state, and never claim an action succeeded until its tool result confirms it. Be concise and explain unavailable actions clearly.\n\nCurrent registered application context:\n${JSON.stringify({ activeView: runtime.activeView, views: listViews(runtime.hasCurrentResults), workspace: { calculationStatus: runtime.workspace.calculationStatus, hasCurrentResults: runtime.hasCurrentResults }, graph: { nodeCount: runtime.graph.nodes.length, connectionCount: runtime.graph.connectionCount, mode: runtime.graph.mode, orientation: runtime.graph.orientation, selectedNodeId: runtime.graph.selectedNodeId } }, null, 2)}`
}

export function AiChatPanel({
  open,
  onOpenChange,
  runtime,
  portalTarget,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  runtime: AppToolRuntime
  portalTarget: HTMLDivElement | null
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [apiKey, setApiKey] = useState(() => storedValue(API_KEY_STORAGE, ""))
  const [model, setModel] = useState(() => storedValue(MODEL_STORAGE, MODELS[0]))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => Number(storedValue(WIDTH_STORAGE, "410")) || 410)
  const [status, setStatus] = useState<"idle" | "streaming">("idle")
  const [error, setError] = useState("")
  const [confirmation, setConfirmation] = useState<{ summary: string; resolve(accepted: boolean): void } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  // The conversation as the model sees it, kept across turns. Display state
  // cannot stand in for it: a ChatMessage records tool results as segments, not
  // as the `assistant` + `tool` message pair a provider needs to replay them.
  const transcriptRef = useRef<ModelMessage[]>([])
  const sourceReadIdsRef = useRef<string[]>([])
  const latestRuntimeRef = useRef(runtime)
  latestRuntimeRef.current = runtime
  const transport = useMemo(() => createOpenRouterTransport({ apiKey, endpoint: ENDPOINT }), [apiKey])
  const mcp = useMcpServers()
  const toolDefinitions = useMemo(() => mergeToolDefinitions(appToolDefinitions, mcp.registry), [mcp.registry])

  const requestToolConfirmation = useCallback((summary: string) => new Promise<boolean>((resolve) => {
    setConfirmation({ summary, resolve })
  }), [])

  const resolveToolConfirmation = (accepted: boolean) => {
    confirmation?.resolve(accepted)
    setConfirmation(null)
  }

  useEffect(() => {
    if (open) requestAnimationFrame(() => promptRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!portalTarget) return
    portalTarget.style.setProperty("--ai-chat-width", `${panelWidth}px`)
  }, [panelWidth, portalTarget])

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth <= 620) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth
    let nextWidth = startWidth
    const resize = (pointerEvent: PointerEvent) => {
      const maximum = window.innerWidth - 80
      nextWidth = Math.min(maximum, Math.max(240, startWidth + startX - pointerEvent.clientX))
      setPanelWidth(nextWidth)
    }
    const finish = () => {
      window.removeEventListener("pointermove", resize)
      window.removeEventListener("pointerup", finish)
      document.body.classList.remove("is-resizing-ai-chat")
      try { localStorage.setItem(WIDTH_STORAGE, String(Math.round(nextWidth))) } catch { /* Optional preference. */ }
    }
    document.body.classList.add("is-resizing-ai-chat")
    window.addEventListener("pointermove", resize)
    window.addEventListener("pointerup", finish, { once: true })
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const maximum = window.innerWidth - 80
    const direction = event.key === "ArrowLeft" ? 1 : -1
    setPanelWidth((current) => {
      const next = Math.min(maximum, Math.max(240, current + direction * 20))
      try { localStorage.setItem(WIDTH_STORAGE, String(Math.round(next))) } catch { /* Optional preference. */ }
      return next
    })
  }

  const setStreaming = useCallback((id: string, streaming: boolean) => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, streaming } : message))
  }, [])

  const upsertTextSegment = useCallback((id: string, segmentId: string, content: string) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== id) return message
      const index = message.segments.findIndex((segment) => segment.kind === "text" && segment.id === segmentId)
      const segment: MessageSegment = { kind: "text", id: segmentId, content }
      if (index === -1) return { ...message, segments: [...message.segments, segment] }
      const segments = [...message.segments]
      segments[index] = segment
      return { ...message, segments }
    }))
  }, [])

  const appendToolSegments = useCallback((id: string, tools: Array<{ name: string; output: unknown; error: boolean }>) => {
    setMessages((current) => current.map((message) => message.id === id
      ? { ...message, segments: [...message.segments, ...tools.map((tool): MessageSegment => ({ kind: "tool", id: messageId(), ...tool }))] }
      : message))
  }, [])

  const send = useCallback(async (text: string) => {
    const value = text.trim()
    if (!value || status !== "idle") return
    const userMessage: ChatMessage = { id: messageId(), role: "user", segments: [{ kind: "text", id: messageId(), content: value }] }
    const assistantId = messageId()
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", segments: [], streaming: true }
    const priorMessages = messages
    setMessages([...priorMessages, userMessage, assistantMessage])
    setDraft("")
    setError("")
    setStatus("streaming")
    const controller = new AbortController()
    abortRef.current = controller

    // Tool results are pushed into the conversation as messages, so every
    // get_yaml_source result sits in the transcript exactly as an embedded
    // document would and context grows linearly with the number of reads.
    const sourceReadIds = sourceReadIdsRef.current
    const transcript = transcriptRef.current
    transcript.push({ role: "user", content: value })
    try {
      for (let round = 0; round < 8; round += 1) {
        const segmentId = messageId()
        // The system message carries live runtime context, so it is rebuilt for
        // every request rather than stored in the transcript.
        const result = await transport.stream({
          model,
          messages: [{ role: "system", content: systemPrompt(runtime) }, ...transcript],
          tools: toolDefinitions,
          signal: controller.signal,
          onDelta: (content) => upsertTextSegment(assistantId, segmentId, content),
        })
        upsertTextSegment(assistantId, segmentId, result.content)
        if (!result.calls.length) {
          transcript.push({ role: "assistant", content: result.content })
          break
        }
        transcript.push({ role: "assistant", content: result.content || null, tool_calls: result.calls })
        const toolViews: Array<{ name: string; output: unknown; error: boolean }> = []
        for (const call of result.calls) {
          let output: unknown
          let failed = false
          try {
            const typedCall = call as ViewToolCall
            const before = latestRuntimeRef.current
            const remoteTool = mcp.registry.get(call.function.name)
            const execute = async (currentRuntime: AppToolRuntime) => {
              if (!remoteTool) return executeAppTool(typedCall, currentRuntime)
              const result = await mcp.callTool(call.function.name, parseMcpToolArguments(call.function.arguments))
              const formatted = formatRemoteToolResult(result)
              failed = formatted.error
              return formatted.output
            }
            if (requiresToolConfirmation(call.function.name, mcp.registry)) {
              const summary = remoteTool
                ? remoteConfirmationSummary(call.function.name, mcp.registry)
                : confirmationSummary(typedCall, before)
              const accepted = await requestToolConfirmation(summary)
              if (!accepted) {
                output = { status: "rejected", reason: "Rejected by user." }
              } else if (remoteTool) {
                output = await execute(before)
              } else {
                const latest = latestRuntimeRef.current
                if (latest.workspace.appliedRevision !== before.workspace.appliedRevision || latest.workspace.yamlDraft !== before.workspace.yamlDraft) {
                  failed = true
                  output = { status: "error", code: "STALE_CONFIRMATION", message: "Application state changed after this action was proposed." }
                } else {
                  output = await execute(latest)
                }
              }
            } else {
              output = await execute(before)
            }
          } catch (toolError) {
            failed = true
            output = { error: toolError instanceof Error ? toolError.message : String(toolError) }
          }
          toolViews.push({ name: call.function.name, output, error: failed })
          transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) })
          if (call.function.name === "get_yaml_source") sourceReadIds.push(call.id)
        }
        pruneStaleSourceReads(transcript, sourceReadIds)
        appendToolSegments(assistantId, toolViews)
        if (round === 7) throw new Error("The assistant exceeded the view-tool round limit.")
      }
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
        const message = requestError instanceof Error ? requestError.message : String(requestError)
        setError(message)
        upsertTextSegment(assistantId, `${assistantId}-error`, message)
      }
    } finally {
      repairTranscript(transcript)
      setStreaming(assistantId, false)
      abortRef.current = null
      setStatus("idle")
      requestAnimationFrame(() => promptRef.current?.focus())
    }
  }, [appendToolSegments, mcp, messages, model, requestToolConfirmation, runtime, setStreaming, status, toolDefinitions, transport, upsertTextSegment])

  const saveSettings = () => {
    try {
      localStorage.setItem(MODEL_STORAGE, model)
      localStorage.setItem(API_KEY_STORAGE, apiKey)
    } catch { /* Storage can be unavailable in restricted browser contexts. */ }
    setSettingsOpen(false)
  }

  const growPrompt = () => {
    const node = promptRef.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(node.scrollHeight, window.innerHeight * 0.4)}px`
  }
  useEffect(() => { growPrompt() }, [draft])

  const panel = open && portalTarget ? createPortal(
    <aside className="ai-chat-sidebar" aria-label="PRISM assistant">
        <button className="ai-chat-resize-handle" type="button" aria-label="Resize AI assistant" aria-valuemin={240} aria-valuemax={Math.max(240, window.innerWidth - 80)} aria-valuenow={Math.round(panelWidth)} onKeyDown={resizeByKeyboard} onPointerDown={startResize}><GripVertical aria-hidden="true" /></button>
        <div className="ai-chat-header">
          <button type="button" className="ai-chat-model-readout" onClick={() => setSettingsOpen(true)} title="Change model in chat settings">{model}</button>
          <div className="ai-chat-header-actions">
            <Button variant="ghost" size="icon" type="button" aria-label="New conversation" onClick={() => { setMessages([]); setError(""); transcriptRef.current = []; sourceReadIdsRef.current = [] }} disabled={status !== "idle"}><MessageSquarePlus size={16} /></Button>
            <Button variant="ghost" size="icon" type="button" aria-label="Chat settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></Button>
            <Button variant="ghost" size="icon" type="button" aria-label="Close AI assistant" onClick={() => onOpenChange(false)}><X size={16} /></Button>
          </div>
        </div>

        <MessageScrollerProvider autoScroll>
          <MessageScroller className="ai-chat-conversation" aria-live="polite" aria-busy={status === "streaming"}>
            <MessageScrollerViewport>
              <MessageScrollerContent className="ai-chat-conversation-content">
                {messages.length === 0 ? <div className="ai-chat-welcome"><div className="ai-chat-suggestions"><Button variant="outline" size="sm" onClick={() => void send("Summarize this graph")}>Summarize graph</Button><Button variant="outline" size="sm" onClick={() => void send("What views are available?")}>List views</Button></div></div> : null}
                {messages.map((message) => <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                  <article className={`ai-chat-message is-${message.role}`}>
                    <div className="ai-chat-message-content">
                      {message.segments.length === 0 && message.streaming ? <span className="ai-chat-thinking">Thinking…</span> : null}
                      {message.segments.map((segment) => segment.kind === "text"
                        ? segment.content ? <ReactMarkdown key={segment.id} remarkPlugins={[remarkGfm]} components={markdownComponents}>{segment.content}</ReactMarkdown> : null
                        : <details className="ai-chat-tool" key={segment.id}><summary>{segment.name}{segment.error ? " · error" : " · complete"}</summary><pre>{JSON.stringify(segment.output, null, 2)}</pre></details>)}
                    </div>
                  </article>
                </MessageScrollerItem>)}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <div className="ai-chat-composer">
          <label className="sr-only" htmlFor="ai-chat-prompt">Message</label>
          <textarea ref={promptRef} id="ai-chat-prompt" rows={1} value={draft} disabled={status === "streaming"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft) } }} placeholder="Ask about the workspace or graph…" />
          <Button type="button" size="icon" className="ai-chat-send" aria-label={status === "streaming" ? "Stop response" : "Send message"} disabled={status === "idle" && !draft.trim()} onClick={() => status === "streaming" ? abortRef.current?.abort() : void send(draft)}>{status === "streaming" ? <Square size={16} /> : <ArrowUp size={16} />}</Button>
        </div>
        {error ? <p className="ai-chat-error" role="alert">{error}</p> : null}
    </aside>,
    portalTarget,
  ) : null

  return <>
    {panel}

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Chat settings</DialogTitle><DialogDescription>Your OpenRouter API key is stored in this browser's local storage so you don't need to re-enter it. Production deployments can route requests through a backend by configuring the OpenRouter endpoint.</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="openrouter-key">OpenRouter API key</FieldLabel><div className="ai-chat-key-field"><KeyRound aria-hidden="true" /><Input id="openrouter-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></div></Field>
          <Field><FieldLabel htmlFor="ai-chat-model">Model</FieldLabel><Select value={model} onValueChange={setModel}><SelectTrigger id="ai-chat-model" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{MODELS.map((id) => <SelectItem value={id} key={id}>{id}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        </FieldGroup>
        <McpServerSettings
          servers={mcp.servers}
          statuses={mcp.statuses}
          addServer={mcp.addServer}
          updateServer={mcp.updateServer}
          removeServer={mcp.removeServer}
          reconnect={mcp.reconnect}
        />
        <DialogFooter><Button type="button" onClick={saveSettings}>Save settings</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmation !== null} onOpenChange={(next) => { if (!next && confirmation) resolveToolConfirmation(false) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Confirm assistant action</AlertDialogTitle><AlertDialogDescription>{confirmation?.summary}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel onClick={() => resolveToolConfirmation(false)}>Reject</AlertDialogCancel><AlertDialogAction onClick={() => resolveToolConfirmation(true)}>Confirm</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
