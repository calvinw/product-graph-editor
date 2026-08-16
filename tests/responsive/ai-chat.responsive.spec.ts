import { expect, test, type Page, type Route } from "@playwright/test"
import { mockLcaApi, pageMetrics } from "./helpers"

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
    const toolResult = [...body.messages].reverse().find((message) => message.role === "tool")
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

  await expect(page.getByRole("complementary", { name: "PRISM assistant" }).getByText(/Calculate the current model/).first()).toBeVisible()
  await expect(page.locator(".react-flow")).toBeVisible()
})

test("chat settings keep the API key for the next visit", async ({ page }) => {
  await configureChat(page)
  await page.reload()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await page.getByRole("button", { name: "AI assistant" }).click()
  await page.getByRole("button", { name: "Chat settings" }).click()
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue("test-key")
})

test("assistant reads bounded workspace and graph summaries", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Show workspace status")
  await prompt.press("Enter")
  const workspaceTool = page.getByText("get_workspace_status · complete")
  await expect(workspaceTool).toBeVisible()
  await workspaceTool.click()
  await expect(page.getByText(/"yamlDirty"/)).toBeVisible()

  await prompt.fill("Summarize this graph")
  await prompt.press("Enter")
  const graphTool = page.getByText("get_graph_summary · complete")
  await expect(graphTool).toBeVisible()
  await graphTool.click()
  await expect(page.getByText(/"nodeCount"/)).toBeVisible()
})

test("assistant changes registered graph presentation settings", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Set the graph orientation to vertical")
  await prompt.press("Enter")
  await expect(page.getByText("set_graph_display · complete")).toBeVisible()
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
  const resultTool = page.getByText("list_impact_categories · complete")
  await expect(resultTool).toBeVisible()
  await resultTool.click()
  await expect(page.getByText(/climate change/)).toBeVisible()
})

test("assistant validates YAML without exposing the draft", async ({ page }) => {
  await configureChat(page)
  const prompt = page.getByRole("textbox", { name: "Message", exact: true })
  await prompt.fill("Validate YAML")
  await prompt.press("Enter")
  const validationTool = page.getByText("validate_yaml_draft · complete")
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
  await expect(page.getByText("calculate_current_model · complete")).toBeVisible()
})

test("assistant sidebar is resizable without obscuring the workspace", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 620, "Phone chat uses the full contained width.")
  await configureChat(page)
  const chat = page.getByRole("complementary", { name: "PRISM assistant" })
  const before = await chat.boundingBox()
  const handle = page.getByRole("button", { name: "Resize AI assistant" })
  const handleBox = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(handleBox).not.toBeNull()
  if (!before || !handleBox) return
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x - 80, handleBox.y + handleBox.height / 2, { steps: 5 })
  await page.mouse.up()
  const after = await chat.boundingBox()
  expect(after?.width ?? 0).toBeGreaterThan(before.width + 60)
  await expect(page.locator(".react-flow")).toBeVisible()
})
