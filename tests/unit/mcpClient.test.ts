import { describe, expect, it, vi } from "vitest"
import { McpClient, describeMcpError } from "@/ai/mcpClient"

function rpc(id: number, result: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as { id?: number; method: string; params?: Record<string, unknown> }
}

describe("McpClient streamable HTTP", () => {
  it("initializes a session, lists tools, calls one, and closes the session", async () => {
    const requests: Array<{ method: string; headers: Headers }> = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      const body = requestBody(init)
      requests.push({ method: body.method, headers: new Headers(init?.headers) })
      if (body.method === "initialize") {
        return rpc(body.id!, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1" } }, { "Mcp-Session-Id": "session-1" })
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
      if (body.method === "tools/list") {
        return rpc(body.id!, { tools: [{ name: "lookup", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] })
      }
      if (body.method === "tools/call") {
        const stream = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "done" }] } })}\n\n`
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
      }
      throw new Error(`Unexpected method: ${body.method}`)
    }) as unknown as typeof fetch

    const client = new McpClient("https://example.test/mcp", "http", fetcher)
    await expect(client.connect()).resolves.toEqual([
      { name: "lookup", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    ])
    await expect(client.callTool("lookup", { query: "jacket" })).resolves.toEqual({ content: [{ type: "text", text: "done" }] })
    expect(client.transport).toBe("http")
    expect(requests.find((request) => request.method === "initialize")?.headers.get("Mcp-Session-Id")).toBeNull()
    expect(requests.find((request) => request.method === "tools/list")?.headers.get("Mcp-Session-Id")).toBe("session-1")
    expect(requests.find((request) => request.method === "tools/list")?.headers.get("Mcp-Protocol-Version")).toBe("2025-06-18")
    await client.disconnect()
    expect(fetcher).toHaveBeenLastCalledWith("https://example.test/mcp", expect.objectContaining({ method: "DELETE" }))
  })

  it("surfaces JSON-RPC errors", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(init)
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Nope" } }), {
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch
    const client = new McpClient("https://example.test/mcp", "http", fetcher)
    await expect(client.connect()).rejects.toThrow("MCP error -32602: Nope")
  })
})

describe("McpClient legacy SSE", () => {
  it("uses the announced message endpoint and resolves responses from the held stream", async () => {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(next) {
        controller = next
        next.enqueue(encoder.encode("event: endpoint\ndata: /messages/?session_id=abc\n\n"))
      },
    })
    const postUrls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
      const body = requestBody(init)
      postUrls.push(String(input))
      let result: unknown = {}
      if (body.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "legacy", version: "1" } }
      if (body.method === "tools/list") result = { tools: [{ name: "query", inputSchema: { type: "object" } }] }
      if (body.method === "tools/call") result = { content: [{ type: "text", text: "legacy result" }] }
      if (body.id !== undefined) {
        queueMicrotask(() => controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`)))
      }
      return new Response(null, { status: 202 })
    }) as unknown as typeof fetch

    const client = new McpClient("https://example.test/sse", "auto", fetcher)
    await expect(client.connect()).resolves.toEqual([{ name: "query", inputSchema: { type: "object" } }])
    await expect(client.callTool("query", {})).resolves.toEqual({ content: [{ type: "text", text: "legacy result" }] })
    expect(client.transport).toBe("sse")
    expect(postUrls.every((url) => url === "https://example.test/messages/?session_id=abc")).toBe(true)
    await client.disconnect()
    controller.close()
  })
})

describe("describeMcpError", () => {
  it("turns browser network failures into a CORS-aware diagnostic", () => {
    expect(describeMcpError(new TypeError("Failed to fetch"))).toMatch(/CORS policy/)
  })
})
