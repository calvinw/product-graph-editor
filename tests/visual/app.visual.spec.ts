import { expect, test, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"
import { productGraphTemplatesFixture } from "../fixtures/product-graph-templates"
import type { LcaResult } from "../../src/lib/lcaApi"

type Theme = "dark" | "light"

async function openTemplates(page: Page) {
  await page.getByRole("menuitem", { name: "Templates..." }).click()
}

async function mockLcaApi(
  page: Page,
  result: LcaResult = lcaResultFixture,
  onContributionRequest?: (categories: string[]) => void,
  contributionDelayMs = 0,
  baseDelayMs = 0,
  baseFailureOnRequest?: number,
) {
  let baseRequestCount = 0
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/product-graphs")) {
      await route.fulfill({ json: productGraphTemplatesFixture })
      return
    }
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
      baseRequestCount += 1
      if (baseDelayMs) await new Promise((resolve) => setTimeout(resolve, baseDelayMs))
      if (baseRequestCount === baseFailureOnRequest) {
        await route.fulfill({ status: 503, json: { detail: "Calculation engine unavailable." } })
        return
      }
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

async function openWorkspace(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "Explore PRISM" }).click()
}

async function uploadYaml(page: Page, name: string, source: string) {
  await page.locator(".navbar-file-input").evaluate((input, file) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([file.source], file.name, { type: "text/yaml" }))
    ;(input as HTMLInputElement).files = transfer.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, { name, source })
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
  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  const report = page.locator(".markdown-report")
  await expect(report).toBeVisible()
  await expect(report.locator("h1")).toHaveCount(0)
  await expect(report.locator("p").first()).toContainText("Method:")
}

async function expectAnalysisAvailability(page: Page, name: string, enabled: boolean) {
  await page.getByRole("button", { name: "Results", exact: true }).click()
  const item = page.getByRole("menuitem", { name, exact: true })
  if (enabled) await expect(item).toBeEnabled()
  else await expect(item).toBeDisabled()
  await page.keyboard.press("Escape")
}

async function openDesktopAnalysis(page: Page, name: string, root: string) {
  const results = page.getByRole("button", { name: "Results", exact: true })
  await expect(results).toBeEnabled()
  await results.click()
  await page.getByRole("menuitem", { name, exact: true }).click()
  await expect(page.locator(root)).toBeVisible()
}

test("template drafts must be saved as a session model or discarded before navigation", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const appliedSource = await editor.inputValue()
  await editor.fill(appliedSource.replace("Jacket", "Draft jacket"))
  await expect(page.getByText("Unsaved draft. Save As to create a session model.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save As..." })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Results", exact: true })).toBeVisible()

  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByRole("heading", { name: "Unsaved YAML changes" })).toBeVisible()
  await expect(dialog).toContainText("Save a copy before continuing?")
  await dialog.getByRole("button", { name: "Keep editing" }).click()
  await expect(page.getByRole("radio", { name: "Edit", exact: true })).toBeChecked()

  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await dialog.getByRole("button", { name: "Discard changes" }).click()
  await expect(page.locator('[aria-label="Current model: Jacket"]:visible')).toBeVisible()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(editor).toHaveValue(appliedSource)

  await editor.fill("not: [valid")
  await page.getByRole("button", { name: "Save As..." }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Save As", exact: true }).click()
  await expect(page.locator(".yaml-error")).toBeVisible()

  await editor.fill(appliedSource.replace("Jacket", "Calculated jacket"))
  await page.getByRole("button", { name: "Save As..." }).click()
  const saveAsDialog = page.getByRole("dialog")
  await saveAsDialog.getByRole("textbox", { name: "Model name" }).fill("Calculated jacket study")
  await saveAsDialog.getByRole("button", { name: "Save As", exact: true }).click()
  await expect(page.locator('[aria-label="Current model: Calculated jacket study"]:visible')).toBeVisible()
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()

  await openDesktopAnalysis(page, "Inventory", ".inventory-view")

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await editor.fill(appliedSource.replace("Jacket", "Modal calculated jacket"))
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(dialog).toContainText("Save changes to \"Calculated jacket study\"")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.locator('[aria-label="Current model: Calculated jacket study"]:visible')).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()
})

