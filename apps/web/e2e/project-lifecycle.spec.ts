import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixturePath = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/demo"),
);

test("配置项目并完成预检、启动、日志、停止和删除", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const existing = await request.get("http://127.0.0.1:4310/api/projects");
  const existingBody = (await existing.json()) as {
    projects: Array<{ project: { id: string; name: string } }>;
  };
  const initialProjectCount = existingBody.projects.filter(
    ({ project }) => project.name !== "E2E Fixture",
  ).length;
  for (const item of existingBody.projects.filter(
    ({ project }) => project.name === "E2E Fixture",
  )) {
    await request.post(
      `http://127.0.0.1:4310/api/projects/${item.project.id}/stop`,
    );
    await request.delete(
      `http://127.0.0.1:4310/api/projects/${item.project.id}`,
    );
  }

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".project-card")).toHaveCount(initialProjectCount);
  await expect(page.getByText("portal-skills")).toHaveCount(0);
  await expect(page.getByText("订阅接入")).toHaveCount(0);

  await page.getByRole("button", { name: "＋ 登记项目" }).click();
  await page.getByLabel("项目名称").fill("E2E Fixture");
  await page.getByLabel("图标").fill("EF");
  await page
    .getByLabel("绝对路径")
    .fill(fixturePath);
  await page.getByLabel("访问地址").fill("http://127.0.0.1:4329");
  await page
    .getByLabel("项目介绍")
    .fill("用于验证项目管理平台完整生命周期的本地 HTTP 服务，覆盖配置、启动、日志、停止与删除流程。");
  await page.getByLabel("标签（逗号分隔）").fill("测试");
  await page.getByLabel("步骤 ID").fill("server");
  await page.getByLabel("显示名称").fill("Fixture Server");
  await page.getByLabel("可执行文件").fill("node");
  await page.getByLabel("参数（每行一个）").fill("server.mjs");
  await page.getByLabel("探针类型").selectOption("http");
  await page.getByLabel("服务 URL").fill("http://127.0.0.1:4329");
  await page.getByLabel("期望状态码").fill("200");
  await page.getByLabel("超时（ms）").fill("5000");
  await page.getByRole("button", { name: "保存配置" }).click();

  const fixtureCard = page.locator(".project-card").filter({ hasText: "E2E Fixture" });
  await expect(fixtureCard).toBeVisible();
  await expect(fixtureCard.getByRole("link", { name: /打开/ })).toHaveAttribute(
    "href",
    "http://127.0.0.1:4329",
  );
  await fixtureCard.getByRole("button", { name: "预检" }).click();
  await expect(page.getByRole("dialog", { name: "E2E Fixture" })).toContainText(
    "可以启动",
  );
  await page.getByRole("button", { name: "关闭" }).click();
  await fixtureCard.getByRole("button", { name: "启动" }).click();
  await expect(fixtureCard.getByLabel("状态：运行中")).toBeVisible({
    timeout: 10_000,
  });

  await fixtureCard.getByRole("link", { name: "详情" }).click();
  await expect(page.getByRole("heading", { name: "项目介绍" })).toBeVisible();
  await expect(page.getByText(/用于验证项目管理平台完整生命周期/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "完整启动命令" })).toBeVisible();
  await expect(page.locator(".command-block code").first()).toContainText(
    `cd ${fixturePath} && node server.mjs`,
  );
  await expect(page.getByText(/PID \d+/)).toBeVisible();
  await expect(page.getByText("SSE 在线")).toBeVisible();
  await expect(page.getByRole("link", { name: /http:\/\/127\.0\.0\.1:4329/ })).toBeVisible();
  await expect(page.locator(".log-line").first()).toBeVisible();

  await page.getByRole("link", { name: "← 返回控制台" }).click();
  const fixtureAfterReturn = page
    .locator(".project-card")
    .filter({ hasText: "E2E Fixture" });
  await fixtureAfterReturn.getByRole("button", { name: "停止" }).click();
  await expect(fixtureAfterReturn.getByLabel("状态：已停止")).toBeVisible({
    timeout: 10_000,
  });
  await fixtureAfterReturn.getByRole("button", { name: "编辑" }).click();
  await page.getByRole("button", { name: "删除项目" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator(".project-card")).toHaveCount(initialProjectCount);

  expect(consoleErrors).toEqual([]);
});
