import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  McpClient, describeMcpError, type McpTool, type McpTransportPreference,
} from "@/ai/mcpClient"
import { createMcpToolRegistry } from "@/ai/mcpRegistry"

export type McpServerConfig = {
  id: string
  label: string
  url: string
  enabled: boolean
  transport: McpTransportPreference
  /**
   * Run this server's tools without asking each time. On by default: confirming
   * every remote call made the assistant unusable. Untick it per server to get
   * the prompts back.
   */
  trusted: boolean
}

export type McpServerStatus = {
  status: "idle" | "connecting" | "connected" | "error"
  error: string
  tools: McpTool[]
  transport: "http" | "sse" | null
}

export const MCP_SERVERS_STORAGE = "product-graph-editor:mcp-servers:v1"

export const MCP_SERVER_PRESETS = [
  { label: "LCA engine", url: "https://lca.mathplosion.com/mcp", transport: "http" as const },
  { label: "Dolt database", url: "https://bus-mgmt-databases.mcp.mathplosion.com/mcp-dolt-database/sse", transport: "sse" as const },
] as const

const EMPTY_STATUS: McpServerStatus = { status: "idle", error: "", tools: [], transport: null }

function serverId() {
  return globalThis.crypto?.randomUUID?.() ?? `server-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isTransport(value: unknown): value is McpTransportPreference {
  return value === "auto" || value === "http" || value === "sse"
}

export function parseStoredMcpServers(serialized: string | null): McpServerConfig[] {
  if (!serialized) return []
  try {
    const value = JSON.parse(serialized) as unknown
    if (!Array.isArray(value)) return []
    return value.flatMap((candidate, index) => {
      if (!candidate || typeof candidate !== "object") return []
      const server = candidate as Partial<McpServerConfig>
      if (typeof server.id !== "string" || typeof server.url !== "string") return []
      return [{
        id: server.id,
        label: typeof server.label === "string" && server.label.trim() ? server.label : `Server ${index + 1}`,
        url: server.url,
        enabled: server.enabled !== false,
        // Absent in servers stored before this setting existed, which take the
        // same default as a newly added one.
        trusted: server.trusted !== false,
        transport: isTransport(server.transport) ? server.transport : "auto",
      }]
    })
  } catch {
    return []
  }
}

function storedServers() {
  try {
    return parseStoredMcpServers(localStorage.getItem(MCP_SERVERS_STORAGE))
  } catch {
    return []
  }
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerConfig[]>(storedServers)
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
  const [reconnectRevision, setReconnectRevision] = useState(0)
  const clientsRef = useRef(new Map<string, McpClient>())

  useEffect(() => {
    try { localStorage.setItem(MCP_SERVERS_STORAGE, JSON.stringify(servers)) } catch { /* Optional browser preference. */ }
  }, [servers])

  useEffect(() => {
    let cancelled = false
    const priorClients = clientsRef.current
    clientsRef.current = new Map()
    for (const client of priorClients.values()) void client.disconnect()

    const timer = window.setTimeout(() => {
      if (cancelled) return
      const nextStatuses = Object.fromEntries(servers.map((server) => [
        server.id,
        server.enabled && server.url.trim()
          ? { ...EMPTY_STATUS, status: "connecting" as const }
          : EMPTY_STATUS,
      ]))
      setStatuses(nextStatuses)

      const connect = async (server: McpServerConfig) => {
        if (!server.enabled || !server.url.trim()) return
        const client = new McpClient(server.url.trim(), server.transport)
        clientsRef.current.set(server.id, client)
        try {
          const tools = await client.connect()
          if (cancelled || clientsRef.current.get(server.id) !== client) {
            await client.disconnect()
            return
          }
          setStatuses((current) => ({
            ...current,
            [server.id]: { status: "connected", error: "", tools, transport: client.transport },
          }))
        } catch (error) {
          if (cancelled || clientsRef.current.get(server.id) !== client) return
          clientsRef.current.delete(server.id)
          setStatuses((current) => ({
            ...current,
            [server.id]: { status: "error", error: describeMcpError(error), tools: [], transport: null },
          }))
          await client.disconnect()
        }
      }

      void Promise.all(servers.map(connect))
    }, 600)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      const currentClients = clientsRef.current
      clientsRef.current = new Map()
      for (const client of currentClients.values()) void client.disconnect()
    }
  }, [reconnectRevision, servers])

  const registry = useMemo(() => createMcpToolRegistry(servers.flatMap((server) => {
    const state = statuses[server.id]
    return state?.status === "connected" ? [{ id: server.id, label: server.label, tools: state.tools, trusted: server.trusted }] : []
  })), [servers, statuses])

  const addServer = useCallback((preset?: { label: string; url: string; transport: McpTransportPreference }) => {
    setServers((current) => [...current, {
      id: serverId(),
      label: preset?.label ?? `Server ${current.length + 1}`,
      url: preset?.url ?? "",
      enabled: true,
      trusted: true,
      transport: preset?.transport ?? "auto",
    }])
  }, [])

  const updateServer = useCallback((id: string, patch: Partial<Omit<McpServerConfig, "id">>) => {
    setServers((current) => current.map((server) => server.id === id ? { ...server, ...patch } : server))
  }, [])

  const removeServer = useCallback((id: string) => {
    setServers((current) => current.filter((server) => server.id !== id))
  }, [])

  const reconnect = useCallback(() => setReconnectRevision((current) => current + 1), [])

  const callTool = useCallback(async (registeredName: string, args: Record<string, unknown>) => {
    const tool = registry.get(registeredName)
    if (!tool) throw new Error(`Remote MCP tool is no longer registered: ${registeredName}`)
    const client = clientsRef.current.get(tool.serverId)
    if (!client) throw new Error(`Remote MCP server is no longer connected: ${tool.serverLabel}`)
    return client.callTool(tool.remoteName, args)
  }, [registry])

  return {
    servers,
    statuses,
    registry,
    addServer,
    updateServer,
    removeServer,
    reconnect,
    callTool,
  }
}