test("New starts blank and Save As creates a writable session model", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)

  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const source = await editor.inputValue()
  await page.getByRole("button", { name: "File", exact: true }).click()
  await page.getByRole("menuitem", { name: "New..." }).click()

  await expect(editor).toHaveValue("")
  await expect(page.getByText("Start writing YAML, or upload an existing file from the File menu.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save As..." })).toBeDisabled()
  await expect(page.getByText("Paste YAML", { exact: true })).toHaveCount(0)

  await editor.fill(source.replace("Jacket", "Pasted jacket"))
  await expect(page.getByRole("button", { name: "Save As..." })).toBeEnabled()
  await page.getByRole("button", { name: "Save As..." }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Model name" }).fill("Pasted jacket study")
  await page.getByRole("dialog").getByRole("button", { name: "Save As", exact: true }).click()
  await expect(page.locator('[aria-label="Current model: Pasted jacket study"]:visible')).toBeVisible()
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
})

test("Upload creates a writable session model and Download preserves the exact draft", async ({ page }) => {
  await mockLcaApi(page)
  let calculationRequests = 0
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/api/lca/base")) calculationRequests += 1
  })
  await openWorkspace(page)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  const uploadedSource = (await editor.inputValue()).replace("Jacket", "Uploaded jacket")

  await uploadYaml(page, "uploaded-study.yaml", uploadedSource)
  await expect(page.locator('[aria-label="Current model: uploaded-study"]:visible')).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(editor).toHaveValue(uploadedSource)
  await expect(page.getByText("Saved in this browser session.")).toBeVisible()

  await page.getByRole("button", { name: "File", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "uploaded-study", exact: true })).toHaveAttribute("aria-current", "true")
  await page.keyboard.press("Escape")

  const recoveryDraft = `${uploadedSource}\n# local recovery note\n`
  await editor.fill(recoveryDraft)
  const requestCountBeforeDownload = calculationRequests
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "File", exact: true }).click()
  await page.getByRole("menuitem", { name: "Download YAML" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("uploaded-study.yaml")
  const stream = await download.createReadStream()
  let downloadedSource = ""
  for await (const chunk of stream) downloadedSource += chunk.toString()
  expect(downloadedSource).toBe(recoveryDraft)
  expect(calculationRequests).toBe(requestCountBeforeDownload)
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible()
})

test("an invalid upload keeps the prior committed graph and can be discarded", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()

  await uploadYaml(page, "broken-model.yaml", "not: [valid")
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await expect(editor).toHaveValue("not: [valid")
  await expect(page.locator('[aria-label="Current model: broken-model"]:visible')).toBeVisible()
  await expect(page.locator(".yaml-error")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save As..." })).toBeEnabled()

  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes" }).click()
  await expect(page.locator('[aria-label="Current model: Jacket"]:visible')).toBeVisible()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
})

test("model replacement protects dirty drafts and unload warns only while dirty", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  const unloadPrevented = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(await unloadPrevented()).toBe(false)

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "Protected jacket draft"))
  expect(await unloadPrevented()).toBe(true)

  await page.getByRole("button", { name: "File", exact: true }).click()
  await openTemplates(page)
  await page.getByRole("menuitem", { name: "Cotton Fiber", exact: true }).click()
  const confirmation = page.getByRole("alertdialog")
  await confirmation.getByRole("button", { name: "Keep editing" }).click()
  await expect(editor).toHaveValue(/Protected jacket draft/)
  await expect(page.locator('[aria-label="Current model: Jacket"]:visible')).toBeVisible()

  await page.getByRole("button", { name: "File", exact: true }).click()
  await openTemplates(page)
  await page.getByRole("menuitem", { name: "Cotton Fiber", exact: true }).click()
  await confirmation.getByRole("button", { name: "Discard changes" }).click()
  await expect(page.locator('[aria-label="Current model: Cotton Fiber"]:visible')).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
  await expect(page.locator(".react-flow__node")).toHaveCount(2)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(editor).toHaveValue(/Cotton Fiber/)
  expect(await unloadPrevented()).toBe(false)
})

test("an engine failure keeps the locally committed session model and structure graph", async ({ page }) => {
  await mockLcaApi(page, lcaResultFixture, undefined, 0, 0, 2)
  await openWorkspace(page)
  await calculate(page)
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "Locally saved jacket"))
  await page.getByRole("button", { name: "Save As..." }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Model name" }).fill("Offline jacket study")
  await page.getByRole("dialog").getByRole("button", { name: "Save As", exact: true }).click()
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toHaveCount(0)

  await expect(page.locator('[aria-label="Current model: Offline jacket study"]:visible')).toBeVisible()
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.locator(".react-flow__node")).toHaveCount(5)
  await expectAnalysisAvailability(page, "Inventory", false)
  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.getByText("Calculation engine unavailable.")).toBeVisible()
})

