import { describe, expect, it } from "vitest"
import { parseStoredMcpServers } from "@/hooks/useMcpServers"

describe("parseStoredMcpServers", () => {
  it("returns an empty list for unavailable or malformed storage", () => {
    expect(parseStoredMcpServers(null)).toEqual([])
    expect(parseStoredMcpServers("not json")).toEqual([])
    expect(parseStoredMcpServers("{}")) .toEqual([])
  })

  it("normalizes older entries onto the versioned schema", () => {
    expect(parseStoredMcpServers(JSON.stringify([{ id: "lca", url: "/lca-mcp" }]))).toEqual([{
      id: "lca",
      label: "Server 1",
      url: "/lca-mcp",
      enabled: true,
      trusted: true,
      transport: "auto",
    }])
  })

  it("drops invalid entries without discarding valid ones", () => {
    const value = parseStoredMcpServers(JSON.stringify([
      null,
      { id: "dolt", label: "Dolt", url: "https://example.test/sse", enabled: false, transport: "sse" },
      { id: 2, url: "https://invalid.test" },
    ]))
    expect(value).toEqual([{
      id: "dolt",
      label: "Dolt",
      url: "https://example.test/sse",
      enabled: false,
      trusted: true,
      transport: "sse",
    }])
  })
})
