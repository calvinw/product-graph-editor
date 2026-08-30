import { Plus, RotateCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  MCP_SERVER_PRESETS, type McpServerConfig, type McpServerStatus,
} from "@/hooks/useMcpServers"

export function McpServerSettings({
  servers,
  statuses,
  addServer,
  updateServer,
  removeServer,
  reconnect,
}: {
  servers: McpServerConfig[]
  statuses: Record<string, McpServerStatus>
  addServer(preset?: { label: string; url: string; transport: McpServerConfig["transport"] }): void
  updateServer(id: string, patch: Partial<Omit<McpServerConfig, "id">>): void
  removeServer(id: string): void
  reconnect(): void
}) {
  return (
    <FieldSet className="ai-chat-mcp-settings">
      <FieldLegend>Remote MCP tools</FieldLegend>
      <FieldDescription>
        Connect directly from this browser. Remote tools join the assistant only while their server is connected.
      </FieldDescription>

      {servers.length ? <FieldGroup className="ai-chat-mcp-server-list">
        {servers.map((server) => {
          const state = statuses[server.id] ?? { status: "idle", error: "", tools: [], transport: null }
          const statusText = state.status === "connected"
            ? `Connected via ${state.transport?.toUpperCase()} · ${state.tools.length} tool${state.tools.length === 1 ? "" : "s"}`
            : state.status === "connecting" ? "Connecting…" : state.status === "error" ? "Connection error" : "Not connected"
          return <section className="ai-chat-mcp-server" key={server.id} aria-label={server.label || "Remote MCP server"}>
            <div className="ai-chat-mcp-server-heading">
              <Field orientation="horizontal">
                <Checkbox
                  id={`mcp-enabled-${server.id}`}
                  checked={server.enabled}
                  onCheckedChange={(checked) => updateServer(server.id, { enabled: checked === true })}
                />
                <FieldLabel htmlFor={`mcp-enabled-${server.id}`}>Enabled</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`mcp-trusted-${server.id}`}
                  checked={server.trusted}
                  onCheckedChange={(checked) => updateServer(server.id, { trusted: checked === true })}
                />
                <FieldLabel htmlFor={`mcp-trusted-${server.id}`} title="Run this server's tools without confirming each call">Run without asking</FieldLabel>
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${server.label || "remote server"}`} onClick={() => removeServer(server.id)}>
                <Trash2 />
              </Button>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`mcp-label-${server.id}`}>Name</FieldLabel>
                <Input id={`mcp-label-${server.id}`} value={server.label} onChange={(event) => updateServer(server.id, { label: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`mcp-url-${server.id}`}>Server URL</FieldLabel>
                <Input id={`mcp-url-${server.id}`} type="url" inputMode="url" placeholder="https://example.com/mcp" value={server.url} onChange={(event) => updateServer(server.id, { url: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`mcp-transport-${server.id}`}>Transport</FieldLabel>
                <Select value={server.transport} onValueChange={(transport) => updateServer(server.id, { transport: transport as McpServerConfig["transport"] })}>
                  <SelectTrigger id={`mcp-transport-${server.id}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="auto">Auto detect</SelectItem>
                    <SelectItem value="http">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">Legacy SSE</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <p className="ai-chat-mcp-status" data-status={state.status} role="status">{statusText}</p>
            {state.error ? <p className="ai-chat-mcp-error" role="alert">{state.error}</p> : null}
            {state.tools.length ? <details className="ai-chat-mcp-tools"><summary>Discovered tools</summary><ul>{state.tools.map((tool) => <li key={tool.name}>{tool.name}</li>)}</ul></details> : null}
          </section>
        })}
      </FieldGroup> : <p className="ai-chat-mcp-empty">No remote servers configured.</p>}

      <div className="ai-chat-mcp-actions">
        <Button type="button" variant="outline" size="sm" onClick={() => addServer()}><Plus data-icon="inline-start" />Add server</Button>
        {MCP_SERVER_PRESETS.map((preset) => <Button type="button" variant="ghost" size="sm" key={preset.label} onClick={() => addServer(preset)}>
          <Plus data-icon="inline-start" />{preset.label}
        </Button>)}
        {servers.length ? <Button type="button" variant="ghost" size="sm" onClick={reconnect}><RotateCw data-icon="inline-start" />Reconnect</Button> : null}
      </div>
    </FieldSet>
  )
}