test("a calculation for an older applied revision cannot populate results", async ({ page }) => {
  let releaseCalculation: (() => void) | undefined
  let calculationCount = 0
  const calculationRequested = new Promise<void>((resolve) => {
    releaseCalculation = resolve
  })
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith("/api/product-graphs")) {
      await route.fulfill({ json: productGraphTemplatesFixture })
      return
    }
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

  await openWorkspace(page)
  await calculationRequested

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Product graph YAML" })
  await editor.fill((await editor.inputValue()).replace("Jacket", "New revision"))
  await page.getByRole("button", { name: "Save As..." }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Model name" }).fill("New revision study")
  await page.getByRole("dialog").getByRole("button", { name: "Save As", exact: true }).click()
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Edit", exact: true })).toBeChecked()
  await expectAnalysisAvailability(page, "Inventory", false)
  await page.waitForTimeout(650)

  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toBeVisible()
  await expectAnalysisAvailability(page, "Inventory", false)
  await expect(page.getByRole("radio", { name: "Edit", exact: true })).toBeChecked()
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toHaveCount(0)
  await expectAnalysisAvailability(page, "Inventory", true)
})

test("toolbar tooltips open from keyboard focus and pointer input", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  const graphSettings = page.getByRole("button", { name: "Graph settings" })

  await graphSettings.focus()
  await expect(graphSettings).toBeFocused()
  await expect(page.getByRole("tooltip", { name: "Graph settings" })).toBeVisible()

  await page.reload()
  await openWorkspace(page)
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await graphSettings.hover()
  await expect(page.getByRole("tooltip", { name: "Graph settings" })).toBeVisible()
})

test("graph toolbar expands and collapses all activities", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await expect(page.locator(".react-flow__node")).toHaveCount(5)

  await page.getByRole("button", { name: "Expand all activities" }).click()
  await expect(page.locator(".react-flow__node .pg-node.is-expanded")).toHaveCount(5)

  await page.getByRole("button", { name: "Collapse all activities" }).click()
  await expect(page.locator(".react-flow__node .pg-node.is-expanded")).toHaveCount(0)
})

