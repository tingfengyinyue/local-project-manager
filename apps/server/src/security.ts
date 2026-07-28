import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import type { ProjectConfig, ProjectStep } from "@lpm/contracts";
import type { PreflightResult } from "@lpm/contracts";
import { AppError } from "./errors.js";

function isContained(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertConfiguredPath(
  candidate: string,
  allowedRoots: readonly string[],
  label: string,
): string {
  const absolute = resolve(candidate);
  if (!allowedRoots.some((root) => isContained(resolve(root), absolute))) {
    throw new AppError("PATH_NOT_ALLOWED", `${label}不在允许根目录内`, 400, {
      path: absolute,
    });
  }
  return absolute;
}

export function resolveInside(root: string, candidate: string, label: string): string {
  const absolute = resolve(root, candidate);
  if (!isContained(resolve(root), absolute)) {
    throw new AppError("PATH_TRAVERSAL", `${label}必须位于项目根目录内`, 400, {
      path: candidate,
    });
  }
  return absolute;
}

export function assertProjectPaths(project: ProjectConfig): void {
  for (const step of project.steps) {
    resolveInside(project.path, step.start.cwd, `步骤 ${step.id} 启动 cwd`);
    if (step.stop) {
      resolveInside(project.path, step.stop.cwd, `步骤 ${step.id} 停止 cwd`);
    }
    if (step.envFile) {
      resolveInside(project.path, step.envFile, `步骤 ${step.id} envFile`);
    }
  }
}

export async function validateProjectRoot(
  candidate: string,
  allowedRoots: readonly string[],
): Promise<string> {
  const absolute = resolve(candidate);
  let rootStat;
  try {
    rootStat = await stat(absolute);
  } catch {
    throw new AppError("PROJECT_PATH_INVALID", "项目根目录不存在", 400, {
      path: absolute,
    });
  }
  if (!rootStat.isDirectory()) {
    throw new AppError("PROJECT_PATH_INVALID", "项目根目录不是目录", 400, {
      path: absolute,
    });
  }
  const realCandidate = await realpath(absolute);
  const realAllowedRoots = await Promise.all(
    allowedRoots.map(async (root) => realpath(resolve(root))),
  );
  if (realAllowedRoots.some((root) => isContained(root, realCandidate))) {
    return realCandidate;
  }
  if (allowedRoots.some((root) => isContained(resolve(root), absolute))) {
    throw new AppError(
      "SYMLINK_ESCAPE",
      "项目根目录通过符号链接逃逸允许根目录",
      400,
      { path: absolute },
    );
  }
  throw new AppError("PATH_NOT_ALLOWED", "项目根目录不在允许根目录内", 400, {
    path: absolute,
  });
}

async function existingRealPathInside(
  root: string,
  candidate: string,
  label: string,
): Promise<string> {
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!isContained(realRoot, realCandidate)) {
    throw new AppError("SYMLINK_ESCAPE", `${label}通过符号链接逃逸项目根目录`, 400, {
      path: candidate,
    });
  }
  return realCandidate;
}

