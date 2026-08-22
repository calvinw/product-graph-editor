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
  appToolDefinitions, confirmationSummary, confirmedToolNames, executeAppTool, listViews, type AppToolRuntime, type ViewToolCall,
} from "@/ai/viewTools"

type MessageSegment =
  | { kind: "text"; id: string; content: string }
  | { kind: "tool"; id: string; name: string; output: unknown; error?: boolean }

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  segments: MessageSegment[]
  streaming?: boolean
}

function messageText(message: ChatMessage) {
  return message.segments.filter((segment): segment is Extract<MessageSegment, { kind: "text" }> => segment.kind === "text")
    .map((segment) => segment.content).join("")
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

function systemPrompt(runtime: AppToolRuntime) {
  return `You are the assistant embedded in PRISM Product Graph Editor. Use only the registered tools. You can inspect bounded workspace, graph, YAML-structure, and LCA-result summaries; change graph presentation and selection; navigate views; and propose registered model, calculation, download, export, and deletion actions. Actions marked for confirmation must be approved by the user in the application before they run. Never claim access to complete YAML contents or unregistered application state, and never claim an action succeeded until its tool result confirms it. Be concise and explain unavailable actions clearly.\n\nCurrent registered application context:\n${JSON.stringify({ activeView: runtime.activeView, views: listViews(runtime.hasCurrentResults), workspace: { calculationStatus: runtime.workspace.calculationStatus, hasCurrentResults: runtime.hasCurrentResults }, graph: { nodeCount: runtime.graph.nodes.length, connectionCount: runtime.graph.connectionCount, mode: runtime.graph.mode, orientation: runtime.graph.orientation, selectedNodeId: runtime.graph.selectedNodeId } }, null, 2)}`
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
  const latestRuntimeRef = useRef(runtime)
  latestRuntimeRef.current = runtime
  const transport = useMemo(() => createOpenRouterTransport({ apiKey, endpoint: ENDPOINT }), [apiKey])

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

    const apiMessages: ModelMessage[] = [
      { role: "system", content: systemPrompt(runtime) },
      ...priorMessages.map((message) => ({ role: message.role, content: messageText(message) } as ModelMessage)),
      { role: "user", content: value },
    ]
    try {
      for (let round = 0; round < 8; round += 1) {
        const segmentId = messageId()
        const result = await transport.stream({
          model,
          messages: apiMessages,
          tools: appToolDefinitions,
          signal: controller.signal,
          onDelta: (content) => upsertTextSegment(assistantId, segmentId, content),
        })
        upsertTextSegment(assistantId, segmentId, result.content)
        if (!result.calls.length) break
        apiMessages.push({ role: "assistant", content: result.content || null, tool_calls: result.calls })
        const toolViews: Array<{ name: string; output: unknown; error: boolean }> = []
        for (const call of result.calls) {
          let output: unknown
          let failed = false
          try {
            const typedCall = call as ViewToolCall
            const before = latestRuntimeRef.current
            if (confirmedToolNames.has(call.function.name)) {
              const accepted = await requestToolConfirmation(confirmationSummary(typedCall, before))
              if (!accepted) {
                output = { status: "rejected", reason: "Rejected by user." }
              } else {
                const latest = latestRuntimeRef.current
                if (latest.workspace.appliedRevision !== before.workspace.appliedRevision || latest.workspace.yamlDraft !== before.workspace.yamlDraft) {
                  failed = true
                  output = { status: "error", code: "STALE_CONFIRMATION", message: "Application state changed after this action was proposed." }
                } else {
                  output = await executeAppTool(typedCall, latest)
                }
              }
            } else {
              output = await executeAppTool(typedCall, before)
            }
          } catch (toolError) {
            failed = true
            output = { error: toolError instanceof Error ? toolError.message : String(toolError) }
          }
          toolViews.push({ name: call.function.name, output, error: failed })
          apiMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) })
        }
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
      setStreaming(assistantId, false)
      abortRef.current = null
      setStatus("idle")
      requestAnimationFrame(() => promptRef.current?.focus())
    }
  }, [appendToolSegments, messages, model, requestToolConfirmation, runtime, setStreaming, status, transport, upsertTextSegment])

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
            <Button variant="ghost" size="icon" type="button" aria-label="New conversation" onClick={() => { setMessages([]); setError("") }} disabled={status !== "idle"}><MessageSquarePlus size={16} /></Button>
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
      <DialogContent>
        <DialogHeader><DialogTitle>Chat settings</DialogTitle><DialogDescription>Your OpenRouter API key is stored in this browser's local storage so you don't need to re-enter it. Production deployments can route requests through a backend by configuring the OpenRouter endpoint.</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="openrouter-key">OpenRouter API key</FieldLabel><div className="ai-chat-key-field"><KeyRound aria-hidden="true" /><Input id="openrouter-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></div></Field>
          <Field><FieldLabel htmlFor="ai-chat-model">Model</FieldLabel><Select value={model} onValueChange={setModel}><SelectTrigger id="ai-chat-model" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{MODELS.map((id) => <SelectItem value={id} key={id}>{id}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        </FieldGroup>
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