test("primary switcher and Results menu support keyboard navigation", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()

  await page.getByRole("radio", { name: "Graph", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  const fileView = page.getByRole("radio", { name: "Edit", exact: true })
  await expect(fileView).toBeFocused()
  await page.keyboard.press("Space")
  await expect(fileView).toBeChecked()
  await expect(page.locator(".yaml-editor")).toBeVisible()

  const resultsMenu = page.getByRole("button", { name: "Results", exact: true })
  await resultsMenu.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Export results" })).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: "LCA results", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitem", { name: "Inventory", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitem", { name: "Impact analysis", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.locator(".impact-view")).toBeVisible()

  await resultsMenu.click()
  const selectedResult = page.getByRole("menuitem", { name: "Impact analysis", exact: true })
  await expect(selectedResult).toHaveAttribute("aria-current", "true")
  await expect(selectedResult.locator(".lucide-check")).toBeVisible()
})

test("theme, analysis, and Sankey selection groups support keyboard navigation", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)

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
  await openDesktopAnalysis(page, "Impact analysis", ".impact-view")
  const processes = page.getByRole("radio", { name: "Processes", exact: true })
  await processes.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("radio", { name: "Flows", exact: true })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.getByRole("radio", { name: "Flows", exact: true })).toBeChecked()

  await openDesktopAnalysis(page, "Sankey", ".sankey-view")
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
  await openWorkspace(page)
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
  await expect(decimalPlaces).toHaveValue("6")
  await page.getByRole("button", { name: "Increase decimal places" }).click()
  await expect(decimalPlaces).toHaveValue("7")
  await page.getByRole("checkbox", { name: "Show all decimal places" }).click()
  await expect(decimalPlaces).toBeDisabled()
  await expect(page.getByRole("button", { name: "Decrease decimal places" })).toBeDisabled()
  await page.getByRole("checkbox", { name: "Show all decimal places" }).click()
  await expect(decimalPlaces).toBeEnabled()
  await page.getByRole("button", { name: "Close global settings" }).click()

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  const modelMenu = page.getByRole("button", { name: "File", exact: true })
  await modelMenu.click()
  await openTemplates(page)
  await page.getByRole("menuitem", { name: "Cotton Fiber", exact: true }).click()
  await expect(page.locator('[aria-label="Current model: Cotton Fiber"]:visible')).toBeVisible()
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()

  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toHaveValue(/Cotton Fiber/)
  await expect(page.getByRole("button", { name: "Save As..." })).toBeEnabled()
  await modelMenu.click()
  await openTemplates(page)
  await page.getByRole("menuitem", { name: "Simple Mock Plastic Broom", exact: true }).click()
  const fullModelTitle = page.locator('[aria-label="Current model: Simple Mock Plastic Broom"]:visible')
  await expect(fullModelTitle).toBeVisible()
  expect(await fullModelTitle.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked()
  await page.getByRole("button", { name: "Results", exact: true }).click()
  await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
  await expect(page.locator(".markdown-report")).toBeVisible()
  await page.getByRole("radio", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Product graph YAML" })).toHaveValue(/Mock freight transport, small truck, direct emissions only/)
  await expect(page.getByRole("button", { name: "Save As..." })).toBeEnabled()
})

test("settings popovers dismiss predictably and restore trigger focus", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
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
  await openWorkspace(page)
  await calculate(page)

  await openDesktopAnalysis(page, "Process results", ".process-results-view")
  const outputs = page.locator(".process-flow-grids section").filter({ has: page.getByRole("heading", { name: "Outputs" }) })

  await expect(outputs.getByText("Sulfur dioxide, air (SO2)")).toBeVisible()
  await expect(outputs.getByText("0.123000")).toBeVisible()
  await expect(outputs.getByText("No output flows for this process.")).toHaveCount(0)

  const process = page.getByRole("combobox", { name: "Flow contribution process" })
  await process.click()
  await page.getByRole("option", { name: "Raw material extraction", exact: true }).click()
  const methane = outputs.getByRole("row").filter({ hasText: "Methane" })
  await expect(methane).toBeVisible()
  await expect(methane.getByRole("cell").nth(4)).toHaveText("0.016000")
})

test("process results merge unambiguous YAML and engine flow aliases", async ({ page }) => {
  const canonicalMethaneResult = {
    ...lcaResultFixture,
    lci: {
      ...Object.fromEntries(Object.entries(lcaResultFixture.lci).filter(([name]) => name !== "Methane, air")),
      "Methane, fossil": { amount: 0.023, unit: "kg", type: "emission" },
    },
    contribution_graphs: lcaResultFixture.contribution_graphs.map((graph) => ({
      ...graph,
      flows: graph.flows.map((flow) => flow.flow_name === "Methane" ? {
        ...flow,
        flow_name: "Methane, fossil",
        categories: ["air", "low population density, long-term"],
      } : flow),
    })),
  }
  await mockLcaApi(page, canonicalMethaneResult)
  await openWorkspace(page)
  await openDesktopAnalysis(page, "Process results", ".process-results-view")

  const outputs = page.locator(".process-flow-grids section").filter({ has: page.getByRole("heading", { name: "Outputs" }) })
  const methane = outputs.getByRole("row").filter({ hasText: "Methane, fossil" })
  await expect(methane).toHaveCount(1)
  await expect(methane.getByRole("cell").nth(2)).toHaveText("elementary flows/air/low population density, long-term")
  await expect(methane.getByRole("cell").nth(3)).toHaveText("0.023000")
})

test("process result sections select processes independently", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await openDesktopAnalysis(page, "Process results", ".process-results-view")

  const flowProcess = page.getByRole("combobox", { name: "Flow contribution process" })
  const impactProcess = page.getByRole("combobox", { name: "Impact assessment process" })
  const initialImpactProcess = await impactProcess.textContent()

  await flowProcess.click()
  await page.getByRole("option", { name: "Raw material extraction", exact: true }).click()

  await expect(flowProcess).toHaveText("Raw material extraction")
  await expect(impactProcess).toHaveText(initialImpactProcess ?? "")
})

