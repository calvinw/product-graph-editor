import type { McpCallToolResult, McpTool } from "@/ai/mcpClient"
import { confirmedToolNames, type ViewToolDefinition } from "@/ai/viewTools"

export const REMOTE_RESULT_LIMIT_BYTES = 8 * 1024

export type McpRegistryServer = {
  id: string
  label: string
  tools: McpTool[]
}

export type RegisteredMcpTool = {
  definition: ViewToolDefinition
  serverId: string
  serverLabel: string
  remoteName: string
  readOnly: boolean
}

export type McpToolRegistry = Map<string, RegisteredMcpTool>

function identifier(value: string, fallback: string) {
  const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || fallback
}

function shortHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function mcpToolName(serverId: string, remoteName: string) {
  const server = identifier(serverId, "server").slice(0, 20)
  const tool = identifier(remoteName, "tool")
  const base = `mcp__${server}__${tool}`
  return base.length <= 64 ? base : `${base.slice(0, 55)}_${shortHash(base).slice(0, 8)}`
}

export function createMcpToolRegistry(servers: McpRegistryServer[]) {
  const registry: McpToolRegistry = new Map()
  for (const server of servers) {
    for (const tool of server.tools) {
      let name = mcpToolName(server.id, tool.name)
      if (registry.has(name)) name = `${name.slice(0, 55)}_${shortHash(`${server.id}:${tool.name}`).slice(0, 8)}`
      registry.set(name, {
        definition: {
          type: "function",
          function: {
            name,
            description: `[${server.label}] ${tool.description?.trim() || `Run the remote MCP tool ${tool.name}.`}`,
            parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false },
          },
        },
        serverId: server.id,
        serverLabel: server.label,
        remoteName: tool.name,
        readOnly: tool.annotations?.readOnlyHint === true,
      })
    }
  }
  return registry
}

export function mergeToolDefinitions(local: ViewToolDefinition[], registry: McpToolRegistry) {
  return [...local, ...Array.from(registry.values(), (tool) => tool.definition)]
}

export function requiresToolConfirmation(name: string, registry: McpToolRegistry) {
  const remote = registry.get(name)
  return remote ? !remote.readOnly : confirmedToolNames.has(name)
}

export function remoteConfirmationSummary(name: string, registry: McpToolRegistry) {
  const remote = registry.get(name)
  return remote ? `Run “${remote.remoteName}” on the remote MCP server ${remote.serverLabel}?` : `Run ${name}?`
}

export function parseMcpToolArguments(value: string) {
  const parsed = JSON.parse(value || "{}") as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Remote MCP tool arguments must be an object.")
  }
  return parsed as Record<string, unknown>
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return JSON.stringify(value)
  const block = value as Record<string, unknown>
  if (block.type === "text" && typeof block.text === "string") return block.text
  if (block.type === "resource" && block.resource && typeof block.resource === "object") {
    const resource = block.resource as Record<string, unknown>
    if (typeof resource.text === "string") return resource.text
    if (typeof resource.uri === "string") return `[Resource: ${resource.uri}]`
  }
  if (block.type === "resource_link" && typeof block.uri === "string") return `[Resource link: ${block.uri}]`
  if (block.type === "image") return `[Image content${typeof block.mimeType === "string" ? `: ${block.mimeType}` : ""} omitted]`
  if (block.type === "audio") return `[Audio content${typeof block.mimeType === "string" ? `: ${block.mimeType}` : ""} omitted]`
  return JSON.stringify(value)
}

function truncateUtf8(value: string, limit: number) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  if (bytes.byteLength <= limit) return { value, bytes: bytes.byteLength, truncated: false }
  const decoder = new TextDecoder()
  return { value: decoder.decode(bytes.slice(0, limit)), bytes: bytes.byteLength, truncated: true }
}

export function formatRemoteToolResult(result: McpCallToolResult, limit = REMOTE_RESULT_LIMIT_BYTES) {
  const parts = (result.content ?? []).map(contentText)
  if (result.structuredContent !== undefined) {
    parts.push(`Structured content:\n${JSON.stringify(result.structuredContent)}`)
  }
  if (!parts.length) parts.push(JSON.stringify(result))
  const combined = parts.join("\n\n")
  const suffixBudget = 256
  const truncated = truncateUtf8(combined, Math.max(0, limit - suffixBudget))
  return {
    output: {
      content: truncated.value,
      ...(truncated.truncated ? { truncated: true, originalBytes: truncated.bytes } : {}),
      ...(result.isError ? { isError: true } : {}),
    },
    error: result.isError === true,
  }
}
