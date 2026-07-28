import { expect, test, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"

type Theme = "dark" | "light"

async function mockLcaApi(
  page: Page,
  result = lcaResultFixture,
  onContributionRequest?: (categories: string[]) => void,
  contributionDelayMs = 0,
  baseDelayMs = 0,
) {
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/health")) {
      await route.fulfill({ json: { running: true } })
      return
    }
    if (pathname.endsWith("/api/tools")) {
      await route.fulfill({
        json: [
          {
            name: "run_lca_base",
            rest: { method: "POST", path: "/api/lca/base" },
          },
          {
            name: "get_lca_contribution_graphs",
            rest: { method: "POST", path: "/api/lca/contribution" },
          },
        ],
      })
      return
    }
    if (pathname.endsWith("/api/lca/base")) {
      if (baseDelayMs) await new Promise((resolve) => setTimeout(resolve, baseDelayMs))
      await route.fulfill({ json: { ...result, contribution_graphs: [] } })
      return
    }
    if (pathname.endsWith("/api/lca/contribution")) {
      const body = route.request().postDataJSON() as { categories?: string[] }
      const categories = body.categories ?? []
      onContributionRequest?.(categories)
      if (contributionDelayMs) await new Promise((resolve) => setTimeout(resolve, contributionDelayMs))
      await route.fulfill({
        json: {
          result_id: result.result_id,
          method: result.method,
          contribution_graphs: result.contribution_graphs.filter((graph) => (
            categories.some((category) => graph.label.includes(category))
          )),
        },
      })
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
  await expect(page.getByRole("radio", { name: "LCA Results", exact: true })).toBeChecked()
  await expect(page.locator(".markdown-report")).toBeVisible()
}

test("Calculate LCA applies YAML and opens the active results view", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)

  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const appliedSource = await editor.inputValue()
  await editor.fill(appliedSource.replace("Jacket", "Draft jacket"))
  await expect(page.getByText("Unapplied changes. Calculate LCA to apply this YAML.")).toBeVisible()

  await page.getByRole("radio", { name: "LCA Results", exact: true }).click()
  await expect(page.getByRole("button", { name: "Calculate LCA" })).toHaveCount(0)
  await expect(page.locator(".markdown-report")).toBeVisible()
  await expect(page.getByRole("radio", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  await editor.fill("not: [valid")
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await expect(page.locator(".yaml-error")).toBeVisible()
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Jacket" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  await editor.fill(appliedSource.replace("Jacket", "Calculated jacket"))
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await expect(page.getByRole("heading", { name: "Calculated jacket" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "LCA Results", exact: true })).toBeChecked()
  await expect(page.locator(".markdown-report")).toBeVisible()
  await expect(page.getByRole("radio", { name: "Inventory", exact: true })).toBeVisible()

  await page.getByRole("radio", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("radio", { name: "Inventory", exact: true })).toBeChecked()
  await expect(page.getByRole("radio", { name: "LCA Results", exact: true })).not.toBeChecked()
})

test("a calculation for an older applied revision cannot populate results", async ({ page }) => {
  let releaseCalculation: (() => void) | undefined
  let calculationCount = 0
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
      await route.fulfill({ json: [{ name: "run_lca_base", rest: { method: "POST", path: "/api/lca/base" } }] })
      return
    }
    if (pathname.endsWith("/api/lca/base")) {
      calculationCount += 1
      if (calculationCount === 1) releaseCalculation?.()
      await new Promise((resolve) => setTimeout(resolve, calculationCount === 1 ? 500 : 2_000))
      await route.fulfill({ json: lcaResultFixture }).catch(() => undefined)
      return
    }
    await route.abort("blockedbyclient")
  })

  await page.goto("/")
  await calculationRequested

  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "New revision"))
  await page.getByRole("button", { name: "Calculate LCA" }).click()
  await expect(page.getByRole("heading", { name: "New revision" })).toBeVisible()
  await page.waitForTimeout(650)

  await page.getByRole("radio", { name: "LCA Results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toHaveCount(0)
  await expect(page.locator(".results-placeholder")).toBeVisible()
  await expect(page.getByText("Calculating the currently applied product graph…")).toBeVisible()
})

