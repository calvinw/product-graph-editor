import { expect, test } from "@playwright/test"
import { mockLcaApi, pageMetrics } from "./helpers"

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
})

test("application shell and primary graph controls load", async ({ page }) => {
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  if ((page.viewportSize()?.width ?? 0) > 900) {
    await expect(page.getByText("PRISM Life Cycle Assessment", { exact: true })).toBeVisible()
    const fileTitle = page.locator(".navbar-model-title")
    await expect(fileTitle).toHaveText("Copy of Jacket")
    await expect(fileTitle).toHaveCSS("border-top-width", "0px")
    await expect(fileTitle).toHaveCSS("border-radius", "0px")
    await expect(fileTitle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(fileTitle).toHaveCSS("text-overflow", "clip")
    await expect(fileTitle).toHaveCSS("overflow", "visible")
  } else {
    await expect(page.getByRole("heading", { name: "Copy of Jacket" })).toBeVisible()
  }
  await expect(page.locator('[aria-label="Current model: Copy of Jacket"]:visible')).toBeVisible()
  await expect(page.getByRole("button", { name: "File", exact: true })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Edit", exact: true })).toBeVisible()
  const results = (page.viewportSize()?.width ?? 0) > 900
    ? page.getByRole("button", { name: "Results", exact: true })
    : page.getByRole("radio", { name: "Results", exact: true })
  await expect(results).toBeVisible()
  await expect(page.locator(".react-flow")).toBeVisible()
  await expect(page.locator(".react-flow__node .pg-node").first()).toHaveCSS("font-size", "24px")
})

test("page does not overflow horizontally", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Welcome to the Future of LCA" })).toBeVisible()
  const metrics = await pageMetrics(page)
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})

test("the fitted graph keeps every visible node inside its canvas", async ({ page }) => {
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await expect(page.locator(".react-flow__node:visible").first()).toBeVisible()
  await page.waitForTimeout(100)
  const [canvas, nodes] = await Promise.all([
    page.locator(".react-flow").boundingBox(),
    page.locator(".react-flow__node:visible").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
    })),
  ])
  expect(canvas).not.toBeNull()
  expect(nodes).not.toHaveLength(0)
  if (!canvas) return
  for (const node of nodes) {
    expect(node.left).toBeGreaterThanOrEqual(canvas.x)
    expect(node.top).toBeGreaterThanOrEqual(canvas.y)
    expect(node.right).toBeLessThanOrEqual(canvas.x + canvas.width)
    expect(node.bottom).toBeLessThanOrEqual(canvas.y + canvas.height)
  }
})

test("welcome page opens the workspace and the PRISM logo returns home", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Welcome to the Future of LCA" })).toBeVisible()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await expect(page.locator(".react-flow")).toBeVisible()
  await page.getByRole("button", { name: "Open PRISM welcome page" }).click()
  await expect(page.getByRole("heading", { name: "Welcome to the Future of LCA" })).toBeVisible()
  await expect(page.locator(".react-flow")).toBeHidden()
})

test("the model title never runs under the File menu", async ({ page }) => {
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  const title = page.locator(".navbar-model-title")
  if (!await title.isVisible()) {
    test.skip(true, "The desktop navbar title is not rendered at this width.")
    return
  }
  const titleBox = await title.boundingBox()
  const fileBox = await page.getByRole("button", { name: "File" }).boundingBox()
  expect(titleBox).not.toBeNull()
  expect(fileBox).not.toBeNull()
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(fileBox!.x)
})
