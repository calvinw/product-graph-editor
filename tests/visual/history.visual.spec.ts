import { expect, test, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"
import { productGraphTemplatesFixture } from "../fixtures/product-graph-templates"

async function mockLcaApi(page: Page) {
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/product-graphs")) {
      await route.fulfill({ json: productGraphTemplatesFixture })
      return
    }
    if (pathname.endsWith("/api/health")) {
      await route.fulfill({ json: { running: true } })
      return
    }
    if (pathname.endsWith("/api/tools")) {
      await route.fulfill({
        json: [{ name: "run_lca_base", rest: { method: "POST", path: "/api/lca/base" } }],
      })
      return
    }
    if (pathname.endsWith("/api/lca/base")) {
      await route.fulfill({ json: { ...lcaResultFixture, contribution_graphs: [] } })
      return
    }
    await route.abort("blockedbyclient")
  })
}

async function openWorkspace(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
}

const historyRows = (page: Page) => page.locator(".history-row")

async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Version history" }).click()
  await expect(page.locator(".history-panel")).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
})

test("the opened model is recorded as a baseline version", async ({ page }) => {
  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(1)
  await expect(historyRows(page).first()).toContainText("Opened")
  // The document has not moved since it was recorded, so it is the current one.
  await expect(historyRows(page).first()).toHaveClass(/is-current/)
  await expect(page.locator(".history-uncommitted")).toHaveCount(0)
})

test("an unsaved edit is flagged as not yet recorded, then becomes a version on save", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "Edited jacket"))

  await openHistory(page)
  await expect(page.locator(".history-uncommitted")).toBeVisible()
  await expect(historyRows(page)).toHaveCount(1)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Save", exact: true }).click()
  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(2)
  await expect(historyRows(page).first()).toContainText("Saved")
  await expect(page.locator(".history-uncommitted")).toHaveCount(0)
})

test("restoring an earlier version puts its document back without discarding the newer one", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const original = await editor.inputValue()
  await editor.fill(original.replace("Jacket", "Edited jacket"))
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor).toHaveValue(/Edited jacket/)

  // Restore the baseline, which is the older (lower) row.
  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(2)
  await historyRows(page).last().getByRole("button", { name: "Restore" }).click()
  await expect(editor).toHaveValue(original)

  // Restoring appends rather than truncating: the edited version survives and
  // can be returned to, which is the whole point of an append-only list.
  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(3)
  const savedRow = historyRows(page).filter({ hasText: "Saved" }).first()
  await savedRow.getByRole("button", { name: "Restore" }).click()
  await expect(editor).toHaveValue(/Edited jacket/)
})

test("each model keeps its own history", async ({ page }) => {
  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(1)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "File", exact: true }).click()
  await page.getByRole("menuitem", { name: "Templates..." }).click()
  await page.getByRole("menuitem", { name: "Cotton Fiber", exact: true }).click()

  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(1)
  await expect(historyRows(page).first()).toContainText("Copy of Cotton Fiber")
})

test("Cmd+Z outside a text field steps back a version, and Shift+Cmd+Z forward", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const original = await editor.inputValue()
  await editor.fill(original.replace("Jacket", "Edited jacket"))
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor).toHaveValue(/Edited jacket/)

  // Move focus out of the textarea: model undo only takes over outside a
  // text field, so that native per-keystroke undo keeps working inside one.
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await page.locator(".react-flow").click({ position: { x: 10, y: 10 } })
  await page.keyboard.press("ControlOrMeta+z")

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(editor).toHaveValue(original)

  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await page.locator(".react-flow").click({ position: { x: 10, y: 10 } })
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(editor).toHaveValue(/Edited jacket/)
})

test("Cmd+Z inside the YAML textarea is left to the browser", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })

  await editor.click()
  await editor.press("End")
  await editor.pressSequentially("# a comment")
  await expect(editor).toHaveValue(/# a comment/)

  // The browser's own undo steps character by character. What matters is that
  // model undo did NOT fire: that would swap the entire document for an
  // earlier version, removing the comment wholesale rather than trimming it.
  await editor.press("ControlOrMeta+z")
  await expect(editor).toHaveValue(/# a comme/)
})