test("all result tables expose working column resize handles", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)

  const views = [
    { name: "Inventory", root: ".inventory-view", table: ".inventory-table" },
    { name: "Impact Analysis", root: ".impact-view", table: ".impact-table" },
    { name: "Process Results", root: ".process-results-view", table: ".process-flow-table, .process-impact-table" },
    { name: "Contribution", root: ".contribution-view", table: ".contribution-table" },
  ]

  for (const view of views) {
    const menuName = view.name === "Impact Analysis" ? "Impact analysis"
      : view.name === "Process Results" ? "Process results"
        : view.name === "Contribution" ? "Contributions" : view.name
    await openDesktopAnalysis(page, menuName, view.root)
    const table = page.locator(view.table).first()
    await expect(table).toBeVisible()
    const handle = table.getByRole("separator").first()
    const initialWidth = Number(await handle.getAttribute("aria-valuenow"))
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2)
    await page.mouse.up()
    await expect(table.getByRole("separator").first()).toHaveAttribute("aria-valuenow", String(initialWidth + 30))
  }
})

test("contribution table columns support accessible keyboard resizing and horizontal scrolling", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await openDesktopAnalysis(page, "Contributions", ".contribution-view")

  const resizeProcess = page.getByRole("separator", { name: "Resize Process column" })
  await expect(resizeProcess).toHaveAttribute("aria-valuenow", "320")
  await resizeProcess.focus()
  await page.keyboard.press("ArrowRight")
  await expect(resizeProcess).toHaveAttribute("aria-valuenow", "330")
  await page.keyboard.press("Shift+ArrowLeft")
  await expect(resizeProcess).toHaveAttribute("aria-valuenow", "290")

  for (let index = 0; index < 20; index += 1) await page.keyboard.press("Shift+ArrowRight")
  const tableWrap = page.locator(".contribution-table-wrap")
  await expect.poll(() => tableWrap.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
})

test("impact contributions show process direct and accumulated results without emission details", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await openDesktopAnalysis(page, "Contributions", ".contribution-view")

  await expect(page.getByRole("columnheader", { name: /^Direct contribution\b/ })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: /^Direct Contribution %/ })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: /Accumulated contribution/ })).toBeVisible()
  await expect(page.locator(".contribution-process-row")).toHaveCount(1)
  const assembly = page.locator(".contribution-process-row").filter({ hasText: "Jacket assembly" })
  await expect(assembly.getByRole("button", { name: "Show upstream processes for P4 — Jacket assembly" })).toHaveAttribute("aria-expanded", "false")
  await expect(assembly.locator("td").nth(1)).toContainText("22.857143")
  await expect(assembly.locator("td").nth(3)).toHaveText("1.280000")
  await expect(assembly.locator("td").nth(4)).toContainText("5.600000")
  await expect(page.locator(".contribution-table").getByText(/Total —/)).toHaveCount(0)
  await expect(page.getByText("Carbon dioxide (CO2)", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Other emissions", { exact: true })).toHaveCount(0)
})

test("contribution tree can show elementary flow contributions", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await openDesktopAnalysis(page, "Contributions", ".contribution-view")

  await page.getByRole("radio", { name: "Flows", exact: true }).click()
  const flow = page.getByRole("combobox", { name: "Flow" })
  await flow.click()
  await page.getByRole("option", { name: "CO₂ (kg)", exact: true }).click()
  const assembly = page.locator(".contribution-process-row").filter({ hasText: "Jacket assembly" })
  await expect(assembly.locator("td").nth(3)).toHaveText("0.800000")
  await expect(assembly.locator("td").nth(5)).toHaveText("kg")
})

