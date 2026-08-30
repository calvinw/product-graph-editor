import { expect, test, type Page, type Route } from "@playwright/test"
import { expectInsideViewport, mockLcaApi, pageMetrics } from "./helpers"

function sse(route: Route, chunks: unknown[]) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
  })
}

async function mockNavigationAssistant(page: Page) {
  await page.route("**/lca-api/api/lca/base", async (route) => {
    await route.fulfill({ status: 503, json: { detail: "Calculation unavailable in navigation-only chat tests." } })
  })
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ role: string; content: string | null }>
    }
    // A provider sees a tool result only as the *last* message of a tool round.
    // Earlier rounds stay in the transcript across turns, so match on position.
    const last = body.messages.at(-1)
    const toolResult = last?.role === "tool" ? last : undefined
    if (toolResult) {
      const output = JSON.parse(toolResult.content ?? "{}") as { status?: string; label?: string; reason?: string }
      const content = output.status === "unavailable"
        ? `I can't open that view yet. ${output.reason}`
        : `Opened ${output.label ?? "the requested view"}.`
      await sse(route, [{ choices: [{ delta: { content } }] }])
      return
    }

    const prompt = body.messages.at(-1)?.content?.toLowerCase() ?? ""
    const tool = prompt.includes("summarize")
      ? { name: "get_graph_summary", arguments: "{}" }
      : prompt.includes("impact categories")
        ? { name: "list_impact_categories", arguments: "{}" }
      : prompt.includes("validate yaml")
        ? { name: "validate_yaml_draft", arguments: "{}" }
      : prompt.includes("calculate current")
        ? { name: "calculate_current_model", arguments: "{}" }
      : prompt.includes("workspace status")
        ? { name: "get_workspace_status", arguments: "{}" }
        : prompt.includes("vertical")
          ? { name: "set_graph_display", arguments: JSON.stringify({ orientation: "vertical" }) }
          : { name: "switch_view", arguments: JSON.stringify({ view: prompt.includes("sankey") ? "sankey" : "yaml" }) }
    await sse(route, [{
      choices: [{ delta: { tool_calls: [{ index: 0, id: "tool-call", function: tool }] } }],
    }])
  })
}

async function configureChat(page: Page) {
  await page.getByRole("button", { name: "AI assistant" }).click()
  const chat = page.getByRole("complementary", { name: "PRISM assistant" })
  await expect(chat).toBeVisible()
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0)
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Chat settings" }).click()
  await page.getByLabel("OpenRouter API key").fill("test-key")
  await page.getByRole("button", { name: "Save settings" }).click()
}

async function mockRemoteMcp(page: Page) {
  await page.route("https://lca.mathplosion.com/mcp", async (route) => {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    }
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    const body = route.request().postDataJSON() as { id?: number; method: string }
    if (body.method === "notifications/initialized") {
      await route.fulfill({ status: 202, headers: corsHeaders })
      return
    }
    const result = body.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "LCA", version: "test" } }
      : body.method === "tools/list"
        ? { tools: [
          { name: "read_remote_summary", description: "Read a remote summary", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
          { name: "change_remote_state", description: "Change remote state", inputSchema: { type: "object", properties: {} } },
        ] }
        : { content: [{ type: "text", text: "Remote mutation completed." }] }
    await route.fulfill({
      json: { jsonrpc: "2.0", id: body.id, result },
      headers: { ...corsHeaders, ...(body.method === "initialize" ? { "Mcp-Session-Id": "browser-session" } : {}) },
    })
  })
}

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await mockNavigationAssistant(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
})

test("assistant switches to Edit through the guarded view action", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Open the YAML editor")
  await prompt.press("Enter")

  await expect(page.getByRole("complementary", { name: "PRISM assistant" }).getByText("Opened Edit.")).toBeVisible()
  await expect(page.getByLabel("Product graph YAML")).toBeVisible()
  const metrics = await pageMetrics(page)
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})

