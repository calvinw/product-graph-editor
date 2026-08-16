import { expect, test } from "@playwright/test"
import { productGraphTemplatesFixture } from "../fixtures/product-graph-templates"
import { calculate, expectInsideViewport, mockLcaApi, openAnalysisView, pageMetrics } from "./helpers"

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
})

test("graph controls, settings, and node inspector remain reachable", async ({ page }) => {
  await expectInsideViewport(page.locator(".graph-toolbar"), page)
  await expectInsideViewport(page.locator(".graph-search"), page)

  await page.getByRole("button", { name: "Graph settings" }).click()
  await expectInsideViewport(page.locator(".graph-settings-picker"), page)
  await page.getByRole("button", { name: "Close graph settings" }).click()

  await page.locator(".react-flow__node").last().click()
  await expectInsideViewport(page.locator(".inspector"), page)
  await expect(page.getByRole("button", { name: "Close property editor" })).toBeVisible()
})

test("editor actions and source remain reachable", async ({ page }) => {
  await page.getByRole("radio", { name: "Edit", exact: true }).click()

  await expectInsideViewport(page.locator(".yaml-editor"), page)
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save As..." })).toBeVisible()
  await expect(page.getByText("Paste YAML", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "File", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Upload YAML..." })).toBeVisible()
  await expectInsideViewport(page.getByRole("menu", { name: "File", exact: true }), page)
  await page.getByRole("menuitem", { name: "Templates..." }).click()
  const templatesMenu = page.getByRole("menu", { name: "Templates..." })
  await expectInsideViewport(templatesMenu, page)
  await expect(templatesMenu.getByRole("menuitem")).toHaveCount(productGraphTemplatesFixture.product_graphs.length)
  await expect(templatesMenu.getByRole("menuitem", { name: "Jacket", exact: true })).toBeVisible()
  await expect(templatesMenu.getByRole("menuitem", { name: "Cotton Fiber", exact: true })).toBeVisible()
  await expect(templatesMenu.getByRole("menuitem", { name: "Simple Mock Plastic Broom", exact: true })).toBeVisible()
})

test("analysis views contain their tables without page overflow", async ({ page }) => {
  await calculate(page)

  const views = [
    { name: "Inventory", title: "Inventory results", root: ".inventory-view", tableWrap: ".inventory-table-wrap" },
    { name: "Impact Analysis", title: "Impact analysis", root: ".impact-view", tableWrap: ".impact-table-wrap" },
    { name: "Process Results", title: "Process results", root: ".process-results-view", tableWrap: ".process-impact-table-wrap" },
    { name: "Contribution", title: "Contribution analysis", root: ".contribution-view", tableWrap: ".contribution-table-wrap" },
  ]

  for (const view of views) {
    await openAnalysisView(page, view.name)
    await expectInsideViewport(page.locator(view.root), page)
    await expect(page.locator(view.root).getByText(view.title, { exact: true })).toBeVisible()
    if ((page.viewportSize()?.width ?? 0) > 900) {
      const [navbarBox, viewBox] = await Promise.all([
        page.locator(".topbar").boundingBox(),
        page.locator(view.root).boundingBox(),
      ])
      expect(navbarBox).not.toBeNull()
      expect(viewBox).not.toBeNull()
      if (navbarBox && viewBox) expect(viewBox.y).toBeGreaterThanOrEqual(navbarBox.y + navbarBox.height + 16)
    }
    await expect(page.locator(view.tableWrap).first()).toBeVisible()
    const metrics = await pageMetrics(page)
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  }
})

test("global settings remain reachable", async ({ page }) => {
  await page.getByRole("button", { name: "Global settings" }).click()
  await expectInsideViewport(page.locator(".global-settings-panel"), page)
  await page.getByRole("button", { name: "Close global settings" }).click()
})

test("Sankey chart and settings remain reachable", async ({ page }) => {
  await calculate(page)
  await openAnalysisView(page, (page.viewportSize()?.width ?? 0) > 900 ? "Sankey" : "Sankey Graph")
  await expectInsideViewport(page.locator(".sankey-view"), page)
  expect(await page.locator(".sankey-process-node").count()).toBeGreaterThan(0)

  await page.getByRole("button", { name: "Chart settings" }).click()
  await expectInsideViewport(page.locator(".sankey-chart-picker"), page)
})
