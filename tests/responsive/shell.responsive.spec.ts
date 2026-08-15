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
    await expect(fileTitle).toHaveText("Jacket")
    await expect(fileTitle).toHaveCSS("border-top-width", "0px")
    await expect(fileTitle).toHaveCSS("border-radius", "0px")
    await expect(fileTitle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(fileTitle).toHaveCSS("text-overflow", "clip")
    await expect(fileTitle).toHaveCSS("overflow", "visible")
  } else {
    await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  }
  await expect(page.locator('[aria-label="Current model: Jacket"]:visible')).toBeVisible()
  await expect(page.getByRole("button", { name: "Model", exact: true })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Editor", exact: true })).toBeVisible()
  const results = (page.viewportSize()?.width ?? 0) > 900
    ? page.getByRole("button", { name: "Results", exact: true })
    : page.getByRole("radio", { name: "Results", exact: true })
  await expect(results).toBeVisible()
  await expect(page.locator(".react-flow")).toBeVisible()
})

test("page does not overflow horizontally", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Welcome to the Future of LCA" })).toBeVisible()
  const metrics = await pageMetrics(page)
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})

test("welcome page opens the workspace and the PRISM logo returns home", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Welcome to the Future of LCA" })).toBeVisible()
  await page.getByRole("button", { name: "Explore PRISM" }).click()
  await expect(page.locator(".react-flow")).toBeVisible()
  await page.getByRole("button", { name: "Open PRISM welcome page" }).click()
  await expect(page.getByRole("heading", { name: "Welcome to the Future of LCA" })).toBeVisible()
  await expect(page.locator(".react-flow")).toBeHidden()
})
