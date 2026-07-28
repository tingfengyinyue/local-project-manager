import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectConfigSchema } from "@lpm/contracts";
import { ProjectStore } from "../src/database.js";
import { RuntimeManager, type LogEntry } from "../src/runtime.js";

const roots: string[] = [];
const stores: ProjectStore[] = [];

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("RuntimeManager", () => {
  it("保存进程句柄、流式脱敏日志并停止自身进程组", async () => {
    const root = await mkdtemp(join(tmpdir(), "lpm-runtime-"));
    roots.push(root);
    const store = new ProjectStore(":memory:");
    stores.push(store);
    const manager = new RuntimeManager(store, [root]);
    const now = new Date().toISOString();
    const project = projectConfigSchema.parse({
      id: "123e4567-e89b-42d3-a456-426614174001",
      name: "process fixture",
      path: root,
      steps: [
        {
          id: "server",
          name: "server",
          mode: "process",
          start: {
            executable: process.execPath,
            args: [
              "-e",
              'console.log("token=super-secret"); setInterval(() => {}, 1000)',
            ],
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    store.createProject(project);
    const logs: LogEntry[] = [];
    const unsubscribe = manager.subscribe(project.id, (entry) => logs.push(entry));

    const running = await manager.start(project);
    expect(running.status).toBe("running");
    expect(running.steps[0]?.pid).toBeTypeOf("number");
    await expect
      .poll(() => logs.some((entry) => entry.message.includes("token=[REDACTED]")))
      .toBe(true);
    expect(logs.every((entry) => !entry.message.includes("super-secret"))).toBe(true);

    const stopped = await manager.stop(project);
    expect(stopped.status).toBe("stopped");
    expect(stopped.steps[0]?.pid).toBeNull();
    unsubscribe();
  });

  it("加载项目内 envFile，且一次性任务无需停止命令", async () => {
    const root = await mkdtemp(join(tmpdir(), "lpm-runtime-"));
    roots.push(root);
    await writeFile(join(root, ".env"), "FIXTURE_VALUE=loaded\n");
    const script = join(root, "fixture.sh");
    await writeFile(script, '#!/bin/sh\nprintf "%s" "$FIXTURE_VALUE"\n');
    await chmod(script, 0o755);
    const store = new ProjectStore(":memory:");
    stores.push(store);
    const manager = new RuntimeManager(store, [root]);
    const now = new Date().toISOString();
    const project = projectConfigSchema.parse({
      id: "123e4567-e89b-42d3-a456-426614174002",
      name: "task fixture",
      path: root,
      steps: [
        {
          id: "prepare",
          name: "prepare",
          mode: "task",
          envFile: ".env",
          start: { executable: "./fixture.sh", args: [] },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    store.createProject(project);
    const logs: LogEntry[] = [];
    manager.subscribe(project.id, (entry) => logs.push(entry));

    expect((await manager.start(project)).status).toBe("running");
    expect(logs.some((entry) => entry.message === "loaded")).toBe(true);
    expect((await manager.stop(project)).status).toBe("stopped");
  });

  it("识别由外部终端启动且探针健康的项目", async () => {
    const root = await mkdtemp(join(tmpdir(), "lpm-runtime-"));
    roots.push(root);
    const store = new ProjectStore(":memory:");
    stores.push(store);
    const manager = new RuntimeManager(store, [root]);
    const server = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试端口不可用");
    const now = new Date().toISOString();
    const project = projectConfigSchema.parse({
      id: "123e4567-e89b-42d3-a456-426614174003",
      name: "external fixture",
      path: root,
      steps: [{
        id: "server",
        name: "server",
        mode: "process",
        start: { executable: process.execPath, args: ["server.js"] },
        probe: {
          type: "tcp",
          host: "127.0.0.1",
          port: address.port,
          timeoutMs: 1_000,
        },
      }],
      createdAt: now,
      updatedAt: now,
    });
    store.createProject(project);

    try {
      const observed = await manager.observe(project);
      expect(observed.status).toBe("running");
      expect(observed.external).toBe(true);
      expect(observed.steps[0]).toMatchObject({ status: "running", pid: null });
      expect(manager.get(project).status).toBe("stopped");
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });
});
