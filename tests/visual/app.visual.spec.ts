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
    await page.getByRole("radio", { name: "Light", exact: true }).click()
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
}

async function calculate(page: Page) {
  await page.getByRole("tab", { name: "LCA Results", exact: true }).click()
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()
}

test("YAML drafts apply only through Preview Graph", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await calculate(page)

  await page.getByRole("tab", { name: "FILE", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const appliedSource = await editor.inputValue()
  await editor.fill(appliedSource.replace("Jacket", "Draft jacket"))
  await expect(page.getByText("Unapplied changes. Preview changes before calculating.")).toBeVisible()

  await page.getByRole("tab", { name: "LCA Results", exact: true }).click()
  await expect(page.getByRole("button", { name: "Calculate LCA" })).toBeDisabled()
  await expect(page.locator(".markdown-report")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("tab", { name: "Graph", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await page.getByRole("tab", { name: "FILE", exact: true }).click()
  await editor.fill("not: [valid")
  await page.getByRole("button", { name: "Preview graph" }).click()
  await expect(page.locator(".yaml-error")).toBeVisible()
  await page.getByRole("tab", { name: "Graph", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("tab", { name: "FILE", exact: true }).click()
  await editor.fill(appliedSource.replace("Jacket", "Previewed jacket"))
  await page.getByRole("button", { name: "Preview graph" }).click()
  await expect(page.getByRole("heading", { name: "Previewed jacket" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "LCA Results", exact: true }).click()
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
  await page.getByRole("tab", { name: "LCA Results", exact: true }).click()
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await calculationRequested

  await page.getByRole("tab", { name: "FILE", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "New revision"))
  await page.getByRole("button", { name: "Preview graph" }).click()
  await expect(page.getByRole("heading", { name: "New revision" })).toBeVisible()
  await page.waitForTimeout(650)

  await page.getByRole("tab", { name: "LCA Results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toHaveCount(0)
  await expect(page.locator(".results-placeholder")).toBeVisible()
  await expect(page.getByRole("button", { name: "Calculate LCA" })).toBeEnabled()
})

test("toolbar tooltips open from keyboard focus and pointer input", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  const graphSettings = page.getByRole("button", { name: "Graph settings" })

  await graphSettings.focus()
  await expect(graphSettings).toBeFocused()
  await expect(page.getByRole("tooltip", { name: "Graph settings" })).toBeVisible()

  await page.reload()
  await graphSettings.hover()
  await expect(page.getByRole("tooltip", { name: "Graph settings" })).toBeVisible()
})

test("primary and result tabs support arrow-key navigation", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")

  const graphTab = page.getByRole("tab", { name: "Graph", exact: true })
  await graphTab.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tab", { name: "FILE", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".yaml-editor")).toBeVisible()

  await calculate(page)
  const inventoryTab = page.getByRole("tab", { name: "Inventory", exact: true })
  await inventoryTab.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tab", { name: "Impact Analysis", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab", { name: "LCA Results", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".impact-view")).toBeVisible()
})

test("theme, analysis, and Sankey selection groups support keyboard navigation", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")

  await page.getByRole("button", { name: "Global settings" }).click()
  const darkTheme = page.getByRole("radio", { name: "Dark", exact: true })
  await darkTheme.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.getByRole("button", { name: "Close global settings" }).click()

  await calculate(page)
  await page.getByRole("tab", { name: "Impact Analysis", exact: true }).click()
  const processes = page.getByRole("radio", { name: "Processes", exact: true })
  await processes.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("radio", { name: "Flows", exact: true })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByRole("radio", { name: "Flows", exact: true })).toBeChecked()

  await page.getByRole("tab", { name: "Contribution", exact: true }).click()
  const impact = page.getByRole("radio", { name: "Impact category", exact: true })
  await impact.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("radio", { name: "Flow", exact: true })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByRole("radio", { name: "Flow", exact: true })).toBeChecked()

  await page.getByRole("tab", { name: "Sankey Graph", exact: true }).click()
  await page.getByRole("button", { name: "Chart settings" }).click()
  const flowTab = page.getByRole("tab", { name: "Flow", exact: true })
  await flowTab.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tab", { name: "Impact", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("form controls preserve selection, clamping, and disabled behavior", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")

  await page.getByRole("button", { name: "Graph settings" }).click()
  const orientation = page.getByRole("combobox", { name: "Graph orientation" })
  await orientation.click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(orientation).toHaveText(/Horizontal/)
  await expect(page.locator(".graph-settings-picker")).toBeVisible()

  const graphMaximum = page.getByRole("spinbutton", { name: "Graph maximum processes" })
  await graphMaximum.fill("999")
  await expect(graphMaximum).toHaveValue("5")
  await page.getByRole("button", { name: "Close graph settings" }).click()

  await page.getByRole("button", { name: "Global settings" }).click()
  const decimalPlaces = page.getByRole("spinbutton", { name: "Decimal places" })
  await page.getByRole("button", { name: "Increase decimal places" }).click()
  await expect(decimalPlaces).toHaveValue("3")
  await page.getByRole("checkbox", { name: "Show all decimal places" }).click()
  await expect(decimalPlaces).toBeDisabled()
  await expect(page.getByRole("button", { name: "Decrease decimal places" })).toBeDisabled()
  await page.getByRole("checkbox", { name: "Show all decimal places" }).click()
  await expect(decimalPlaces).toBeEnabled()
  await page.getByRole("button", { name: "Close global settings" }).click()

  await page.getByRole("tab", { name: "FILE", exact: true }).click()
  const caseStudy = page.getByRole("combobox", { name: "Choose a case study" })
  await caseStudy.click()
  await page.getByRole("option", { name: "Cotton Fiber", exact: true }).click()
  await expect(caseStudy).toHaveText(/Cotton Fiber/)
  await expect(page.getByText("Unapplied changes. Preview changes before calculating.")).toBeVisible()
})

test("settings popovers dismiss predictably and restore trigger focus", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")

  const graphSettings = page.getByRole("button", { name: "Graph settings" })
  await graphSettings.click()
  await page.getByRole("combobox", { name: "Graph orientation" }).click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(page.locator(".graph-settings-picker")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".graph-settings-picker")).toBeHidden()
  await expect(graphSettings).toBeFocused()

  await graphSettings.click()
  await page.mouse.click(700, 700)
  await expect(page.locator(".graph-settings-picker")).toBeHidden()

  const globalSettings = page.getByRole("button", { name: "Global settings" })
  await globalSettings.click()
  await page.keyboard.press("Escape")
  await expect(page.locator(".global-settings-panel")).toBeHidden()
  await expect(globalSettings).toBeFocused()

  await globalSettings.click()
  await page.mouse.click(700, 700)
  await expect(page.locator(".global-settings-panel")).toBeHidden()
  await expect(page.locator(".global-settings-backdrop, .graph-settings-backdrop")).toHaveCount(0)
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

    await page.getByRole("tab", { name: "FILE", exact: true }).click()
    await expect(page.locator(".yaml-editor")).toBeVisible()
    await screenshot(page, `${theme}-yaml-editor.png`)

    await page.getByRole("tab", { name: "LCA Results", exact: true }).click()
    await expect(page.locator(".results-placeholder")).toBeVisible()
    await screenshot(page, `${theme}-lca-results-empty.png`)

    await calculate(page)
    await screenshot(page, `${theme}-lca-results.png`)

    await page.getByRole("tab", { name: "Graph", exact: true }).click()
    await page.getByRole("button", { name: "Scaled Graph" }).click()
    await expect(page.getByRole("button", { name: "Scaled Graph" })).toHaveAttribute("aria-pressed", "true")
    await screenshot(page, `${theme}-scaled-graph.png`)

    await page.getByRole("tab", { name: "Inventory", exact: true }).click()
    await expect(page.locator(".inventory-view")).toBeVisible()
    await screenshot(page, `${theme}-inventory.png`)

    await page.getByRole("tab", { name: "Impact Analysis", exact: true }).click()
    await expect(page.locator(".impact-view")).toBeVisible()
    await screenshot(page, `${theme}-impact-analysis.png`)

    await page.getByRole("tab", { name: "Process Results", exact: true }).click()
    await expect(page.locator(".process-results-view")).toBeVisible()
    await screenshot(page, `${theme}-process-results.png`)

    await page.getByRole("tab", { name: "Contribution", exact: true }).click()
    await expect(page.locator(".contribution-view")).toBeVisible()
    await screenshot(page, `${theme}-contribution.png`)

    await page.getByRole("tab", { name: "Sankey Graph", exact: true }).click()
    await expect(page.locator(".sankey-process-node")).toHaveCount(5)
    await screenshot(page, `${theme}-sankey.png`)
  })
}
