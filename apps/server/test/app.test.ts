import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "../src/app.js";

const contexts: ServerContext[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(({ app }) => app.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup(): Promise<{ context: ServerContext; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "lpm-app-"));
  roots.push(root);
  const context = createServer({
    databasePath: join(root, "test.sqlite"),
    allowedRoots: [root],
  });
  contexts.push(context);
  return { context, root };
}

function taskProject(root: string, counterFile?: string) {
  const startScript = counterFile
    ? `require("node:fs").appendFileSync(${JSON.stringify(counterFile)}, "x")`
    : "process.exit(0)";
  return {
    name: "测试项目",
    path: root,
    steps: [
      {
        id: "fixture",
        name: "无破坏任务",
        mode: "task",
        start: {
          executable: process.execPath,
          args: ["-e", startScript],
          cwd: ".",
        },
        stop: {
          executable: process.execPath,
          args: ["-e", "process.exit(0)"],
          cwd: ".",
        },
      },
    ],
  };
}

describe("HTTP API", () => {
  it("提供健康检查并限制 CORS", async () => {
    const { context } = await setup();
    const health = await context.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const allowed = await context.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );

    const denied = await context.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://example.com" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("完成项目 CRUD、预检和幂等启停", async () => {
    const { context, root } = await setup();
    const created = await context.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: taskProject(root),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const preflight = await context.app.inject({
      method: "POST",
      url: `/api/projects/${id}/preflight`,
    });
    expect(preflight.json().ok).toBe(true);

    const started = await context.app.inject({
      method: "POST",
      url: `/api/projects/${id}/start`,
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe("running");

    const startedAgain = await context.app.inject({
      method: "POST",
      url: `/api/projects/${id}/start`,
    });
    expect(startedAgain.json().status).toBe("running");

    const patchWhileRunning = await context.app.inject({
      method: "PATCH",
      url: `/api/projects/${id}`,
      payload: { name: "不应成功" },
    });
    expect(patchWhileRunning.statusCode).toBe(409);

    const stopped = await context.app.inject({
      method: "POST",
      url: `/api/projects/${id}/stop`,
    });
    expect(stopped.json().status).toBe("stopped");
    const stoppedAgain = await context.app.inject({
      method: "POST",
      url: `/api/projects/${id}/stop`,
    });
    expect(stoppedAgain.json().status).toBe("stopped");

    const deleted = await context.app.inject({
      method: "DELETE",
      url: `/api/projects/${id}`,
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("并发 start 只执行一次启动任务", async () => {
    const { context, root } = await setup();
    const counter = join(root, "counter.txt");
    await writeFile(counter, "");
    const created = await context.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: taskProject(root, counter),
    });
    const id = created.json().id as string;

    const [first, second] = await Promise.all([
      context.app.inject({ method: "POST", url: `/api/projects/${id}/start` }),
      context.app.inject({ method: "POST", url: `/api/projects/${id}/start` }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await readFile(counter, "utf8")).toBe("x");

    await context.app.inject({ method: "POST", url: `/api/projects/${id}/stop` });
  });

  it("统一返回校验错误并拒绝允许根目录外路径", async () => {
    const { context, root } = await setup();
    const invalid = await context.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: taskProject(tmpdir()),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: "PATH_NOT_ALLOWED" },
    });

    const malformed = await context.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "missing fields", path: root },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_ERROR");
  });
});
