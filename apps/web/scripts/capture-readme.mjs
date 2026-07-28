import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://127.0.0.1:4311";
const outputDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/images",
);
const now = "2026-07-28T01:00:00.000Z";

function record({
  id,
  name,
  path,
  description,
  icon,
  tags,
  port,
  status,
  external = false,
  stepNames,
}) {
  const steps = stepNames.map((stepName, index) => ({
    id: `step-${index + 1}`,
    name: stepName,
    type: "command",
    mode: "process",
    start: {
      executable: "pnpm",
      args: index === 0 ? ["dev"] : ["worker"],
      cwd: index === 0 ? "." : "apps/worker",
    },
    dependsOn: index === 0 ? [] : [`step-${index}`],
    probe: port
      ? {
          type: "http",
          url: `http://localhost:${port}`,
          expectedStatus: 200,
          timeoutMs: 20_000,
        }
      : { type: "process", timeoutMs: 10_000 },
  }));
  return {
    project: {
      id,
      name,
      path,
      serviceUrl: port ? `http://localhost:${port}` : undefined,
      description,
      icon,
      tags,
      enabled: true,
      steps,
      createdAt: now,
      updatedAt: now,
    },
    runtime: {
      projectId: id,
      status,
      external: external || undefined,
      operationId: null,
      steps: steps.map((step) => ({
        stepId: step.id,
        status,
        pid: status === "running" && !external ? 24000 + Number(step.id.at(-1)) : null,
        startedAt: status === "running" ? now : null,
        error: null,
      })),
      error: null,
      updatedAt: now,
    },
  };
}

const projects = [
  record({
    id: "10000000-0000-4000-8000-000000000001",
    name: "Atlas Web",
    path: "/workspace/atlas-web",
    description:
      "Customer-facing React workspace with a Vite development server and local API proxy.",
    icon: "AW",
    tags: ["React", "Vite", "Frontend"],
    port: 3000,
    status: "running",
    stepNames: ["Web application", "Background worker"],
  }),
  record({
    id: "10000000-0000-4000-8000-000000000002",
    name: "Beacon API",
    path: "/workspace/beacon-api",
    description:
      "Fastify API backed by PostgreSQL with health checks and structured runtime logs.",
    icon: "BA",
    tags: ["Node.js", "Fastify", "API"],
    port: 8080,
    status: "running",
    external: true,
    stepNames: ["API server"],
  }),
  record({
    id: "10000000-0000-4000-8000-000000000003",
    name: "Worker Lab",
    path: "/workspace/worker-lab",
    description:
      "Python task workers and supporting Docker services managed as one local project.",
    icon: "WL",
    tags: ["Python", "Docker", "Workers"],
    status: "stopped",
    stepNames: ["Docker services", "Task worker"],
  }),
  record({
    id: "10000000-0000-4000-8000-000000000004",
    name: "Docs Studio",
    path: "/workspace/docs-studio",
    description:
      "Documentation portal with search indexing, preview builds, and a fixed local URL.",
    icon: "DS",
    tags: ["Next.js", "Docs", "Search"],
    port: 4321,
    status: "stopped",
    stepNames: ["Documentation site"],
  }),
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
});

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const parts = url.pathname.split("/").filter(Boolean);
  const projectId = parts[2];
  const record = projects.find((item) => item.project.id === projectId);
  const headers = { "Content-Type": "application/json" };

  if (url.pathname === "/api/projects") {
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ projects }) });
    return;
  }
  if (record && parts[3] === "runtime") {
    await route.fulfill({ status: 200, headers, body: JSON.stringify(record.runtime) });
    return;
  }
  if (record && parts[3] === "logs") {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: `data: ${JSON.stringify({
        timestamp: now,
        stepId: "step-1",
        stream: "stdout",
        message: "Development server ready on http://localhost:3000",
      })}\n\n`,
    });
    return;
  }
  if (record && parts.length === 3) {
    await route.fulfill({ status: 200, headers, body: JSON.stringify(record.project) });
    return;
  }
  await route.fulfill({ status: 404, headers, body: "{}" });
});

async function settle() {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

await page.goto(baseUrl);
await page.locator(".project-card").first().waitFor();
await settle();
await page.screenshot({
  path: resolve(outputDir, "dashboard.png"),
  fullPage: false,
});

await page.goto(`${baseUrl}/projects/${projects[0].project.id}`);
await page.getByRole("heading", { name: "项目介绍" }).waitFor();
await settle();
await page.screenshot({
  path: resolve(outputDir, "project-detail.png"),
  fullPage: false,
});

await page.goto(baseUrl);
await page.locator(".project-card").first().waitFor();
await page.getByRole("button", { name: "＋ 登记项目" }).click();
await page.getByRole("dialog", { name: "登记新项目" }).waitFor();
await settle();
await page.screenshot({
  path: resolve(outputDir, "project-form.png"),
  fullPage: false,
});

await browser.close();
