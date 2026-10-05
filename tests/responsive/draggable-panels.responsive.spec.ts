import { expect, test } from "@playwright/test"
import { mockLcaApi } from "./helpers"

const GRAPH_TOOLBAR_KEY = "product-graph-editor:graph-toolbar-position-horizontal"

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

  // The browser fires "resize" asynchronously after setViewportSize, and the
  // app re-clamps the toolbar in that handler, so retry until it has settled.
  const shrunk = page.viewportSize()!
  await expect(async () => {
    const gripBox = (await grip.boundingBox())!
    expect(gripBox.x).toBeGreaterThanOrEqual(0)
    expect(gripBox.y).toBeGreaterThanOrEqual(0)
    expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(shrunk.width)
    expect(gripBox.y + gripBox.height).toBeLessThanOrEqual(shrunk.height)
  }).toPass({ timeout: 5_000 })
})

test("the graph tool bar cannot be dragged out of the graph canvas", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  const toolbar = page.locator(".graph-toolbar").first()
  const canvas = page.locator(".graph-viewport")
  await expect(toolbar).toBeVisible()
  const grip = toolbar.getByRole("button", { name: /Move .*toolbar/i })

  const expectInsideCanvas = async () => {
    await expect(async () => {
      const bar = (await toolbar.boundingBox())!
      const frame = (await canvas.boundingBox())!
      expect(bar.x).toBeGreaterThanOrEqual(frame.x)
      expect(bar.y).toBeGreaterThanOrEqual(frame.y)
      expect(bar.x + bar.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(bar.y + bar.height).toBeLessThanOrEqual(frame.y + frame.height)
    }).toPass({ timeout: 3_000 })
  }
  const dragGripTo = async (x: number, y: number) => {
    const box = (await grip.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 10 })
    await page.mouse.up()
  }

  const viewport = page.viewportSize()!
  await dragGripTo(5, 5) // over the navbar and the window corner
  await expectInsideCanvas()
  await dragGripTo(viewport.width - 5, viewport.height - 5)
  await expectInsideCanvas()
  await dragGripTo(-200, viewport.height / 2)
  await expectInsideCanvas()

  // Opening the chat narrows the canvas; the tool bar is pulled back inside.
  if (viewport.width > 620) {
    await dragGripTo(5, viewport.height / 2)
    await page.getByRole("button", { name: "Open AI assistant" }).click()
    await expectInsideCanvas()
  }
})
