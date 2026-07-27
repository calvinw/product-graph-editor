import { expect, test, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"

type Theme = "dark" | "light"

async function mockLcaApi(page: Page) {
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/health")) {
      await route.fulfill({ json: { running: true } })
      return
    }
    if (pathname.endsWith("/api/tools")) {
      await route.fulfill({
        json: [{
          name: "run_lca",
          rest: { method: "POST", path: "/api/lca/run" },
        }],
      })
      return
    }
    if (pathname.endsWith("/api/lca/run")) {
      await route.fulfill({ json: lcaResultFixture })
      return
    }
    await route.abort("blockedbyclient")
  })
}

async function settle(page: Page) {
  await page.waitForTimeout(250)
}

async function screenshot(page: Page, name: string) {
  await settle(page)
  await expect(page).toHaveScreenshot(name)
}

async function selectTheme(page: Page, theme: Theme) {
  await page.getByRole("button", { name: "Global settings" }).click()
  if (theme === "light") {
    await page.getByRole("button", { name: "Light", exact: true }).click()
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
}

async function calculate(page: Page) {
  await page.getByRole("button", { name: "LCA Results", exact: true }).click()
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()
}

test("YAML drafts apply only through Preview Graph", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await calculate(page)

  await page.getByRole("button", { name: "FILE", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const appliedSource = await editor.inputValue()
  await editor.fill(appliedSource.replace("Jacket", "Draft jacket"))
  await expect(page.getByText("Unapplied changes. Preview changes before calculating.")).toBeVisible()

  await page.getByRole("button", { name: "LCA Results", exact: true }).click()
  await expect(page.getByRole("button", { name: "Calculate LCA" })).toBeDisabled()
  await expect(page.locator(".markdown-report")).toBeVisible()
  await expect(page.getByRole("button", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Graph", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await page.getByRole("button", { name: "FILE", exact: true }).click()
  await editor.fill("not: [valid")
  await page.getByRole("button", { name: "Preview graph" }).click()
  await expect(page.locator(".yaml-error")).toBeVisible()
  await page.getByRole("button", { name: "Graph", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "FILE", exact: true }).click()
  await editor.fill(appliedSource.replace("Jacket", "Previewed jacket"))
  await page.getByRole("button", { name: "Preview graph" }).click()
  await expect(page.getByRole("heading", { name: "Previewed jacket" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Inventory", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "LCA Results", exact: true }).click()
  await expect(page.getByRole("button", { name: "Calculate LCA" })).toBeEnabled()
  await expect(page.locator(".results-placeholder")).toBeVisible()
})

test("a calculation for an older applied revision cannot populate results", async ({ page }) => {
  let releaseCalculation: (() => void) | undefined
  const calculationRequested = new Promise<void>((resolve) => {
    releaseCalculation = resolve
  })
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/health")) {
      await route.fulfill({ json: { running: true } })
      return
    }
    if (pathname.endsWith("/api/tools")) {
      await route.fulfill({ json: [{ name: "run_lca", rest: { method: "POST", path: "/api/lca/run" } }] })
      return
    }
    if (pathname.endsWith("/api/lca/run")) {
      releaseCalculation?.()
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.fulfill({ json: lcaResultFixture }).catch(() => undefined)
      return
    }
    await route.abort("blockedbyclient")
  })

  await page.goto("/")
  await page.getByRole("button", { name: "LCA Results", exact: true }).click()
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await calculationRequested

  await page.getByRole("button", { name: "FILE", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "New revision"))
  await page.getByRole("button", { name: "Preview graph" }).click()
  await expect(page.getByRole("heading", { name: "New revision" })).toBeVisible()
  await page.waitForTimeout(650)

  await page.getByRole("button", { name: "LCA Results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toHaveCount(0)
  await expect(page.locator(".results-placeholder")).toBeVisible()
  await expect(page.getByRole("button", { name: "Calculate LCA" })).toBeEnabled()
})

for (const theme of ["dark", "light"] as const) {
  test(`${theme} application views`, async ({ page }) => {
    await mockLcaApi(page)
    await page.goto("/")
    await expect(page.locator(".react-flow__node")).toHaveCount(5)

    await selectTheme(page, theme)
    await screenshot(page, `${theme}-global-settings.png`)
    await page.getByRole("button", { name: "Close global settings" }).click()

    await screenshot(page, `${theme}-structure-graph.png`)

    await page.locator(".react-flow__node").last().click()
    await expect(page.locator(".inspector")).toBeVisible()
    await screenshot(page, `${theme}-selected-node-inspector.png`)
    await page.getByRole("button", { name: "Close property editor" }).click()

    await page.getByRole("button", { name: "Graph settings" }).click()
    await expect(page.locator(".graph-settings-picker")).toBeVisible()
    await screenshot(page, `${theme}-graph-settings.png`)
    await page.getByRole("button", { name: "Close graph settings" }).click()

    await page.getByRole("button", { name: "FILE", exact: true }).click()
    await expect(page.locator(".yaml-editor")).toBeVisible()
    await screenshot(page, `${theme}-yaml-editor.png`)

    await page.getByRole("button", { name: "LCA Results", exact: true }).click()
    await expect(page.locator(".results-placeholder")).toBeVisible()
    await screenshot(page, `${theme}-lca-results-empty.png`)

    await calculate(page)
    await screenshot(page, `${theme}-lca-results.png`)

    await page.getByRole("button", { name: "Graph", exact: true }).click()
    await page.getByRole("button", { name: "Scaled Graph" }).click()
    await expect(page.getByRole("button", { name: "Scaled Graph" })).toHaveAttribute("aria-pressed", "true")
    await screenshot(page, `${theme}-scaled-graph.png`)

    await page.getByRole("button", { name: "Inventory", exact: true }).click()
    await expect(page.locator(".inventory-view")).toBeVisible()
    await screenshot(page, `${theme}-inventory.png`)

    await page.getByRole("button", { name: "Impact Analysis", exact: true }).click()
    await expect(page.locator(".impact-view")).toBeVisible()
    await screenshot(page, `${theme}-impact-analysis.png`)

    await page.getByRole("button", { name: "Process Results", exact: true }).click()
    await expect(page.locator(".process-results-view")).toBeVisible()
    await screenshot(page, `${theme}-process-results.png`)

    await page.getByRole("button", { name: "Contribution", exact: true }).click()
    await expect(page.locator(".contribution-view")).toBeVisible()
    await screenshot(page, `${theme}-contribution.png`)

    await page.getByRole("button", { name: "Sankey Graph", exact: true }).click()
    await expect(page.locator(".sankey-process-node")).toHaveCount(5)
    await screenshot(page, `${theme}-sankey.png`)
  })
}