test("assistant rejects an unavailable Sankey view", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Open the Sankey view")
  await prompt.press("Enter")

  await expect(page.locator(".ai-chat-message-content").getByText(/Calculate the current model/)).toBeVisible()
  await expect(page.locator(".react-flow")).toBeVisible()
})

test("chat settings persist the API key across reload", async ({ page }) => {
  await configureChat(page)
  await page.reload()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await page.getByRole("button", { name: "AI assistant" }).click()
  await page.getByRole("button", { name: "Chat settings" }).click()
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue("test-key")
})

test("assistant connects, displays, confirms, and calls a remote MCP tool", async ({ page }) => {
  await mockRemoteMcp(page)
  await configureChat(page)
  await page.unroute("https://openrouter.ai/api/v1/chat/completions")
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ role: string; content: string | null }>
      tools: Array<{ function: { name: string; description: string } }>
    }
    // A provider sees a tool result only as the *last* message of a tool round.
    // Earlier rounds stay in the transcript across turns, so match on position.
    const last = body.messages.at(-1)
    const toolResult = last?.role === "tool" ? last : undefined
    if (toolResult) {
      const output = JSON.parse(toolResult.content ?? "{}") as { status?: string }
      const content = output.status === "rejected" ? "The remote change was rejected." : "The remote change completed."
      await sse(route, [{ choices: [{ delta: { content } }] }])
      return
    }
    const remote = body.tools.find((tool) => tool.function.description.includes("Change remote state"))
    expect(remote).toBeDefined()
    await sse(route, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "remote-call", function: { name: remote?.function.name, arguments: "{}" } }] } }] }])
  })

  await page.getByRole("button", { name: "Chat settings" }).click()
  await page.getByRole("button", { name: "LCA engine" }).click()
  const settings = page.getByRole("dialog", { name: "Chat settings" })
  await expect(settings.getByText("Connected via HTTP · 2 tools")).toBeVisible()
  await settings.getByText("Discovered tools").click()
  await expect(settings.getByText("change_remote_state")).toBeVisible()
  await expectInsideViewport(settings, page)
  const metrics = await pageMetrics(page)
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  await settings.getByRole("button", { name: "Save settings" }).click()

  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Change the remote state")
  await prompt.press("Enter")
  const confirmation = page.getByRole("alertdialog", { name: "Confirm assistant action" })
  await expect(confirmation).toContainText("change_remote_state")
  await expect(confirmation).toContainText("LCA engine")
  await confirmation.getByRole("button", { name: "Reject" }).click()
  await expect(page.getByText("The remote change was rejected.")).toBeVisible()

  await prompt.fill("Change the remote state again")
  await prompt.press("Enter")
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole("button", { name: "Confirm" }).click()
  await expect(page.locator(".ai-chat-tool").filter({ hasText: /mcp__.*change_remote_state/ }).filter({ hasText: "Completed" }).last()).toBeVisible()
  await expect(page.getByText("The remote change completed.")).toBeVisible()
})

test("assistant reads bounded workspace and graph summaries", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Show workspace status")
  await prompt.press("Enter")
  const workspaceTool = page.locator(".ai-chat-tool").filter({ hasText: "get_workspace_status" }).filter({ hasText: "Completed" })
  await expect(workspaceTool).toBeVisible()
  await workspaceTool.click()
  await expect(page.getByText(/"yamlDirty"/)).toBeVisible()

  await prompt.fill("Summarize this graph")
  await prompt.press("Enter")
  const graphTool = page.locator(".ai-chat-tool").filter({ hasText: "get_graph_summary" }).filter({ hasText: "Completed" })
  await expect(graphTool).toBeVisible()
  await graphTool.click()
  await expect(page.getByText(/"nodeCount"/)).toBeVisible()
})

