import { expect, test, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"
import { productGraphTemplatesFixture } from "../fixtures/product-graph-templates"

async function mockLcaApi(page: Page) {
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/product-graphs")) return route.fulfill({ json: productGraphTemplatesFixture })
    if (pathname.endsWith("/api/health")) return route.fulfill({ json: { running: true } })
    if (pathname.endsWith("/api/tools")) return route.fulfill({ json: [{ name: "run_lca_base", rest: { method: "POST", path: "/api/lca/base" } }] })
    if (pathname.endsWith("/api/lca/base")) return route.fulfill({ json: { ...lcaResultFixture, contribution_graphs: [] } })
    await route.abort("blockedbyclient")
  })
}

const nodes = (page: Page) => page.locator(".react-flow__node")
const selected = (page: Page) => page.locator(".react-flow__node.selected")

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await nodes(page).first().waitFor()
})

test("Cmd+click adds nodes to the selection", async ({ page }) => {
  await nodes(page).nth(0).click()
  await expect(selected(page)).toHaveCount(1)

  await nodes(page).nth(1).click({ modifiers: ["ControlOrMeta"] })
  await expect(selected(page)).toHaveCount(2)

  await nodes(page).nth(2).click({ modifiers: ["ControlOrMeta"] })
  await expect(selected(page)).toHaveCount(3)

  // The count is surfaced, since multi-select is otherwise easy to miss.
  await expect(page.locator(".graph-meta")).toContainText("3 selected")
})

test("Shift+click also adds, since box-select lives on Alt", async ({ page }) => {
  await nodes(page).nth(0).click()
  await nodes(page).nth(1).click({ modifiers: ["Shift"] })
  await expect(selected(page)).toHaveCount(2)
})

test("Cmd+click does not open the single-node property editor", async ({ page }) => {
  // This is what made multi-select look broken: the editor opened on the last
  // node clicked and panned the camera toward it.
  await nodes(page).nth(0).click({ modifiers: ["ControlOrMeta"] })
  await nodes(page).nth(1).click({ modifiers: ["ControlOrMeta"] })
  await expect(selected(page)).toHaveCount(2)
  await expect(page.locator(".inspector")).toBeHidden()
})

test("Cmd+clicking after a plain click closes the editor rather than leaving it stale", async ({ page }) => {
  await nodes(page).nth(0).click()
  await expect(page.locator(".inspector")).toBeVisible()

  await nodes(page).nth(1).click({ modifiers: ["ControlOrMeta"] })
  await expect(page.locator(".inspector")).toBeHidden()
  await expect(selected(page)).toHaveCount(2)
})

test("a plain click collapses the selection back to one node", async ({ page }) => {
  await nodes(page).nth(0).click()
  await nodes(page).nth(1).click({ modifiers: ["ControlOrMeta"] })
  await expect(selected(page)).toHaveCount(2)

  await nodes(page).nth(3).click()
  await expect(selected(page)).toHaveCount(1)
  await expect(page.locator(".graph-meta")).not.toContainText("selected")
  await expect(page.locator(".inspector")).toBeVisible()
})

test("multi-selected nodes move together as a group", async ({ page }) => {
  await nodes(page).nth(0).click()
  await nodes(page).nth(1).click({ modifiers: ["ControlOrMeta"] })
  await expect(selected(page)).toHaveCount(2)

  const before = await Promise.all([nodes(page).nth(0).boundingBox(), nodes(page).nth(1).boundingBox()])
  const handle = await nodes(page).nth(0).boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle!.x + handle!.width / 2 + 80, handle!.y + handle!.height / 2 + 40, { steps: 8 })
  await page.mouse.up()

  const after = await Promise.all([nodes(page).nth(0).boundingBox(), nodes(page).nth(1).boundingBox()])
  // Both moved, and by the same amount: that is what makes the selection useful.
  expect(Math.round(after[0]!.x - before[0]!.x)).toBeGreaterThan(40)
  expect(Math.round(after[1]!.x - before[1]!.x)).toBeGreaterThan(40)
})
