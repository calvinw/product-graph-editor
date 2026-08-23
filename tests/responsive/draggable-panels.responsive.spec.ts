import { expect, test } from "@playwright/test"
import { mockLcaApi } from "./helpers"

const GRAPH_TOOLBAR_KEY = "product-graph-editor:graph-toolbar-position"

/**
 * A stored toolbar position is absolute pixels. Coordinates saved on a large
 * window used to be restored verbatim, stranding the toolbar outside a smaller
 * viewport -- unrecoverable, because its drag handle went with it.
 */
async function seedToolbarPosition(page: import("@playwright/test").Page, position: { left: number; top: number }) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [GRAPH_TOOLBAR_KEY, JSON.stringify(position)] as const,
  )
}

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
})

test("a toolbar position saved off-screen is pulled back into the viewport", async ({ page }) => {
  await seedToolbarPosition(page, { left: 4000, top: 3000 })
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()

  const toolbar = page.locator(".graph-toolbar").first()
  await expect(toolbar).toBeVisible()

  const viewport = page.viewportSize()!
  const box = (await toolbar.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x).toBeLessThanOrEqual(viewport.width - 1)
  expect(box.y).toBeLessThanOrEqual(viewport.height - 1)

  // The corrected position is persisted, so it survives the next load.
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), GRAPH_TOOLBAR_KEY)
  expect(stored).not.toBeNull()
  const parsed = JSON.parse(stored!) as { left: number; top: number }
  expect(parsed.left).toBeLessThan(viewport.width)
  expect(parsed.top).toBeLessThan(viewport.height)
})

test("the toolbar drag handle stays reachable after the viewport shrinks", async ({ page }) => {
  const viewport = page.viewportSize()!
  await seedToolbarPosition(page, { left: Math.max(8, viewport.width - 80), top: Math.max(8, viewport.height - 120) })
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()

  const toolbar = page.locator(".graph-toolbar").first()
  await expect(toolbar).toBeVisible()

  await page.setViewportSize({ width: Math.round(viewport.width / 2), height: Math.round(viewport.height / 2) })
  await expect(toolbar).toBeVisible()

  const grip = toolbar.getByRole("button", { name: /Move .*toolbar/i })
  await expect(grip).toBeVisible()

  const shrunk = page.viewportSize()!
  const gripBox = (await grip.boundingBox())!
  expect(gripBox.x).toBeGreaterThanOrEqual(0)
  expect(gripBox.y).toBeGreaterThanOrEqual(0)
  expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(shrunk.width)
  expect(gripBox.y + gripBox.height).toBeLessThanOrEqual(shrunk.height)
})
