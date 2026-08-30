import { expect, test, type Page, type Route } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"
import { productGraphTemplatesFixture } from "../fixtures/product-graph-templates"

/**
 * The assistant edit loop: read the document, propose a rewrite, have it
 * validated and written to the editor as an unsaved draft for the user to
 * save. The version handshake is the load-bearing safety property here.
 */

function sse(route: Route, chunks: unknown[]) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
  })
}

type ToolCall = { name: string; arguments: string }

/**
 * Drives the model side of the conversation from a fixed script: each turn
 * either issues the next scripted tool call or, once the script is exhausted,
 * replies with text summarising the last tool result.
 */
async function mockAssistant(page: Page, script: (lastToolResult: Record<string, unknown> | null) => ToolCall | null) {
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string | null }> }
    // A tool result is only current when it is the last message; earlier rounds
    // persist in the transcript across turns.
    const last = body.messages.at(-1)
    const lastTool = last?.role === "tool" ? last : undefined
    const parsed = lastTool ? JSON.parse(lastTool.content ?? "{}") as Record<string, unknown> : null
    const next = script(parsed)
    if (!next) {
      await sse(route, [{ choices: [{ delta: { content: `Done: ${JSON.stringify(parsed).slice(0, 200)}` } }] }])
      return
    }
    await sse(route, [{
      choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${Math.random()}`, function: next }] } }],
    }])
  })
}

async function mockLcaApi(page: Page) {
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/product-graphs")) return route.fulfill({ json: productGraphTemplatesFixture })
    if (pathname.endsWith("/api/health")) return route.fulfill({ json: { running: true } })
    if (pathname.endsWith("/api/tools")) {
      return route.fulfill({ json: [{ name: "run_lca_base", rest: { method: "POST", path: "/api/lca/base" } }] })
    }
    if (pathname.endsWith("/api/lca/base")) {
      return route.fulfill({ json: { ...lcaResultFixture, contribution_graphs: [] } })
    }
    await route.abort("blockedbyclient")
  })
}

async function openChat(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await page.getByRole("button", { name: "Open AI assistant" }).click()
  await page.getByRole("button", { name: "Chat settings" }).click()
  await page.getByLabel("OpenRouter API key").fill("test-key")
  await page.getByRole("button", { name: "Save settings" }).click()
}

async function ask(page: Page, prompt: string) {
  const box = page.getByRole("textbox", { name: "Message", exact: true })
  await box.fill(prompt)
  await box.press("Enter")
}

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
})

test("the assistant reads the document and its proposal lands as an unsaved draft", async ({ page }) => {
  let step = 0
  await mockAssistant(page, (last) => {
    step += 1
    if (step === 1) return { name: "get_yaml_source", arguments: "{}" }
    if (step === 2) {
      const yaml = String(last?.yaml ?? "").replace("amount: 1.8", "amount: 4.2")
      return { name: "propose_yaml_edit", arguments: JSON.stringify({ yaml, basedOnVersion: last?.version }) }
    }
    return null
  })
  await openChat(page)
  await ask(page, "Raise the first CO2 emission to 4.2")

  await expect(page.getByText("propose_yaml_edit · complete")).toBeVisible()
  // The proposal opens the editor with the change as an unsaved draft.
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await expect(editor).toHaveValue(/amount: 4\.2/)
  await expect(page.getByText("Unsaved changes. Save to update this session model.")).toBeVisible()

  // It is a proposal, not an application: the user still has to save.
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible()
})

test("a proposal written against a stale document is rejected", async ({ page }) => {
  let step = 0
  await mockAssistant(page, (last) => {
    step += 1
    if (step === 1) return { name: "get_yaml_source", arguments: "{}" }
    if (step === 2) {
      // Deliberately stale: a token that cannot match the live document.
      return {
        name: "propose_yaml_edit",
        arguments: JSON.stringify({ yaml: String(last?.yaml ?? "") + "\n# edited", basedOnVersion: "deadbeef" }),
      }
    }
    return null
  })
  await openChat(page)
  await ask(page, "Add a comment")

  const rejection = page.getByText("propose_yaml_edit · complete")
  await expect(rejection).toBeVisible()
  await rejection.click()
  await expect(page.locator(".ai-chat-tool pre").filter({ hasText: "STALE_VERSION" })).toBeVisible()

  // Nothing was written to the editor.
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).not.toHaveValue(/# edited/)
})

test("a proposal that does not parse is rejected before it reaches the editor", async ({ page }) => {
  let step = 0
  await mockAssistant(page, (last) => {
    step += 1
    if (step === 1) return { name: "get_yaml_source", arguments: "{}" }
    if (step === 2) {
      return {
        name: "propose_yaml_edit",
        arguments: JSON.stringify({ yaml: "not: [valid", basedOnVersion: last?.version }),
      }
    }
    return null
  })
  await openChat(page)
  await ask(page, "Break it")

  const result = page.getByText("propose_yaml_edit · complete")
  await expect(result).toBeVisible()
  await result.click()
  await expect(page.locator(".ai-chat-tool pre").filter({ hasText: "INVALID_YAML" })).toBeVisible()

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).not.toHaveValue("not: [valid")
})

test("an assistant edit is recorded, diffed, and can be undone", async ({ page }) => {
  let step = 0
  await mockAssistant(page, (last) => {
    step += 1
    if (step === 1) return { name: "get_yaml_source", arguments: "{}" }
    if (step === 2) {
      const yaml = String(last?.yaml ?? "").replace("amount: 1.8", "amount: 4.2")
      return { name: "propose_yaml_edit", arguments: JSON.stringify({ yaml, basedOnVersion: last?.version }) }
    }
    return null
  })
  await openChat(page)
  await ask(page, "Raise the first CO2 emission to 4.2")

  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await expect(editor).toHaveValue(/amount: 4\.2/)
  await page.getByRole("button", { name: "Save", exact: true }).click()

  await page.getByRole("button", { name: "File", exact: true }).click()
  await page.getByRole("menuitem", { name: "History" }).hover()
  const rows = page.locator(".history-row")
  const newest = rows.first()
  await expect(newest).toContainText("Saved")
  await newest.getByText("What changed").click()
  await expect(newest.locator(".history-diff .is-added")).toContainText("amount: 4.2")

  // And the edit is reversible, which is the point of recording it.
  await rows.filter({ hasText: "Opened" }).first().getByRole("button", { name: "Restore" }).click()
  await expect(editor).toHaveValue(/amount: 1\.8/)
})

test("an assistant proposal shows what it changed before you save it", async ({ page }) => {
  let step = 0
  await mockAssistant(page, (last) => {
    step += 1
    if (step === 1) return { name: "get_yaml_source", arguments: "{}" }
    if (step === 2) {
      const yaml = String(last?.yaml ?? "").replace("amount: 1.8", "amount: 7.7")
      return { name: "propose_yaml_edit", arguments: JSON.stringify({ yaml, basedOnVersion: last?.version }) }
    }
    return null
  })
  await openChat(page)
  await ask(page, "Raise the first CO2 emission")

  // The review comes before the commit: the diff is open on arrival, without
  // having to save first and go looking in the history panel.
  const pending = page.locator(".yaml-pending-diff")
  await expect(pending).toBeVisible()
  await expect(pending).toHaveAttribute("open", "")
  await expect(pending).toContainText("Assistant proposed these changes")
  await expect(pending.locator(".history-diff .is-removed")).toContainText("amount: 1.8")
  await expect(pending.locator(".history-diff .is-added")).toContainText("amount: 7.7")

  // And it goes away once the change is committed.
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(pending).toHaveCount(0)
})

test("your own edits get the same review, but collapsed", async ({ page }) => {
  await mockAssistant(page, () => null)
  await openChat(page)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("amount: 1.8", "amount: 2.2"))

  const pending = page.locator(".yaml-pending-diff")
  await expect(pending).toBeVisible()
  await expect(pending).toContainText("Unsaved changes")
  // Closed by default: your own typing does not need explaining back to you.
  await expect(pending).not.toHaveAttribute("open", "")
  await pending.locator("summary").click()
  await expect(pending.locator(".history-diff .is-added")).toContainText("amount: 2.2")
})
