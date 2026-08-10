import { expect, type Locator, type Page } from "@playwright/test"
import { lcaResultFixture } from "../fixtures/lca-result"
import { productGraphCatalogFixture } from "../fixtures/product-graph-catalog"

export async function mockLcaApi(page: Page) {
  await page.route("**/lca-api/api/**", async (route) => {
    const { pathname } = new URL(route.request().url())

    if (pathname.endsWith("/api/product-graphs")) {
      await route.fulfill({ json: productGraphCatalogFixture })
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
  const results = page.getByRole("radio", { name: "Results", exact: true })
  await expect(results).toBeEnabled()
  await results.click()
  await expect(page.locator(".markdown-report")).toBeVisible()
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
