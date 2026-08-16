import type { ViewToolCall, ViewToolDefinition } from "./viewTools"

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: ViewToolCall[]
  tool_call_id?: string
}

export type ChatTransportResult = {
  content: string
  calls: ViewToolCall[]
}

export type ChatTransport = {
  stream(request: {
    model: string
    messages: ModelMessage[]
    tools: ViewToolDefinition[]
    signal: AbortSignal
    onDelta(content: string): void
  }): Promise<ChatTransportResult>
}

type StreamDelta = {
  content?: string
  tool_calls?: Array<{
    index: number
    id?: string
    function?: { name?: string; arguments?: string }
  }>
}

export function createOpenRouterTransport({ apiKey, endpoint }: { apiKey: string; endpoint: string }): ChatTransport {
  return {
    async stream({ model, messages, tools, signal, onDelta }) {
      if (!apiKey.trim()) throw new Error("Add an OpenRouter API key in chat settings.")
      const response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
          "HTTP-Referer": window.location.href,
          "X-Title": "PRISM Product Graph Editor",
        },
        body: JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: true }),
      })
      if (!response.ok) throw new Error(`Model request failed (${response.status}): ${await response.text()}`)
      if (!response.body) throw new Error("The model returned an empty response stream.")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const calls: Array<ViewToolCall | undefined> = []
      let buffer = ""
      let content = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ") || line.includes("[DONE]")) continue
          const parsed = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: StreamDelta }> }
          const delta = parsed.choices?.[0]?.delta ?? {}
          content += delta.content ?? ""
          for (const part of delta.tool_calls ?? []) {
            const call = calls[part.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } }
            call.id = part.id ?? call.id
            call.function.name += part.function?.name ?? ""
            call.function.arguments += part.function?.arguments ?? ""
          }
          onDelta(content)
        }
      }
      return { content, calls: calls.filter((call): call is ViewToolCall => Boolean(call)) }
    },
  }
}