test("assistant changes registered graph presentation settings", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Set the graph orientation to vertical")
  await prompt.press("Enter")
  await expect(page.locator(".ai-chat-tool").filter({ hasText: "set_graph_display" }).filter({ hasText: "Completed" })).toBeVisible()
  await page.getByRole("button", { name: "Close AI assistant" }).click()
  await page.getByRole("button", { name: "Graph settings" }).click()
  await expect(page.getByRole("combobox", { name: "Graph orientation" })).toHaveText(/Vertical/)
})

test("assistant reads bounded current LCA results", async ({ page }) => {
  await page.unroute("**/lca-api/api/lca/base")
  await page.reload()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await expect(page.getByRole("button", { name: "Scaled Graph" })).toBeEnabled()
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("List the available impact categories")
  await prompt.press("Enter")
  const resultTool = page.locator(".ai-chat-tool").filter({ hasText: "list_impact_categories" }).filter({ hasText: "Completed" })
  await expect(resultTool).toBeVisible()
  await resultTool.click()
  await expect(page.getByText(/climate change/)).toBeVisible()
})

test("assistant validates YAML without exposing the draft", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Validate YAML")
  await prompt.press("Enter")
  const validationTool = page.locator(".ai-chat-tool").filter({ hasText: "validate_yaml_draft" }).filter({ hasText: "Completed" })
  await expect(validationTool).toBeVisible()
  await validationTool.click()
  await expect(page.getByText(/"valid": true/)).toBeVisible()
  await expect(page.getByText(/functional_unit:/)).toHaveCount(0)
})

test("assistant requires confirmation before a calculation mutation", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Calculate current model")
  await prompt.press("Enter")
  const confirmation = page.getByRole("alertdialog", { name: "Confirm assistant action" })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText("Calculate the applied revision")
  await confirmation.getByRole("button", { name: "Confirm" }).click()
  await expect(page.locator(".ai-chat-tool").filter({ hasText: "calculate_current_model" }).filter({ hasText: "Completed" })).toBeVisible()
})

test("assistant follows new messages to the bottom", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  for (let index = 0; index < 6; index += 1) {
    await prompt.fill(`Open the YAML editor ${index}`)
    await prompt.press("Enter")
    await expect(prompt).toBeEnabled()
  }

  const viewport = page.locator(".ai-chat-conversation")
  await expect.poll(() => viewport.evaluate((element) => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(2)
})

test("assistant split pane resizes the workspace", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 620, "Phone chat uses the full contained width.")
  const workspace = page.locator(".app-main-pane")
  const fullWorkspace = await workspace.boundingBox()
  await configureChat(page)
  const chat = page.getByRole("complementary", { name: "PRISM assistant" })
  const before = await chat.boundingBox()
  const workspaceBefore = await workspace.boundingBox()
  const handle = page.getByRole("button", { name: "Resize AI assistant" })
  const handleBox = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(handleBox).not.toBeNull()
  if (!before || !handleBox) return
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + 80, handleBox.y + handleBox.height / 2, { steps: 5 })
  await page.mouse.up()
  const after = await chat.boundingBox()
  const workspaceAfter = await workspace.boundingBox()
  expect(after?.width ?? 0).toBeLessThan(before.width - 60)
  expect(workspaceBefore?.width ?? 0).toBeLessThan((fullWorkspace?.width ?? 0) - 300)
  expect(workspaceAfter?.width ?? 0).toBeGreaterThan((workspaceBefore?.width ?? 0) + 60)
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeVisible()
  await expect(page.locator(".react-flow")).toBeVisible()
  const graphNode = await page.locator(".react-flow__node:visible").first().boundingBox()
  expect((graphNode?.x ?? 0) + (graphNode?.width ?? 0)).toBeLessThanOrEqual((workspaceAfter?.x ?? 0) + (workspaceAfter?.width ?? 0))

  await handle.focus()
  await handle.press("ArrowLeft")
  await expect(handle).toHaveAttribute("aria-valuenow", String(Math.round((after?.width ?? 0) + 20)))
})