export async function resolveExecutable(
  executable: string,
  cwd: string,
  pathValue = process.env.PATH ?? "",
  projectRoot = cwd,
): Promise<string | undefined> {
  if (isAbsolute(executable)) {
    try {
      await access(executable, constants.X_OK);
      return executable;
    } catch {
      return undefined;
    }
  }
  if (executable.includes("/") || executable.includes("\\")) {
    const candidate = resolve(cwd, executable);
    try {
      await access(candidate, constants.X_OK);
      const realCandidate = await realpath(candidate);
      const realRoot = await realpath(projectRoot);
      return isContained(realRoot, realCandidate) ? realCandidate : undefined;
    } catch {
      return undefined;
    }
  }
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(cwd, directory, executable);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

export async function preflightProject(
  project: ProjectConfig,
  allowedRoots: readonly string[],
): Promise<PreflightResult> {
  const checks: PreflightResult["checks"] = [];
  let projectRoot: string;
  try {
    projectRoot = await validateProjectRoot(project.path, allowedRoots);
    checks.push({ stepId: null, kind: "path", ok: true, message: "项目根目录有效" });
  } catch (error) {
    checks.push({
      stepId: null,
      kind: "path",
      ok: false,
      message: error instanceof Error ? error.message : "项目根目录无效",
    });
    return { ok: false, checks };
  }

  for (const step of project.steps) {
    await checkStep(step, projectRoot, checks);
  }
  try {
    topologicalSteps(project);
  } catch (error) {
    checks.push({
      stepId: null,
      kind: "path",
      ok: false,
      message: error instanceof Error ? error.message : "依赖关系无效",
    });
  }
  return { ok: checks.every((check) => check.ok), checks };
}

async function checkStep(
  step: ProjectStep,
  projectRoot: string,
  checks: PreflightResult["checks"],
): Promise<void> {
  const commands = [
    ["启动", step.start] as const,
    ...(step.stop ? ([["停止", step.stop]] as const) : []),
  ];
  for (const [name, command] of commands) {
    let cwd = projectRoot;
    try {
      cwd = resolveInside(projectRoot, command.cwd, "cwd");
      const cwdStat = await stat(cwd);
      if (!cwdStat.isDirectory()) throw new Error("cwd 不是目录");
      cwd = await existingRealPathInside(projectRoot, cwd, "cwd");
      checks.push({
        stepId: step.id,
        kind: "path",
        ok: true,
        message: `${name} cwd 有效`,
      });
    } catch (error) {
      checks.push({
        stepId: step.id,
        kind: "path",
        ok: false,
        message: `${name} ${error instanceof Error ? error.message : "cwd 无效"}`,
      });
    }
    const executable = await resolveExecutable(
      command.executable,
      cwd,
      process.env.PATH ?? "",
      projectRoot,
    );
    checks.push({
      stepId: step.id,
      kind: "executable",
      ok: executable !== undefined,
      message: executable ? `${name}程序可执行` : `${name}程序无法解析`,
    });
  }

  if (step.envFile) {
    try {
      const file = resolveInside(projectRoot, step.envFile, "envFile");
      const fileStat = await stat(file);
      if (!fileStat.isFile()) throw new Error("envFile 不是文件");
      await existingRealPathInside(projectRoot, file, "envFile");
      checks.push({
        stepId: step.id,
        kind: "env-file",
        ok: true,
        message: "envFile 存在且位于项目内",
      });
    } catch (error) {
      checks.push({
        stepId: step.id,
        kind: "env-file",
        ok: false,
        message: error instanceof Error ? error.message : "envFile 无效",
      });
    }
  }

  const endpoint = processProbeEndpoint(step);
  if (endpoint) {
    const available = await canListen(endpoint.host, endpoint.port);
    checks.push({
      stepId: step.id,
      kind: "port",
      ok: available,
      message: available
        ? `端口 ${endpoint.host}:${endpoint.port} 可用`
        : `端口 ${endpoint.host}:${endpoint.port} 已被占用，请先停止现有服务`,
    });
  }
}

function processProbeEndpoint(
  step: ProjectStep,
): { host: string; port: number } | undefined {
  if (step.mode !== "process") return undefined;
  if (step.probe.type === "tcp") {
    return { host: step.probe.host, port: step.probe.port };
  }
  if (step.probe.type !== "http") return undefined;
  const url = new URL(step.probe.url);
  const host = url.hostname === "localhost"
    ? "127.0.0.1"
    : url.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return { host, port };
}

async function canListen(host: string, port: number): Promise<boolean> {
  const hosts = [...new Set([host, "127.0.0.1", "::1", "0.0.0.0", "::"])];
  for (const candidate of hosts) {
    if (!await canBind(candidate, port)) return false;
  }
  return true;
}

function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    const finish = (available: boolean) => {
      server.removeAllListeners();
      resolvePromise(available);
    };
    server.unref();
    server.once("error", () => finish(false));
    server.listen({ host, port, exclusive: true, ipv6Only: false }, () => {
      server.close(() => finish(true));
    });
  });
}

export function topologicalSteps(project: ProjectConfig): ProjectStep[] {
  const byId = new Map(project.steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: ProjectStep[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new AppError("DEPENDENCY_CYCLE", "步骤依赖存在环", 400, { stepId: id });
    }
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) {
      throw new AppError("DEPENDENCY_MISSING", "依赖步骤不存在", 400, { stepId: id });
    }
    visiting.add(id);
    step.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
    ordered.push(step);
  };
  project.steps.forEach((step) => visit(step.id));
  return ordered;
}

export function redactLog(input: string): string {
  return input
    .replace(
      /((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*)([^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function commandCwd(project: ProjectConfig, step: ProjectStep): string {
  return resolveInside(project.path, step.start.cwd, "cwd");
}
