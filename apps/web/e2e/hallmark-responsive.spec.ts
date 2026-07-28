import { expect, test } from "@playwright/test";

for (const width of [320, 375, 414, 768, 1024]) {
  test(`Workbench 在 ${width}px 无横向溢出`, async ({ page, request }) => {
    const response = await request.get("http://127.0.0.1:4310/api/projects");
    const body = (await response.json()) as { projects: unknown[] };
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "运行工作台" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.locator(".project-card")).toHaveCount(body.projects.length);
  });
}

test("⌘K 项目搜索支持键盘打开与跳转", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog", { name: "搜索并打开项目" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "搜索项目" });
  await expect(search).toBeFocused();
  await search.fill("Markdown TTS");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByRole("heading", { name: "Markdown TTS" })).toBeVisible();
});
