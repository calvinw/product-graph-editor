import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, GripVertical, KeyRound, MessageSquarePlus, Send, Settings2, Square, X } from "lucide-react"
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

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
  tools?: Array<{ name: string; output: unknown; error?: boolean }>
}

const MODELS = [
  ["openai/gpt-4o-mini", "GPT-4o mini"],
  ["openai/gpt-5.6-luna", "GPT-5.6 Luna"],
] as const
const ENDPOINT = import.meta.env.VITE_OPENROUTER_ENDPOINT ?? "https://openrouter.ai/api/v1/chat/completions"
const MODEL_STORAGE = "product-graph-editor:chat-model"
const WIDTH_STORAGE = "product-graph-editor:chat-width"
const AUDIT_STORAGE = "product-graph-editor:chat-tool-audit"

function storedValue(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random()}`
}

function recordToolAudit(name: string, status: "completed" | "rejected" | "error") {
  try {
    const current = JSON.parse(localStorage.getItem(AUDIT_STORAGE) ?? "[]") as unknown
    const history = Array.isArray(current) ? current : []
    localStorage.setItem(AUDIT_STORAGE, JSON.stringify([
      { id: messageId(), name, source: "llm", status, timestamp: new Date().toISOString() },
      ...history,
    ].slice(0, 100)))
  } catch { /* Audit persistence is best-effort in restricted browser contexts. */ }
}

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
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(() => storedValue(MODEL_STORAGE, MODELS[0][0]))
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
      const maximum = Math.min(640, window.innerWidth - 48)
      nextWidth = Math.min(maximum, Math.max(320, startWidth + startX - pointerEvent.clientX))
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
    const maximum = Math.min(640, window.innerWidth - 360)
    const direction = event.key === "ArrowLeft" ? 1 : -1
    setPanelWidth((current) => {
      const next = Math.min(maximum, Math.max(320, current + direction * 20))
      try { localStorage.setItem(WIDTH_STORAGE, String(Math.round(next))) } catch { /* Optional preference. */ }
      return next
    })
  }

  const publishAssistant = useCallback((id: string, update: Partial<ChatMessage>) => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, ...update } : message))
  }, [])

  const send = useCallback(async (text: string) => {
    const value = text.trim()
    if (!value || status !== "idle") return
    const userMessage: ChatMessage = { id: messageId(), role: "user", content: value }
    const assistantId = messageId()
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", content: "", streaming: true }
    const priorMessages = messages
    setMessages([...priorMessages, userMessage, assistantMessage])
    setDraft("")
    setError("")
    setStatus("streaming")
    const controller = new AbortController()
    abortRef.current = controller

    const apiMessages: ModelMessage[] = [
      { role: "system", content: systemPrompt(runtime) },
      ...priorMessages.map((message) => ({ role: message.role, content: message.content } as ModelMessage)),
      { role: "user", content: value },
    ]
    try {
      for (let round = 0; round < 8; round += 1) {
        const result = await transport.stream({
          model,
          messages: apiMessages,
          tools: appToolDefinitions,
          signal: controller.signal,
          onDelta: (content) => publishAssistant(assistantId, { content }),
        })
        publishAssistant(assistantId, { content: result.content })
        if (!result.calls.length) break
        apiMessages.push({ role: "assistant", content: result.content || null, tool_calls: result.calls })
        const toolViews: ChatMessage["tools"] = []
        for (const call of result.calls) {
          let output: unknown
          let failed = false
          let rejected = false
          try {
            const typedCall = call as ViewToolCall
            const before = latestRuntimeRef.current
            if (confirmedToolNames.has(call.function.name)) {
              const accepted = await requestToolConfirmation(confirmationSummary(typedCall, before))
              if (!accepted) {
                rejected = true
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
          recordToolAudit(call.function.name, failed ? "error" : rejected ? "rejected" : "completed")
          toolViews.push({ name: call.function.name, output, error: failed })
          apiMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) })
        }
        publishAssistant(assistantId, { tools: toolViews, content: "" })
        if (round === 7) throw new Error("The assistant exceeded the view-tool round limit.")
      }
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
        setError(requestError instanceof Error ? requestError.message : String(requestError))
      }
    } finally {
      publishAssistant(assistantId, { streaming: false })
      abortRef.current = null
      setStatus("idle")
    }
  }, [messages, model, publishAssistant, requestToolConfirmation, runtime, status, transport])

  const saveSettings = () => {
    try {
      localStorage.setItem(MODEL_STORAGE, model)
    } catch { /* Storage can be unavailable in restricted browser contexts. */ }
    setSettingsOpen(false)
  }

  const panel = open && portalTarget ? createPortal(
    <aside className="ai-chat-sidebar" aria-label="PRISM assistant">
        <button className="ai-chat-resize-handle" type="button" aria-label="Resize AI assistant" aria-valuemin={320} aria-valuemax={Math.min(640, Math.max(320, window.innerWidth - 360))} aria-valuenow={Math.round(panelWidth)} onKeyDown={resizeByKeyboard} onPointerDown={startResize}><GripVertical aria-hidden="true" /></button>
        <DialogHeader className="ai-chat-header">
          <div className="ai-chat-title"><Bot aria-hidden="true" /><div><h2>PRISM assistant</h2><p>Workspace and graph tools</p></div></div>
          <div className="ai-chat-header-actions">
            <Button variant="ghost" size="icon" type="button" aria-label="New conversation" onClick={() => { setMessages([]); setError("") }} disabled={status !== "idle"}><MessageSquarePlus /></Button>
            <Button variant="ghost" size="icon" type="button" aria-label="Chat settings" onClick={() => setSettingsOpen(true)}><Settings2 /></Button>
            <Button variant="ghost" size="icon" type="button" aria-label="Close AI assistant" onClick={() => onOpenChange(false)}><X /></Button>
          </div>
        </DialogHeader>

        <MessageScrollerProvider autoScroll>
          <MessageScroller className="ai-chat-conversation" aria-live="polite" aria-busy={status === "streaming"}>
            <MessageScrollerViewport>
              <MessageScrollerContent className="ai-chat-conversation-content">
                {messages.length === 0 ? <div className="ai-chat-welcome"><Bot aria-hidden="true" /><h2>How can I help?</h2><p>I can inspect workspace status, explore the displayed graph, adjust its presentation, select nodes, and navigate between registered views.</p><div className="ai-chat-suggestions"><Button variant="outline" size="sm" onClick={() => void send("Summarize this graph")}>Summarize graph</Button><Button variant="outline" size="sm" onClick={() => void send("What views are available?")}>List views</Button></div></div> : null}
                {messages.map((message) => <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                  <article className={`ai-chat-message is-${message.role}`}>
                    <strong>{message.role === "user" ? "You" : "PRISM"}</strong>
                    <div className="ai-chat-message-content">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : message.streaming ? <span className="ai-chat-thinking">Thinking…</span> : null}</div>
                    {message.tools?.map((tool, index) => <details className="ai-chat-tool" key={`${tool.name}-${index}`}><summary>{tool.name}{tool.error ? " · error" : " · complete"}</summary><pre>{JSON.stringify(tool.output, null, 2)}</pre></details>)}
                  </article>
                </MessageScrollerItem>)}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <div className="ai-chat-composer">
          <label className="sr-only" htmlFor="ai-chat-prompt">Message</label>
          <textarea ref={promptRef} id="ai-chat-prompt" value={draft} disabled={status === "streaming"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft) } }} placeholder="Ask about the workspace or graph…" />
          <Button type="button" size="icon" aria-label={status === "streaming" ? "Stop response" : "Send message"} disabled={status === "idle" && !draft.trim()} onClick={() => status === "streaming" ? abortRef.current?.abort() : void send(draft)}>{status === "streaming" ? <Square /> : <Send />}</Button>
        </div>
        {error ? <p className="ai-chat-error" role="alert">{error}</p> : null}
        <small className="ai-chat-disclaimer">AI can make mistakes. Only registered workspace, graph, and navigation tools are available.</small>
    </aside>,
    portalTarget,
  ) : null

  return <>
    {panel}

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Chat settings</DialogTitle><DialogDescription>Your OpenRouter API key is kept in memory for this tab and cleared when the page reloads. Production deployments can route requests through a backend by configuring the OpenRouter endpoint.</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="openrouter-key">OpenRouter API key</FieldLabel><div className="ai-chat-key-field"><KeyRound aria-hidden="true" /><Input id="openrouter-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></div></Field>
          <Field><FieldLabel htmlFor="ai-chat-model">Model</FieldLabel><Select value={model} onValueChange={setModel}><SelectTrigger id="ai-chat-model" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{MODELS.map(([id, label]) => <SelectItem value={id} key={id}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
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
