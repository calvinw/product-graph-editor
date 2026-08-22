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
