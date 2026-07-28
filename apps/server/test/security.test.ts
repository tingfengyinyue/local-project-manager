import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectConfigSchema } from "@lpm/contracts";
import {
  preflightProject,
  redactLog,
  resolveInside,
  topologicalSteps,
} from "../src/security.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lpm-security-"));
  temporaryDirectories.push(root);
  return root;
}

function project(path: string) {
  const now = new Date().toISOString();
  return projectConfigSchema.parse({
    id: "123e4567-e89b-42d3-a456-426614174000",
    name: "fixture",
    path,
    steps: [
      {
        id: "prepare",
        name: "prepare",
        mode: "task",
        start: { executable: process.execPath, args: ["-e", "process.exit(0)"] },
        stop: { executable: process.execPath, args: ["-e", "process.exit(0)"] },
      },
      {
        id: "server",
        name: "server",
        dependsOn: ["prepare"],
        start: { executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
}

describe("路径与预检", () => {
  it("拒绝 cwd 遍历", async () => {
    const root = await fixtureRoot();
    expect(() => resolveInside(root, "../outside", "cwd")).toThrow("项目根目录内");
  });

  it("不读取 envFile 内容且接受项目内文件", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, ".env"), "SECRET=do-not-read");
    const value = project(root);
    value.steps[0]!.envFile = ".env";
    const result = await preflightProject(value, [root]);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("do-not-read");
  });

  it("拒绝 envFile 符号链接逃逸", async () => {
    const root = await fixtureRoot();
    const outside = await fixtureRoot();
    await writeFile(join(outside, "secret.env"), "TOKEN=hidden");
    await symlink(join(outside, "secret.env"), join(root, ".env"));
    const value = project(root);
    value.steps[0]!.envFile = ".env";
    const result = await preflightProject(value, [root]);
    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.kind === "env-file" && !check.ok)).toBe(
      true,
    );
  });

  it("在启动前识别进程步骤的端口冲突", async () => {
    const root = await fixtureRoot();
    const server = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试端口不可用");

    try {
      const value = project(root);
      value.steps[1]!.probe = {
        type: "tcp",
        host: "127.0.0.1",
        port: address.port,
        timeoutMs: 1_000,
      };
      const result = await preflightProject(value, [root]);
      expect(result.ok).toBe(false);
      expect(result.checks).toContainEqual(expect.objectContaining({
        stepId: "server",
        kind: "port",
        ok: false,
      }));
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });

  it("按拓扑排序并检测依赖环", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "sub"));
    const value = project(root);
    expect(topologicalSteps(value).map((step) => step.id)).toEqual([
      "prepare",
      "server",
    ]);
    value.steps[0]!.dependsOn = ["server"];
    expect(() => topologicalSteps(value)).toThrow("依赖存在环");
  });

  it("脱敏常见凭据", () => {
    expect(redactLog("token=abc password: xyz Bearer qwerty")).toBe(
      "token=[REDACTED] password: [REDACTED] Bearer [REDACTED]",
    );
  });
});
