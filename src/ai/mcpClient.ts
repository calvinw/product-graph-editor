export const MCP_PROTOCOL_VERSION = "2025-06-18"

export type McpTransportPreference = "auto" | "http" | "sse"
export type McpResolvedTransport = Exclude<McpTransportPreference, "auto">

export type McpTool = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
    [key: string]: unknown
  }
}

export type McpCallToolResult = {
  content?: unknown[]
  structuredContent?: unknown
  isError?: boolean
  [key: string]: unknown
}

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type SseFrame = { event: string; data: string }

type PendingRequest = {
  resolve(value: unknown): void
  reject(reason: unknown): void
  timeout: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 30_000

export class McpHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "McpHttpError"
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<JsonRpcResponse>
  return candidate.jsonrpc === "2.0" && (typeof candidate.id === "string" || typeof candidate.id === "number")
}

function unwrapResponse(response: JsonRpcResponse) {
  if (response.error) {
    throw new Error(`MCP error ${response.error.code}: ${response.error.message}`)
  }
  return response.result
}

async function* readSseFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let event = "message"
  let data: string[] = []

  const frame = () => {
    if (!data.length) return null
    const value = { event, data: data.join("\n") }
    event = "message"
    data = []
    return value
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "")
        buffer = buffer.slice(newline + 1)
        if (!line) {
          const completed = frame()
          if (completed) yield completed
        } else if (!line.startsWith(":")) {
          const separator = line.indexOf(":")
          const field = separator === -1 ? line : line.slice(0, separator)
          const raw = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "")
          if (field === "event") event = raw
          if (field === "data") data.push(raw)
        }
        newline = buffer.indexOf("\n")
      }
      if (done) break
    }
    if (buffer) data.push(buffer.replace(/\r$/, ""))
    const completed = frame()
    if (completed) yield completed
  } finally {
    reader.releaseLock()
  }
}

async function responseText(response: Response) {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ""
  }
}

export class McpClient {
  private nextId = 1
  private sessionId = ""
  private negotiatedProtocol = ""
  private resolvedTransport: McpResolvedTransport | null = null
  private legacyMessageUrl = ""
  private legacyAbort: AbortController | null = null
  private pending = new Map<string | number, PendingRequest>()
  private connected = false
  private closing = false