test("top contribution process shows its cumulative 100 percent share", async ({ page }) => {
  const cumulativeRootResult = {
    ...lcaResultFixture,
    contribution_graphs: lcaResultFixture.contribution_graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => node.process_name.includes("Jacket assembly") ? {
        ...node,
        cumulative_score: graph.total_score,
        cumulative_percentage: 100,
      } : node),
    })),
  }
  await mockLcaApi(page, cumulativeRootResult)
  await openWorkspace(page)
  await openDesktopAnalysis(page, "Contributions", ".contribution-view")

  const topProcess = page.locator(".contribution-process-row").first()
  const topChevron = topProcess.getByRole("button", { name: "Show upstream processes for P4 — Jacket assembly" })
  await expect(page.locator(".contribution-process-row")).toHaveCount(1)
  await expect(topChevron).toHaveAttribute("aria-expanded", "false")
  await expect(topProcess.locator("td").first()).toContainText("100.000000%")
  await expect(topProcess.locator("td").nth(1)).not.toContainText("100.000000%")
  await expect(page.getByRole("separator", { name: "Resize Contribution column" })).toHaveAttribute("aria-valuenow", "190")
  await expect(page.getByRole("separator", { name: "Resize Direct Contribution % column" })).toHaveAttribute("aria-valuenow", "170")
  await expect(page.getByRole("separator", { name: "Resize Direct contribution column" })).toHaveAttribute("aria-valuenow", "190")
  await expect(page.getByRole("separator", { name: "Resize Accumulated contribution column" })).toHaveAttribute("aria-valuenow", "250")
  await expect.poll(() => topProcess.locator("td").evaluateAll((cells) => cells.every((cell) => cell.scrollWidth <= cell.clientWidth))).toBe(true)
  await topChevron.click()
  await expect(page.locator(".contribution-process-row")).toHaveCount(3)
  await expect(topProcess.getByRole("button", { name: "Hide upstream processes for P4 — Jacket assembly" })).toHaveAttribute("aria-expanded", "true")
  await topProcess.getByRole("button", { name: "Hide upstream processes for P4 — Jacket assembly" }).click()
  await expect(page.locator(".contribution-process-row")).toHaveCount(1)

  await page.getByRole("radio", { name: "Flows", exact: true }).click()
  await expect(page.locator(".contribution-process-row")).toHaveCount(1)
  await expect(page.locator(".contribution-process-row").first().getByRole("button", { name: "Show upstream processes for P4 — Jacket assembly" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.locator(".contribution-process-row").first().locator("td").first()).toContainText("100.000000%")
})

test("every analysis table exposes accessible column resize controls", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)

  await openDesktopAnalysis(page, "Inventory", ".inventory-view")
  await expect(page.locator(".inventory-table").first().getByRole("separator")).toHaveCount(4)

  await openDesktopAnalysis(page, "Impact analysis", ".impact-view")
  await expect(page.locator(".impact-table").getByRole("separator")).toHaveCount(5)

  await openDesktopAnalysis(page, "Process results", ".process-results-view")
  await expect(page.locator(".process-flow-table").first().getByRole("separator")).toHaveCount(6)
  await expect(page.locator(".process-impact-table").getByRole("separator")).toHaveCount(5)

  await openDesktopAnalysis(page, "Contributions", ".contribution-view")
  await expect(page.locator(".contribution-table").getByRole("separator")).toHaveCount(6)
})

test("Flow and Impact Sankey process limits hide nodes from the bottom-right end", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await calculate(page)
  await openDesktopAnalysis(page, "Sankey", ".sankey-view")
  await page.getByRole("button", { name: "Chart settings" }).click()
  await page.getByRole("radio", { name: "Flow", exact: true }).click()

  const flowAssembly = page.locator(".sankey-process-node").filter({ hasText: "Jacket assembly" })
  const flowWeaving = page.locator(".sankey-process-node").filter({ hasText: "Fabric weaving" })
  const flowZipper = page.locator(".sankey-process-node").filter({ hasText: "Zipper production" })
  await expect(async () => {
    const assemblyBox = await flowAssembly.boundingBox()
    const weavingBox = await flowWeaving.boundingBox()
    const zipperBox = await flowZipper.boundingBox()
    expect(assemblyBox).not.toBeNull()
    expect(weavingBox).not.toBeNull()
    expect(zipperBox).not.toBeNull()
    expect(weavingBox!.y).toBeGreaterThan(assemblyBox!.y + assemblyBox!.height)
    expect(zipperBox!.y).toBeGreaterThan(assemblyBox!.y + assemblyBox!.height)
    expect(Math.abs(weavingBox!.y - zipperBox!.y)).toBeLessThan(2)
  }).toPass()
  await expect(flowAssembly.locator(".react-flow__handle-bottom.source")).toHaveCount(1)
  await expect(flowWeaving.locator(".react-flow__handle-top.target")).toHaveCount(1)

  await page.getByRole("spinbutton", { name: "Maximum processes" }).fill("1")
  await expect(page.locator(".sankey-process-node")).toHaveCount(1)
  await expect(page.locator(".sankey-process-node")).toContainText("Jacket assembly")
  await expect(page.locator(".sankey-process-node")).not.toContainText("Raw material extraction")

  await page.getByRole("radio", { name: "Impact", exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "Maximum processes" })).toHaveValue("5")
  const jacketAssembly = page.locator(".sankey-process-node").filter({ hasText: "Jacket assembly" })
  const fabricWeaving = page.locator(".sankey-process-node").filter({ hasText: "Fabric weaving" })
  const zipperProduction = page.locator(".sankey-process-node").filter({ hasText: "Zipper production" })
  await expect(async () => {
    const jacketBox = await jacketAssembly.boundingBox()
    const fabricBox = await fabricWeaving.boundingBox()
    const zipperBox = await zipperProduction.boundingBox()
    const processBoxes = await page.locator(".sankey-process-node").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y))
    expect(jacketBox).not.toBeNull()
    expect(fabricBox).not.toBeNull()
    expect(zipperBox).not.toBeNull()
    expect(processBoxes.filter((y) => Math.abs(y - jacketBox!.y) < 2)).toHaveLength(1)
    expect(fabricBox!.y).toBeGreaterThan(jacketBox!.y + jacketBox!.height)
    expect(zipperBox!.y).toBeGreaterThan(jacketBox!.y + jacketBox!.height)
    expect(Math.abs(fabricBox!.y - zipperBox!.y)).toBeLessThan(2)
    expect(fabricBox!.x).toBeLessThan(zipperBox!.x)
  }).toPass()
  await page.getByRole("spinbutton", { name: "Maximum processes" }).fill("1")
  await expect(page.locator(".sankey-process-node")).toHaveCount(1)
  await expect(page.locator(".sankey-process-node")).toContainText("Jacket assembly")
  await expect(page.locator(".sankey-process-node")).not.toContainText("Raw material extraction")
})

