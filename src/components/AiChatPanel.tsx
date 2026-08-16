import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, GripVertical, KeyRound, MessageSquarePlus, Send, Settings2, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createOpenRouterTransport, type ModelMessage } from "@/ai/chatTransport"
import {
  executeViewTool, listViews, viewToolDefinitions, type SwitchViewOutcome, type ViewToolCall,
} from "@/ai/viewTools"
import type { ProductGraphView } from "@/state/productGraphStore"

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
const KEY_STORAGE = "product-graph-editor:openrouter-key"
const MODEL_STORAGE = "product-graph-editor:chat-model"
const WIDTH_STORAGE = "product-graph-editor:chat-width"

function storedValue(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random()}`
}

function systemPrompt(activeView: ProductGraphView, hasCurrentResults: boolean) {
  return `You are the navigation assistant embedded in PRISM Product Graph Editor. Your only application capabilities are listing views, reading the active view, and switching views. Use the provided tools whenever the user asks about or requests application navigation. Never claim that you changed YAML, calculations, graph settings, selections, or model data. Be concise.\n\nCurrent registered application context:\n${JSON.stringify({ activeView, views: listViews(hasCurrentResults) }, null, 2)}`
}

export function AiChatPanel({
  open,
  onOpenChange,
  activeView,
  hasCurrentResults,
  onSwitchView,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  activeView: ProductGraphView
  hasCurrentResults: boolean
  onSwitchView(view: ProductGraphView): SwitchViewOutcome
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [apiKey, setApiKey] = useState(() => storedValue(KEY_STORAGE, ""))
  const [model, setModel] = useState(() => storedValue(MODEL_STORAGE, MODELS[0][0]))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => Number(storedValue(WIDTH_STORAGE, "410")) || 410)
  const [status, setStatus] = useState<"idle" | "streaming">("idle")
  const [error, setError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const latestStateRef = useRef({ activeView, hasCurrentResults })
  latestStateRef.current = { activeView, hasCurrentResults }
  const transport = useMemo(() => createOpenRouterTransport({ apiKey, endpoint: ENDPOINT }), [apiKey])

  useEffect(() => {
    if (open) requestAnimationFrame(() => promptRef.current?.focus())
  }, [open])

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
      { role: "system", content: systemPrompt(activeView, hasCurrentResults) },
      ...priorMessages.map((message) => ({ role: message.role, content: message.content } as ModelMessage)),
      { role: "user", content: value },
    ]
    try {
      for (let round = 0; round < 8; round += 1) {
        const result = await transport.stream({
          model,
          messages: apiMessages,
          tools: viewToolDefinitions,
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
          try {
            const latest = latestStateRef.current
            output = await executeViewTool({
              call: call as ViewToolCall,
              activeView: latest.activeView,
              hasCurrentResults: latest.hasCurrentResults,
              switchView: onSwitchView,
            })
          } catch (toolError) {
            failed = true
            output = { error: toolError instanceof Error ? toolError.message : String(toolError) }
          }
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
  }, [activeView, hasCurrentResults, messages, model, onSwitchView, publishAssistant, status, transport])

  const saveSettings = () => {
    try {
      localStorage.setItem(KEY_STORAGE, apiKey.trim())
      localStorage.setItem(MODEL_STORAGE, model)
    } catch { /* Storage can be unavailable in restricted browser contexts. */ }
    setSettingsOpen(false)
  }

  return <>
    {open ? <aside className="ai-chat-sidebar" style={{ "--ai-chat-width": `${panelWidth}px` } as React.CSSProperties} aria-label="PRISM assistant">
        <button className="ai-chat-resize-handle" type="button" aria-label="Resize AI assistant" onPointerDown={startResize}><GripVertical aria-hidden="true" /></button>
        <DialogHeader className="ai-chat-header">
          <div className="ai-chat-title"><Bot aria-hidden="true" /><div><h2>PRISM assistant</h2><p>Navigation only</p></div></div>
          <div className="ai-chat-header-actions">
            <Button variant="ghost" size="icon" type="button" aria-label="New conversation" onClick={() => { setMessages([]); setError("") }} disabled={status !== "idle"}><MessageSquarePlus /></Button>
            <Button variant="ghost" size="icon" type="button" aria-label="Chat settings" onClick={() => setSettingsOpen(true)}><Settings2 /></Button>
            <Button variant="ghost" size="icon" type="button" aria-label="Close AI assistant" onClick={() => onOpenChange(false)}><X /></Button>
          </div>
        </DialogHeader>

        <div className="ai-chat-conversation" aria-live="polite" aria-busy={status === "streaming"}>
          {messages.length === 0 ? <div className="ai-chat-welcome"><Bot aria-hidden="true" /><h2>Where would you like to go?</h2><p>I can show available views and navigate between Graph, Edit, Results, and calculated analysis views.</p><div className="ai-chat-suggestions"><Button variant="outline" size="sm" onClick={() => void send("What views are available?")}>List available views</Button><Button variant="outline" size="sm" onClick={() => void send("Open the YAML editor")}>Open Edit</Button></div></div> : null}
          {messages.map((message) => <article className={`ai-chat-message is-${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "You" : "PRISM"}</strong>
            <div className="ai-chat-message-content">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : message.streaming ? <span className="ai-chat-thinking">Thinking…</span> : null}</div>
            {message.tools?.map((tool, index) => <details className="ai-chat-tool" key={`${tool.name}-${index}`}><summary>{tool.name}{tool.error ? " · error" : " · complete"}</summary><pre>{JSON.stringify(tool.output, null, 2)}</pre></details>)}
          </article>)}
        </div>

        <div className="ai-chat-composer">
          <label className="sr-only" htmlFor="ai-chat-prompt">Message</label>
          <textarea ref={promptRef} id="ai-chat-prompt" value={draft} disabled={status === "streaming"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft) } }} placeholder="Ask to switch views…" />
          <Button type="button" size="icon" aria-label={status === "streaming" ? "Stop response" : "Send message"} disabled={status === "idle" && !draft.trim()} onClick={() => status === "streaming" ? abortRef.current?.abort() : void send(draft)}>{status === "streaming" ? <Square /> : <Send />}</Button>
        </div>
        {error ? <p className="ai-chat-error" role="alert">{error}</p> : null}
        <small className="ai-chat-disclaimer">AI can make mistakes. This assistant can only navigate between registered views.</small>
    </aside> : null}

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Chat settings</DialogTitle><DialogDescription>The API key is saved in this browser on this device so it is available next time. Production deployments should use a backend proxy.</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="openrouter-key">OpenRouter API key</FieldLabel><div className="ai-chat-key-field"><KeyRound aria-hidden="true" /><Input id="openrouter-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></div></Field>
          <Field><FieldLabel htmlFor="ai-chat-model">Model</FieldLabel><Select value={model} onValueChange={setModel}><SelectTrigger id="ai-chat-model" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{MODELS.map(([id, label]) => <SelectItem value={id} key={id}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        </FieldGroup>
        <DialogFooter><Button type="button" onClick={saveSettings}>Save settings</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