  constructor(
    readonly url: string,
    readonly transportPreference: McpTransportPreference = "auto",
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  get transport() {
    return this.resolvedTransport
  }

  async connect(): Promise<McpTool[]> {
    if (this.connected) return this.listTools()
    this.closing = false
    const preferLegacy = this.transportPreference === "sse" || (
      this.transportPreference === "auto" && new URL(this.url, globalThis.location?.href ?? "http://localhost/").pathname.endsWith("/sse")
    )

    if (preferLegacy) {
      await this.connectLegacy()
    } else {
      try {
        await this.connectHttp()
      } catch (error) {
        const canFallback = this.transportPreference === "auto"
          && error instanceof McpHttpError
          && [404, 405].includes(error.status)
        if (!canFallback) throw error
        await this.resetConnection()
        await this.connectLegacy()
      }
    }

    this.connected = true
    return this.listTools()
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = []
    let cursor: string | undefined
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}) as { tools?: McpTool[]; nextCursor?: string }
      tools.push(...(result.tools ?? []))
      cursor = result.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    if (!this.connected) throw new Error("The MCP server is not connected.")
    return await this.request("tools/call", { name, arguments: args }) as McpCallToolResult
  }

  async disconnect() {
    this.closing = true
    this.connected = false
    if (this.resolvedTransport === "http" && this.sessionId) {
      const headers = this.httpHeaders()
      try {
        await this.fetcher(this.url, { method: "DELETE", headers })
      } catch {
        // Session cleanup is best-effort during page and settings teardown.
      }
    }
    await this.resetConnection()
  }

  private async connectHttp() {
    this.resolvedTransport = "http"
    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "PRISM Product Graph Editor", version: "0.1.0" },
    }) as { protocolVersion?: string }
    if (!result.protocolVersion) throw new Error("The MCP server did not return a protocol version.")
    this.negotiatedProtocol = result.protocolVersion
    await this.notify("notifications/initialized")
  }

  private async connectLegacy() {
    this.resolvedTransport = "sse"
    this.legacyAbort = new AbortController()
    const response = await this.fetcher(this.url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: this.legacyAbort.signal,
    })
    if (!response.ok) throw new McpHttpError(`MCP SSE connection failed (${response.status}): ${await responseText(response)}`, response.status)
    if (!response.body) throw new Error("The MCP SSE server returned an empty stream.")

    let resolveEndpoint: ((value: string) => void) | undefined
    let rejectEndpoint: ((reason: unknown) => void) | undefined
    const endpoint = new Promise<string>((resolve, reject) => {
      resolveEndpoint = resolve
      rejectEndpoint = reject
    })
    void this.pumpLegacyStream(response.body, resolveEndpoint, rejectEndpoint)
    this.legacyMessageUrl = await Promise.race([
      endpoint,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The MCP SSE server did not provide a message endpoint.")), REQUEST_TIMEOUT_MS)),
    ])

    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "PRISM Product Graph Editor", version: "0.1.0" },
    }) as { protocolVersion?: string }
    if (!result.protocolVersion) throw new Error("The MCP server did not return a protocol version.")
    this.negotiatedProtocol = result.protocolVersion
    await this.notify("notifications/initialized")
  }

  private async pumpLegacyStream(
    stream: ReadableStream<Uint8Array>,
    resolveEndpoint?: (value: string) => void,
    rejectEndpoint?: (reason: unknown) => void,
  ) {
    try {
      for await (const frame of readSseFrames(stream)) {
        if (frame.event === "endpoint") {
          resolveEndpoint?.(new URL(frame.data, this.url).toString())
          resolveEndpoint = undefined
          rejectEndpoint = undefined
          continue
        }
        let value: unknown
        try {
          value = JSON.parse(frame.data)
        } catch {
          continue
        }
        if (!isJsonRpcResponse(value)) continue
        const pending = this.pending.get(value.id)
        if (!pending) continue
        clearTimeout(pending.timeout)
        this.pending.delete(value.id)
        try {
          pending.resolve(unwrapResponse(value))
        } catch (error) {
          pending.reject(error)
        }
      }
      if (!this.closing) throw new Error("The MCP SSE connection closed.")
    } catch (error) {
      if (this.closing || (error instanceof DOMException && error.name === "AbortError")) return
      rejectEndpoint?.(error)
      this.rejectPending(error)
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const message = { jsonrpc: "2.0" as const, id, method, params }
    if (this.resolvedTransport === "sse") return this.requestLegacy(message)
    return this.requestHttp(message)
  }

  private async notify(method: string, params?: Record<string, unknown>) {
    const message = { jsonrpc: "2.0", method, ...(params ? { params } : {}) }
    if (this.resolvedTransport === "sse") {
      await this.postLegacy(message)
      return
    }
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: this.httpHeaders(),
      body: JSON.stringify(message),
    })
    if (!response.ok) throw new McpHttpError(`MCP notification failed (${response.status}): ${await responseText(response)}`, response.status)
  }

  private async requestHttp(message: { jsonrpc: "2.0"; id: number; method: string; params: Record<string, unknown> }) {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: this.httpHeaders(),
      body: JSON.stringify(message),
    })
    const returnedSession = response.headers.get("Mcp-Session-Id")
    if (returnedSession) this.sessionId = returnedSession
    if (!response.ok) throw new McpHttpError(`MCP request failed (${response.status}): ${await responseText(response)}`, response.status)
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? ""
    let value: unknown
    if (contentType.includes("text/event-stream")) {
      if (!response.body) throw new Error("The MCP server returned an empty event stream.")
      for await (const frame of readSseFrames(response.body)) {
        const candidate = JSON.parse(frame.data) as unknown
        if (isJsonRpcResponse(candidate) && candidate.id === message.id) {
          value = candidate
          break
        }
      }
    } else {
      value = await response.json()
    }
    if (!isJsonRpcResponse(value) || value.id !== message.id) {
      throw new Error(`The MCP server did not return a response for ${message.method}.`)
    }
    return unwrapResponse(value)
  }

  private requestLegacy(message: { jsonrpc: "2.0"; id: number; method: string; params: Record<string, unknown> }) {
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.id)
        reject(new Error(`MCP request timed out: ${message.method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(message.id, { resolve, reject, timeout })
      void this.postLegacy(message).catch((error) => {
        clearTimeout(timeout)
        this.pending.delete(message.id)
        reject(error)
      })
    })
  }

  private async postLegacy(message: object) {
    if (!this.legacyMessageUrl) throw new Error("The MCP SSE message endpoint is not available.")
    const response = await this.fetcher(this.legacyMessageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
    if (!response.ok) throw new McpHttpError(`MCP SSE message failed (${response.status}): ${await responseText(response)}`, response.status)
  }

  private httpHeaders() {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    }
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId
    if (this.negotiatedProtocol) headers["Mcp-Protocol-Version"] = this.negotiatedProtocol
    return headers
  }

  private rejectPending(reason: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(reason)
    }
    this.pending.clear()
  }

  private async resetConnection() {
    this.legacyAbort?.abort()
    this.legacyAbort = null
    this.rejectPending(new Error("The MCP connection closed."))
    this.sessionId = ""
    this.negotiatedProtocol = ""
    this.resolvedTransport = null
    this.legacyMessageUrl = ""
  }
}

export function describeMcpError(error: unknown) {
  const message = errorMessage(error)
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "The server did not allow browser requests or could not be reached. Check its URL and CORS policy."
  }
  return message
}