test("cumulative contribution graphs load only when an analysis pane opens", async ({ page }) => {
  const contributionRequests: string[][] = []
  await mockLcaApi(page, lcaResultFixture, (categories) => contributionRequests.push(categories))
  await openWorkspace(page)
  await calculate(page)

  expect(contributionRequests).toHaveLength(0)

  await openDesktopAnalysis(page, "Sankey", ".sankey-view")
  await expect.poll(() => contributionRequests.length).toBe(1)
  expect(contributionRequests[0]).toEqual(
    Object.entries(lcaResultFixture.lcia)
      .filter(([, value]) => value.score !== 0)
      .map(([label]) => label),
  )
})

test("Results shows progress during lazy contribution calculations", async ({ page }) => {
  await mockLcaApi(page, lcaResultFixture, undefined, 600)
  await openWorkspace(page)
  await calculate(page)

  await openDesktopAnalysis(page, "Impact analysis", ".impact-view")
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toBeVisible()
  await expect(page.getByRole("status", { name: "LCA calculation in progress" })).toHaveCount(0)
})

test("Sankey starts in Impact mode without briefly rendering the Flow graph", async ({ page }) => {
  await mockLcaApi(page, lcaResultFixture, undefined, 600)
  await openWorkspace(page)
  await calculate(page)
  await openDesktopAnalysis(page, "Sankey", ".sankey-view")

  await expect(page.locator(".sankey-empty[role=status]")).toContainText("Loading impact graph")
  await expect(page.locator(".sankey-process-node")).toHaveCount(0)
  await expect(page.locator(".sankey-process-node").first()).toBeVisible()
  await page.getByRole("button", { name: "Chart settings" }).click()
  await expect(page.getByRole("radio", { name: "Impact", exact: true })).toBeChecked()
})

test("Structure Graph is the default and Scaled Graph is enabled after the LCA finishes", async ({ page }) => {
  await mockLcaApi(page, lcaResultFixture, undefined, 0, 2_000)
  await openWorkspace(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()

  const scaledGraph = page.getByRole("button", { name: "Scaled Graph" })
  const structureGraph = page.getByRole("button", { name: "Structure Graph" })
  await expect(structureGraph).toHaveAttribute("aria-pressed", "true")
  await expect(scaledGraph).toBeDisabled()

  await expectAnalysisAvailability(page, "Inventory", true)
  await expect(scaledGraph).toBeEnabled()
  await scaledGraph.click()
  await expect(scaledGraph).toHaveAttribute("aria-pressed", "true")
  await structureGraph.click()
  await expect(structureGraph).toHaveAttribute("aria-pressed", "true")
})

test("opening the inspector keeps the selected jacket node visible", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await expect(page.locator(".react-flow__node")).toHaveCount(5)

  const jacketNode = page.locator(".react-flow__node").last()
  await jacketNode.click()
  const inspector = page.locator(".inspector")
  await expect(inspector).toBeVisible()
  await expect.poll(async () => {
    const nodeBounds = await jacketNode.boundingBox()
    const inspectorBounds = await inspector.boundingBox()
    if (!nodeBounds || !inspectorBounds) return Number.NEGATIVE_INFINITY
    return inspectorBounds.x - (nodeBounds.x + nodeBounds.width)
  }).toBeGreaterThanOrEqual(16)
})