test("leaving a dirty editor is guarded, and discarding records no spurious version", async ({ page }) => {
  // The plan expected the editor to unmount freely on a view switch, taking
  // its native undo stack with it. In this app that transition is already
  // guarded: a dirty draft prompts first, so both outcomes resolve the
  // dirtiness before the editor unmounts. The unmount capture therefore stays
  // as a cheap safety net rather than the primary protection it was designed
  // to be -- and, importantly, it must not add noise on the normal path.
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const original = await editor.inputValue()
  await editor.fill(original.replace("Jacket", "Draft only, never saved"))

  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByRole("heading", { name: "Unsaved YAML changes" })).toBeVisible()
  await dialog.getByRole("button", { name: "Discard changes" }).click()

  await openHistory(page)
  await expect(historyRows(page)).toHaveCount(1)
  await expect(historyRows(page).first()).toContainText("Opened")
  await page.keyboard.press("Escape")

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(editor).toHaveValue(original)
})

test("a version row shows what changed against the one before it", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("amount: 1.8", "amount: 9.9"))
  await page.getByRole("button", { name: "Save", exact: true }).click()

  await openHistory(page)
  const saved = historyRows(page).first()
  await expect(saved).toContainText("Saved")
  // The change stat is visible without expanding anything.
  await expect(saved.locator(".history-diff-stat")).toContainText("+1")
  await expect(saved.locator(".history-diff-stat")).toContainText("-1")

  await saved.getByText("What changed").click()
  const diff = saved.locator(".history-diff")
  await expect(diff.locator(".is-removed")).toContainText("amount: 1.8")
  await expect(diff.locator(".is-added")).toContainText("amount: 9.9")
  // Long unchanged stretches are collapsed rather than scrolled past.
  await expect(diff.locator(".history-diff-gap").first()).toContainText("unchanged line")
})

test("the first version has nothing to compare against", async ({ page }) => {
  await openHistory(page)
  const first = historyRows(page).first()
  await first.getByText("What changed").click()
  await expect(first).toContainText("First recorded version")
})

test("undo restores previously calculated scores without recalculating", async ({ page }) => {
  // Count calculation requests so a cache hit is observable rather than
  // merely assumed.
  let calculations = 0
  await page.route("**/lca-api/api/lca/base", async (route) => {
    calculations += 1
    await route.fulfill({ json: { ...lcaResultFixture, contribution_graphs: [] } })
  })

  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("amount: 1.8", "amount: 3.3"))
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect.poll(() => calculations).toBeGreaterThan(0)
  const afterSave = calculations

  // Restoring a document calculated earlier should not hit the engine again.
  await openHistory(page)
  await historyRows(page).filter({ hasText: "Opened" }).first().getByRole("button", { name: "Restore" }).click()
  await expect(editor).toHaveValue(/amount: 1\.8/)

  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()
  expect(calculations).toBe(afterSave)
})

test("session models survive a reload", async ({ page }) => {
  // sessionDocuments otherwise lives only in memory, so a refresh loses every
  // model made this session -- and the unload warning fires only while there
  // are unsaved changes, so saving properly is what lets the work go silently.
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket — 1 unit", "Survives a reload"))
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText("Saved in this browser session.")).toBeVisible()

  await page.reload()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toHaveValue(/Survives a reload/)
})

test("a fresh browser still opens the default model", async ({ page, context }) => {
  // The restore path must not strand someone with no persisted state.
  await context.clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await expect(page.locator('[aria-label="Current model: Copy of Jacket"]:visible')).toBeVisible()
})

test("version history survives a reload", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("amount: 1.8", "amount: 5.5"))
  await page.getByRole("button", { name: "Save", exact: true }).click()

  await openHistory(page)
  const before = await historyRows(page).count()
  expect(before).toBeGreaterThan(1)

  await page.reload()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await openHistory(page)
  // The earlier versions are still there, and still restorable.
  await expect(historyRows(page).filter({ hasText: "Saved" })).not.toHaveCount(0)
  await historyRows(page).filter({ hasText: "Opened" }).first().getByRole("button", { name: "Restore" }).click()
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toHaveValue(/amount: 1\.8/)
})
