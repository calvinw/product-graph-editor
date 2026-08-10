import { expect, test } from "@playwright/test"
import { mockLcaApi, pageMetrics } from "./helpers"

test.beforeEach(async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
})

test("application shell and primary graph controls load", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Choose a product graph" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Editor", exact: true })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Results", exact: true })).toBeVisible()
  await expect(page.locator(".react-flow")).toBeVisible()
})

test("page does not overflow horizontally", async ({ page }) => {
  const metrics = await pageMetrics(page)
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})
