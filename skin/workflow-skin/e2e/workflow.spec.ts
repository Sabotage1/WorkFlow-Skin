import { expect, test } from "@playwright/test";

test("skin shell renders without overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Workflow navigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Brew" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brew", exact: true })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Bags" }).click();

  await expect(page.getByRole("heading", { name: "Bags" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bags", exact: true })).toHaveAttribute("aria-current", "page");

  const bodyBox = await page.locator("body").boundingBox();
  expect(bodyBox?.width).toBeGreaterThan(300);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test("community fullscreen graph ignores page scroll on low-resolution screens", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 240 });
  await page.goto("/");
  await page.setContent(`
    <html>
      <head>
        <link rel="stylesheet" href="/src/styles.css" />
      </head>
      <body>
        <main style="height: 1400px; padding-top: 900px;">Scrolled content</main>
        <div class="community-graph-fullscreen" role="dialog" aria-modal="true" aria-label="Shot graph fullscreen">
          <div class="community-graph-fullscreen-header">
            <button type="button" class="community-graph-close" aria-label="Close shot graph fullscreen">x</button>
          </div>
          <div class="community-graph-fullscreen-frame">
            <svg class="shot-graph" viewBox="0 0 640 270" role="img" aria-label="Shot pressure graph">
              <rect width="640" height="270" rx="8" fill="#0d141a"></rect>
            </svg>
          </div>
        </div>
      </body>
    </html>
  `);

  await page.waitForFunction(() => getComputedStyle(document.querySelector(".community-graph-fullscreen") as Element).position === "fixed");
  await page.evaluate(() => window.scrollTo(0, 500));

  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector(".community-graph-fullscreen")!.getBoundingClientRect();
    const close = document.querySelector(".community-graph-close")!.getBoundingClientRect();
    const graph = document.querySelector(".community-graph-fullscreen .shot-graph")!.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      dialog: { top: dialog.top, bottom: dialog.bottom, height: dialog.height },
      close: { top: close.top, bottom: close.bottom },
      graph: { top: graph.top, bottom: graph.bottom, width: graph.width, height: graph.height }
    };
  });

  expect(metrics.scrollY).toBeGreaterThan(0);
  expect(metrics.dialog.top).toBeCloseTo(0, 0);
  expect(metrics.dialog.bottom).toBeCloseTo(240, 0);
  expect(metrics.close.top).toBeGreaterThanOrEqual(9);
  expect(metrics.close.bottom).toBeLessThanOrEqual(60);
  expect(metrics.graph.top).toBeGreaterThan(metrics.close.bottom);
  expect(metrics.graph.bottom).toBeLessThanOrEqual(metrics.dialog.bottom - 8);
  expect(metrics.graph.width / metrics.graph.height).toBeCloseTo(640 / 270, 1);
});