test("find node stays beside the graph toolbar when the inspector opens", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)

  const toolbar = page.locator(".graph-toolbar")
  const search = page.getByRole("textbox", { name: "Find a node" }).locator("..")
  await page.locator(".react-flow__node").last().click()
  const inspector = page.locator(".inspector")

  const [toolbarBounds, searchBounds, inspectorBounds] = await Promise.all([
    toolbar.boundingBox(),
    search.boundingBox(),
    inspector.boundingBox(),
  ])
  expect(toolbarBounds).not.toBeNull()
  expect(searchBounds).not.toBeNull()
  expect(inspectorBounds).not.toBeNull()
  expect(searchBounds!.x).toBeGreaterThanOrEqual(toolbarBounds!.x + toolbarBounds!.width + 8)
  expect(searchBounds!.x + searchBounds!.width).toBeLessThanOrEqual(inspectorBounds!.x - 16)
})

test("opening the property editor preserves the graph viewport", async ({ page }) => {
  await mockLcaApi(page)
  await openWorkspace(page)
  await page.getByRole("radio", { name: "Graph", exact: true }).click()
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0)

  await page.getByRole("button", { name: "Zoom in" }).click()
  await page.waitForTimeout(300)
  const viewport = page.locator(".react-flow__viewport")
  const zoomedTransform = await viewport.getAttribute("style")

  await page.locator(".react-flow__node").last().click()
  await expect(page.locator(".inspector")).toBeVisible()
  await page.waitForTimeout(300)
  await expect(viewport).toHaveAttribute("style", zoomedTransform ?? "")

  await page.getByRole("button", { name: "Close property editor" }).click()
  await expect(page.locator(".inspector")).toBeHidden()
  await page.waitForTimeout(300)
  await expect(viewport).toHaveAttribute("style", zoomedTransform ?? "")
})

for (const theme of ["dark", "light"] as const) {
  test(`${theme} application views`, async ({ page }) => {
    test.setTimeout(60_000)
    await mockLcaApi(page)
    await openWorkspace(page)
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

    await page.getByRole("radio", { name: "Edit", exact: true }).click()
    await expect(page.locator(".yaml-editor")).toBeVisible()
    await screenshot(page, `${theme}-yaml-editor.png`)

    await page.getByRole("button", { name: "Results", exact: true }).click()
    await page.getByRole("menuitem", { name: "LCA results", exact: true }).click()
    await expect(page.locator(".markdown-report")).toBeVisible()
    await screenshot(page, `${theme}-lca-results.png`)

    await page.getByRole("radio", { name: "Graph", exact: true }).click()
    await page.getByRole("button", { name: "Scaled Graph" }).click()
    await expect(page.getByRole("button", { name: "Scaled Graph" })).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Fit graph" }).click()
    await page.waitForTimeout(500)
    await screenshot(page, `${theme}-scaled-graph.png`)

    await openDesktopAnalysis(page, "Inventory", ".inventory-view")
    await screenshot(page, `${theme}-inventory.png`)

    await openDesktopAnalysis(page, "Impact analysis", ".impact-view")
    await screenshot(page, `${theme}-impact-analysis.png`)

    await openDesktopAnalysis(page, "Process results", ".process-results-view")
    await screenshot(page, `${theme}-process-results.png`)

    await openDesktopAnalysis(page, "Contributions", ".contribution-view")
    await screenshot(page, `${theme}-contribution.png`)

    await openDesktopAnalysis(page, "Sankey", ".sankey-view")
    await expect(page.locator(".sankey-process-node")).toHaveCount(5)
    await screenshot(page, `${theme}-sankey.png`)

    await page.getByRole("button", { name: "Chart settings" }).click()
    await expect(page.locator(".sankey-chart-picker")).toBeVisible()
    await screenshot(page, `${theme}-sankey-chart-settings.png`)
  })
}

