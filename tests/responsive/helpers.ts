import { expect, type Locator, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"
import { productGraphTemplatesFixture } from "../fixtures/product-graph-templates"

export async function mockLcaApi(page: Page) {
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
          { name: "run_lca_base", rest: { method: "POST", path: "/api/lca/base" } },
          { name: "get_lca_contribution_graphs", rest: { method: "POST", path: "/api/lca/contribution" } },
        ],
      })
      return
    }
    if (pathname.endsWith("/api/lca/base")) {
      await route.fulfill({ json: { ...lcaResultFixture, contribution_graphs: [] } })
      return
    }
    if (pathname.endsWith("/api/lca/contribution")) {
      const body = route.request().postDataJSON() as { categories?: string[] }
      const categories = body.categories ?? []
      await route.fulfill({
        json: {
          result_id: lcaResultFixture.result_id,
          method: lcaResultFixture.method,
          contribution_graphs: lcaResultFixture.contribution_graphs.filter((graph) => (
            categories.some((category) => graph.label.includes(category))
          )),
        },
      })
      return
    }

    await route.abort("blockedbyclient")
  })
}

export async function pageMetrics(page: Page) {
  return page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  }))
}

export async function calculate(page: Page) {
  const desktop = (page.viewportSize()?.width ?? 0) > 900
  const results = desktop
    ? page.getByRole("button", { name: "Results", exact: true })
    : page.getByRole("radio", { name: "Results", exact: true })
  await expect(results).toBeEnabled()
  await results.click()
  if (desktop) {
    await page.getByRole("menuitem", { name: "Inventory", exact: true }).click()
    await expect(page.locator(".inventory-view")).toBeVisible()
  } else {
    await expect(page.locator(".markdown-report")).toBeVisible()
  }
}

export async function openAnalysisView(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 0) > 900) {
    const desktopNames: Record<string, string> = {
      "Impact Analysis": "Impact analysis",
      "Process Results": "Process results",
      Contribution: "Contributions",
      "Sankey Graph": "Sankey",
    }
    await page.getByRole("button", { name: "Results", exact: true }).click()
    await page.getByRole("menuitem", { name: desktopNames[name] ?? name, exact: true }).click()
    return
  }
  await page.getByRole("radio", { name, exact: true }).click()
}

export async function expectInsideViewport(locator: Locator, page: Page) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()

  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!box || !viewport) return

  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
}
