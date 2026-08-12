import { expect, test } from "@playwright/test"
import { calculate, expectInsideViewport, mockLcaApi, pageMetrics } from "./helpers"

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
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
  await page.getByRole("radio", { name: "Editor", exact: true }).click()

  await expectInsideViewport(page.locator(".yaml-editor"), page)
  await expect(page.getByRole("button", { name: "Paste YAML" })).toBeVisible()
  await expect(page.locator(".yaml-upload")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible()
})

test("analysis views contain their tables without page overflow", async ({ page }) => {
  await calculate(page)

  const views = [
    { name: "Inventory", root: ".inventory-view", tableWrap: ".inventory-table-wrap" },
    { name: "Impact Analysis", root: ".impact-view", tableWrap: ".impact-table-wrap" },
    { name: "Process Results", root: ".process-results-view", tableWrap: ".process-impact-table-wrap" },
    { name: "Contribution", root: ".contribution-view", tableWrap: ".contribution-table-wrap" },
  ]

  for (const view of views) {
    await page.getByRole("radio", { name: view.name, exact: true }).click()
    await expectInsideViewport(page.locator(view.root), page)
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
  await page.getByRole("radio", { name: "Sankey Graph", exact: true }).click()
  await expectInsideViewport(page.locator(".sankey-view"), page)
  expect(await page.locator(".sankey-process-node").count()).toBeGreaterThan(0)

  await page.getByRole("button", { name: "Chart settings" }).click()
  await expectInsideViewport(page.locator(".sankey-chart-picker"), page)
})
