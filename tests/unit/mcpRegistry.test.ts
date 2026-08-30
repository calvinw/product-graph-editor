import { describe, expect, it } from "vitest"
import {
  REMOTE_RESULT_LIMIT_BYTES, createMcpToolRegistry, formatRemoteToolResult, mcpToolName,
  mergeToolDefinitions, remoteConfirmationSummary, requiresToolConfirmation,
} from "@/ai/mcpRegistry"
import { appToolDefinitions } from "@/ai/viewTools"

describe("MCP tool registry", () => {
  const registry = createMcpToolRegistry([{
    id: "lca server",
    label: "LCA",
    tools: [
      { name: "read_result", description: "Read a result", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "run-calculation", description: "Run a calculation" },
    ],
  }])

  it("prefixes remote names into the model's flat function namespace", () => {
    expect(mcpToolName("lca server", "read/result")).toBe("mcp_read_result")
    expect([...registry.keys()]).toEqual(["mcp_read_result", "mcp_run-calculation"])
  })

  it("keeps generated names within the OpenAI function-name limit", () => {
    expect(mcpToolName("server".repeat(20), "tool".repeat(30)).length).toBeLessThanOrEqual(64)
  })

  it("merges definitions without changing the local definitions", () => {
    const merged = mergeToolDefinitions(appToolDefinitions, registry)
    expect(merged.slice(0, appToolDefinitions.length)).toEqual(appToolDefinitions)
    expect(merged.at(-1)?.function.name).toBe("mcp_run-calculation")
  })

  it("trusts only explicit read-only annotations", () => {
    expect(requiresToolConfirmation("mcp_read_result", registry)).toBe(false)
    expect(requiresToolConfirmation("mcp_run-calculation", registry)).toBe(true)
    expect(requiresToolConfirmation("calculate_current_model", registry)).toBe(true)
    expect(requiresToolConfirmation("get_graph_summary", registry)).toBe(false)
  })

  it("stops asking for a server marked trusted in settings", () => {
    const trusted = createMcpToolRegistry([{
      id: "lca server",
      label: "LCA",
      trusted: true,
      tools: [{ name: "run-calculation", description: "Run a calculation" }],
    }])
    expect(requiresToolConfirmation("mcp_run-calculation", trusted)).toBe(false)
    // The app's own tools are unaffected by a remote server's setting.
    expect(requiresToolConfirmation("calculate_current_model", trusted)).toBe(true)
  })

  it("disambiguates the same tool name offered by two servers", () => {
    const twoServers = createMcpToolRegistry([
      { id: "a", label: "A", tools: [{ name: "list_databases" }] },
      { id: "b", label: "B", tools: [{ name: "list_databases" }] },
    ])
    const names = [...twoServers.keys()]
    expect(names).toHaveLength(2)
    expect(names[0]).toBe("mcp_list_databases")
    expect(names[1]).not.toBe(names[0])
  })

  it("describes a remote confirmation with its server and original name", () => {
    expect(remoteConfirmationSummary("mcp_run-calculation", registry))
      .toBe("Run “run-calculation” on the remote MCP server LCA?")
  })
})

describe("remote MCP result formatting", () => {
  it("flattens text, resource, and omitted binary blocks", () => {
    const formatted = formatRemoteToolResult({ content: [
      { type: "text", text: "answer" },
      { type: "resource", resource: { uri: "file:///result", text: "resource text" } },
      { type: "image", mimeType: "image/png", data: "large" },
    ] })
    expect(formatted.output.content).toContain("answer")
    expect(formatted.output.content).toContain("resource text")
    expect(formatted.output.content).toContain("Image content: image/png omitted")
  })

  it("marks protocol-level tool errors", () => {
    expect(formatRemoteToolResult({ content: [{ type: "text", text: "failed" }], isError: true }))
      .toEqual({ output: { content: "failed", isError: true }, error: true })
  })

  it("caps large results and tells the model they were truncated", () => {
    const formatted = formatRemoteToolResult({ content: [{ type: "text", text: "x".repeat(REMOTE_RESULT_LIMIT_BYTES * 2) }] })
    expect(formatted.output.truncated).toBe(true)
    expect(new TextEncoder().encode(formatted.output.content).byteLength).toBeLessThan(REMOTE_RESULT_LIMIT_BYTES)
  })
})