test("toolbar tooltips open from keyboard focus and pointer input", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  const graphSettings = page.getByRole("button", { name: "Graph settings" })

  await graphSettings.focus()
  await expect(graphSettings).toBeFocused()
  await expect(page.getByRole("tooltip", { name: "Graph settings" })).toBeVisible()

  await page.reload()
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await graphSettings.hover()
  await expect(page.getByRole("tooltip", { name: "Graph settings" })).toBeVisible()
})

test("primary and result view switchers support arrow-key navigation", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()

  await page.getByRole("radio", { name: "Graph", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  const fileView = page.getByRole("radio", { name: "FILE", exact: true })
  await expect(fileView).toBeFocused()
  await page.keyboard.press("Space")
  await expect(fileView).toBeChecked()
  await expect(page.locator(".yaml-editor")).toBeVisible()

  await page.getByRole("radio", { name: "Inventory", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  const impactView = page.getByRole("radio", { name: "Impact Analysis", exact: true })
  await expect(impactView).toBeFocused()
  await page.keyboard.press("Space")
  await expect(impactView).toBeChecked()
  await expect(page.getByRole("radio", { name: "LCA Results", exact: true })).not.toBeChecked()
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
  await page.getByRole("radio", { name: "Impact Analysis", exact: true }).click()
  const processes = page.getByRole("radio", { name: "Processes", exact: true })
  await processes.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("radio", { name: "Flows", exact: true })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByRole("radio", { name: "Flows", exact: true })).toBeChecked()

  await page.getByRole("radio", { name: "Contribution", exact: true }).click()
  const impact = page.getByRole("radio", { name: "Impact category", exact: true })
  await impact.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("radio", { name: "Flow", exact: true })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByRole("radio", { name: "Flow", exact: true })).toBeChecked()

  await page.getByRole("radio", { name: "Sankey Graph", exact: true }).click()
  await page.getByRole("button", { name: "Chart settings" }).click()
  await page.getByRole("radio", { name: "Flow", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  const sankeyImpact = page.getByRole("radio", { name: "Impact", exact: true })
  await expect(sankeyImpact).toBeFocused()
  await page.keyboard.press("Space")
  await expect(sankeyImpact).toBeChecked()
})

test("form controls preserve selection, clamping, and disabled behavior", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()

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

  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  const caseStudy = page.getByRole("combobox", { name: "Choose a case study" })
  await caseStudy.click()
  await page.getByRole("option", { name: "Cotton Fiber", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Cotton Fiber" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "LCA Results", exact: true })).toBeChecked()
  await expect(page.locator(".markdown-report")).toBeVisible()

  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  await caseStudy.click()
  await page.getByRole("option", { name: "Simple Mock Plastic Broom", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Simple Mock Plastic Broom" })).toBeVisible()
  await page.getByRole("radio", { name: "FILE", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toHaveValue(/Mock freight transport, small truck, direct emissions only/)
})

test("settings popovers dismiss predictably and restore trigger focus", async ({ page }) => {
  await mockLcaApi(page)
  await page.goto("/")
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()

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

test("process results show calculated upstream outputs", async ({ page }) => {
  const resultWithBackgroundOutput = {
    ...lcaResultFixture,
    lci: {
      ...lcaResultFixture.lci,
      "Sulfur dioxide, air": { amount: 0.123, unit: "kg", type: "emission" },
    },
  }
  await mockLcaApi(page, resultWithBackgroundOutput)
  await page.goto("/")
  await calculate(page)

  await page.getByRole("radio", { name: "Process Results", exact: true }).click()
  const outputs = page.locator(".process-flow-grids section").filter({ has: page.getByRole("heading", { name: "Outputs" }) })

  await expect(outputs.getByText("Sulfur dioxide, air (SO2)")).toBeVisible()
  await expect(outputs.getByText("0.12")).toBeVisible()
  await expect(outputs.getByText("No output flows for this process.")).toHaveCount(0)

  const process = page.getByRole("combobox", { name: "Flow contribution process" })
  await process.click()
  await page.getByRole("option", { name: "Raw material extraction", exact: true }).click()
  const methane = outputs.getByRole("row").filter({ hasText: "Methane" })
  await expect(methane).toBeVisible()
  await expect(methane.getByRole("cell").nth(4)).toHaveText("0.02")
})

test("cumulative contribution graphs load only when an analysis pane opens", async ({ page }) => {
  const contributionRequests: string[][] = []
  await mockLcaApi(page, lcaResultFixture, (categories) => contributionRequests.push(categories))
  await page.goto("/")
  await calculate(page)

  expect(contributionRequests).toHaveLength(0)

  await page.getByRole("radio", { name: "Sankey Graph", exact: true }).click()
  await expect.poll(() => contributionRequests.length).toBe(1)
  expect(contributionRequests[0]).toEqual(
    Object.entries(lcaResultFixture.lcia)
      .filter(([, value]) => value.score !== 0)
      .map(([label]) => label),
  )
})

test("LCA Results shows progress during lazy contribution calculations", async ({ page }) => {
  await mockLcaApi(page, lcaResultFixture, undefined, 600)
  await page.goto("/")
  await calculate(page)

  await page.getByRole("radio", { name: "Impact Analysis", exact: true }).click()
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toBeVisible()
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toHaveCount(0)
})

test("Scaled Graph can be selected before the initial LCA finishes", async ({ page }) => {
  await mockLcaApi(page, lcaResultFixture, undefined, 0, 600)
  await page.goto("/")
  await page.getByRole("radio", { name: "Graph", exact: true }).click()

  const scaledGraph = page.getByRole("button", { name: "Scaled Graph" })
  await expect(scaledGraph).toBeEnabled()
  await scaledGraph.click()
  await expect(scaledGraph).toHaveAttribute("aria-pressed", "true")

  await expect(page.getByRole("radio", { name: "Inventory", exact: true })).toBeVisible()
  await expect(scaledGraph).toHaveAttribute("aria-pressed", "true")
})

for (const theme of ["dark", "light"] as const) {
  test(`${theme} application views`, async ({ page }) => {
    await mockLcaApi(page)
    await page.goto("/")
    await calculate(page)
    await page.getByRole("radio", { name: "Graph", exact: true }).click()
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

    await page.getByRole("radio", { name: "FILE", exact: true }).click()
    await expect(page.locator(".yaml-editor")).toBeVisible()
    await screenshot(page, `${theme}-yaml-editor.png`)

    await page.getByRole("radio", { name: "LCA Results", exact: true }).click()
    await expect(page.locator(".markdown-report")).toBeVisible()
    await screenshot(page, `${theme}-lca-results.png`)

    await page.getByRole("radio", { name: "Graph", exact: true }).click()
    await page.getByRole("button", { name: "Scaled Graph" }).click()
    await expect(page.getByRole("button", { name: "Scaled Graph" })).toHaveAttribute("aria-pressed", "true")
    await screenshot(page, `${theme}-scaled-graph.png`)

    await page.getByRole("radio", { name: "Inventory", exact: true }).click()
    await expect(page.locator(".inventory-view")).toBeVisible()
    await screenshot(page, `${theme}-inventory.png`)

    await page.getByRole("radio", { name: "Impact Analysis", exact: true }).click()
    await expect(page.locator(".impact-view")).toBeVisible()
    await screenshot(page, `${theme}-impact-analysis.png`)

    await page.getByRole("radio", { name: "Process Results", exact: true }).click()
    await expect(page.locator(".process-results-view")).toBeVisible()
    await screenshot(page, `${theme}-process-results.png`)

    await page.getByRole("radio", { name: "Contribution", exact: true }).click()
    await expect(page.locator(".contribution-view")).toBeVisible()
    await screenshot(page, `${theme}-contribution.png`)

    await page.getByRole("radio", { name: "Sankey Graph", exact: true }).click()
    await expect(page.locator(".sankey-process-node")).toHaveCount(5)
    await screenshot(page, `${theme}-sankey.png`)

    await page.getByRole("button", { name: "Chart settings" }).click()
    await expect(page.locator(".sankey-chart-picker")).toBeVisible()
    await screenshot(page, `${theme}-sankey-chart-settings.png`)
  })
}
