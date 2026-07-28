import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import { isAbsolute, relative } from "node:path";
import { parseEnv } from "node:util";
import {
  type ProjectConfig,
  type ProjectStatus,
  type ProjectStep,
  type RuntimeSnapshot,
} from "@lpm/contracts";
import { ProjectStore } from "./database.js";
import { AppError } from "./errors.js";
import {
  preflightProject,
  redactLog,
  resolveInside,
  topologicalSteps,
} from "./security.js";

type StepRuntime = RuntimeSnapshot["steps"][number];
type LogListener = (entry: LogEntry) => void;

export interface LogEntry {
  timestamp: string;
  projectId: string;
  stepId: string | null;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

interface ManagedProcess {
  stepId: string;
  pid: number;
  child: ChildProcess;
}

const TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  stopped: ["starting"],
  starting: ["running", "failed"],
  running: ["stopping", "failed"],
  stopping: ["stopped", "failed"],
  failed: ["starting", "stopping", "stopped"],
  unknown: ["stopping", "stopped"],
};

export class RuntimeManager {
  private readonly runtimes = new Map<string, RuntimeSnapshot>();
  private readonly processes = new Map<string, Map<string, ManagedProcess>>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly listeners = new Map<string, Set<LogListener>>();
  private readonly logs = new Map<string, LogEntry[]>();

  constructor(
    private readonly store: ProjectStore,
    readonly allowedRoots: readonly string[],
  ) {}

  get(project: ProjectConfig): RuntimeSnapshot {
    const cached = this.runtimes.get(project.id);
    if (cached) return structuredClone(cached);
    const persisted = this.store.getRuntime(project.id);
    const status =
      persisted &&
      ["starting", "running", "stopping"].includes(persisted.status)
        ? "unknown"
        : (persisted?.status ?? "stopped");
    const runtime: RuntimeSnapshot = {
      projectId: project.id,
      status,
      operationId: null,
      steps: project.steps.map((step) => {
        const old = persisted?.steps.find((item) => item.stepId === step.id);
        return {
          stepId: step.id,
          status: status === "unknown" && old?.status === "running" ? "failed" : "stopped",
          pid: null,
          startedAt: old?.startedAt ?? null,
          error: status === "unknown" ? "服务重启后无法确认原进程身份" : null,
        };
      }),
      error: status === "unknown" ? "服务重启后运行状态未知" : (persisted?.error ?? null),
      updatedAt: new Date().toISOString(),
    };
    this.persist(runtime);
    return structuredClone(runtime);
  }

  async observe(project: ProjectConfig): Promise<RuntimeSnapshot> {
    const runtime = this.get(project);
    if (
      runtime.operationId ||
      !["stopped", "failed", "unknown"].includes(runtime.status)
    ) {
      return runtime;
    }
    const observableSteps = project.steps.filter(
      (step) => step.mode === "process" && step.probe.type !== "process",
    );
    if (!observableSteps.length) return runtime;
    const health = await Promise.all(
      observableSteps.map((step) => probeOnce(step)),
    );
    if (!health.every(Boolean)) return runtime;
    return {
      ...runtime,
      status: "running",
      external: true,
      operationId: null,
      steps: runtime.steps.map((step) => ({
        ...step,
        status: "running",
        pid: null,
        error: null,
      })),
      error: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async preflight(project: ProjectConfig) {
    return preflightProject(project, this.allowedRoots);
  }

  async start(project: ProjectConfig): Promise<RuntimeSnapshot> {
    return this.exclusive(project.id, async () => {
      if (!project.enabled) {
        throw new AppError("PROJECT_DISABLED", "项目已禁用，不能启动", 409);
      }
      let runtime = this.get(project);
      if (runtime.status === "running") return runtime;
      this.transition(runtime, "starting");
      runtime.operationId = randomUUID();
      runtime.error = null;
      runtime.steps = project.steps.map((step) => freshStep(step.id));
      this.persist(runtime);
      this.log(project.id, null, "system", "开始启动项目");

      const preflight = await this.preflight(project);
      if (!preflight.ok) {
        const failures = preflight.checks
          .filter((check) => !check.ok)
          .map((check) => check.message);
        runtime.error = `启动前检查失败：${failures.join("；")}`;
        this.transition(runtime, "failed");
        this.persist(runtime);
        throw new AppError("PREFLIGHT_FAILED", runtime.error, 422, {
          checks: preflight.checks,
        });
      }

      const started: ProjectStep[] = [];
      try {
        for (const step of topologicalSteps(project)) {
          const stepRuntime = requireStep(runtime, step.id);
          stepRuntime.status = "starting";
          this.persist(runtime);
          started.push(step);
          await this.startStep(project, step, stepRuntime);
          this.persist(runtime);
        }
        this.transition(runtime, "running");
        runtime.operationId = null;
        this.persist(runtime);
        this.log(project.id, null, "system", "项目启动完成");
        return structuredClone(runtime);
      } catch (error) {
        this.log(
          project.id,
          null,
          "system",
          `启动失败，开始回滚：${messageOf(error)}`,
        );
        for (const step of started.reverse()) {
          try {
            await this.stopStep(project, step, requireStep(runtime, step.id));
          } catch (rollbackError) {
            this.log(
              project.id,
              step.id,
              "system",
              `回滚失败：${messageOf(rollbackError)}`,
            );
          }
        }
        runtime.error = messageOf(error);
        runtime.operationId = null;
        this.transition(runtime, "failed");
        this.persist(runtime);
        throw error instanceof AppError
          ? error
          : new AppError("START_FAILED", "项目启动失败", 500, {
              reason: messageOf(error),
            });
      }
    });
  }

  async stop(project: ProjectConfig): Promise<RuntimeSnapshot> {
    return this.exclusive(project.id, async () => {
      const runtime = this.get(project);
      if (runtime.status === "stopped") return runtime;
      if (!["running", "failed", "unknown"].includes(runtime.status)) {
        throw new AppError("INVALID_STATE", "当前状态不允许停止", 409, {
          status: runtime.status,
        });
      }
      this.transition(runtime, "stopping");
      runtime.operationId = randomUUID();
      this.persist(runtime);
      this.log(project.id, null, "system", "开始停止项目");
      const failures: Array<{ stepId: string; reason: string }> = [];
      for (const step of topologicalSteps(project).reverse()) {
        const stepRuntime = requireStep(runtime, step.id);
        if (stepRuntime.status === "stopped" && runtime.status !== "unknown") continue;
        try {
          await this.stopStep(project, step, stepRuntime);
        } catch (error) {
          failures.push({ stepId: step.id, reason: messageOf(error) });
        }
        this.persist(runtime);
      }
      runtime.operationId = null;
      if (failures.length) {
        runtime.error = "部分步骤停止失败";
        this.transition(runtime, "failed");
        this.persist(runtime);
        throw new AppError("STOP_FAILED", "部分步骤停止失败", 500, { failures });
      }
      runtime.error = null;
      this.transition(runtime, "stopped");
      this.persist(runtime);
      this.log(project.id, null, "system", "项目已停止");
      return structuredClone(runtime);
    });
  }

  assertMutable(project: ProjectConfig): void {
    const status = this.get(project).status;
    if (status !== "stopped" && status !== "failed") {
      throw new AppError("PROJECT_BUSY", "运行中的项目不能修改或删除", 409, {
        status,
      });
    }
  }

  reset(project: ProjectConfig): RuntimeSnapshot {
    const runtime: RuntimeSnapshot = {
      projectId: project.id,
      status: "stopped",
      operationId: null,
      steps: project.steps.map((step) => freshStep(step.id)),
      error: null,
      updatedAt: new Date().toISOString(),
    };
    this.persist(runtime);
    return structuredClone(runtime);
  }

  forget(projectId: string): void {
    this.runtimes.delete(projectId);
    this.processes.delete(projectId);
    this.logs.delete(projectId);
  }

  async shutdown(projects: readonly ProjectConfig[]): Promise<void> {
    for (const project of projects) {
      const status = this.get(project).status;
      if (status === "stopped") continue;
      try {
        await this.stop(project);
      } catch (error) {
        this.log(
          project.id,
          null,
          "system",
          `服务关闭时停止失败：${messageOf(error)}`,
        );
      }
    }
  }

  subscribe(projectId: string, listener: LogListener): () => void {
    for (const entry of this.logs.get(projectId) ?? []) listener(entry);
    const listeners = this.listeners.get(projectId) ?? new Set<LogListener>();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  private async startStep(
    project: ProjectConfig,
    step: ProjectStep,
    runtime: StepRuntime,
  ): Promise<void> {
    const child = this.spawnCommand(project, step, step.start);
    if (!child.pid) throw new Error("子进程未返回 PID");
    this.pipeLogs(project.id, step.id, child);
    await waitForSpawn(child);
    runtime.pid = step.mode === "process" ? child.pid : null;
    runtime.startedAt = new Date().toISOString();

    if (step.mode === "task") {
      const result = await waitForExit(child);
      if (result.code !== 0) {
        runtime.status = "failed";
        runtime.error = `启动任务退出码 ${String(result.code)}`;
        throw new Error(runtime.error);
      }
      if (step.probe.type !== "process") {
        await this.waitForProbe(step);
      }
    } else {
      const managed: ManagedProcess = { stepId: step.id, pid: child.pid, child };
      const projectProcesses =
        this.processes.get(project.id) ?? new Map<string, ManagedProcess>();
      projectProcesses.set(step.id, managed);
      this.processes.set(project.id, projectProcesses);
      child.once("exit", (code, signal) => {
        if (projectProcesses.get(step.id) !== managed) return;
        projectProcesses.delete(step.id);
        const current = this.runtimes.get(project.id);
        const currentStep = current?.steps.find((item) => item.stepId === step.id);
        if (current?.status === "running" && currentStep?.status === "running") {
          currentStep.status = "failed";
          currentStep.pid = null;
          currentStep.error = `进程意外退出（code=${String(code)}, signal=${String(signal)}）`;
          current.error = `步骤 ${step.id} 意外退出`;
          this.transition(current, "failed");
          this.persist(current);
        }
      });
      await this.waitForProbe(step, child);
    }
    runtime.status = "running";
    runtime.error = null;
    this.log(project.id, step.id, "system", "步骤已运行");
  }

  private async stopStep(
    project: ProjectConfig,
    step: ProjectStep,
    runtime: StepRuntime,
  ): Promise<void> {
    runtime.status = "stopping";
    if (step.mode === "task") {
      if (step.stop) {
        const child = this.spawnCommand(project, step, step.stop);
        this.pipeLogs(project.id, step.id, child);
        await waitForSpawn(child);
        const result = await waitForExit(child);
        if (result.code !== 0) throw new Error(`停止任务退出码 ${String(result.code)}`);
      }
    } else {
      const managed = this.processes.get(project.id)?.get(step.id);
      if (managed && managed.child.pid === managed.pid && managed.child.exitCode === null) {
        await terminateManaged(managed);
        this.processes.get(project.id)?.delete(step.id);
      } else if (runtime.pid !== null) {
        throw new Error("进程句柄不匹配，拒绝发送停止信号");
      }
    }
    runtime.status = "stopped";
    runtime.pid = null;
    runtime.error = null;
    this.log(project.id, step.id, "system", "步骤已停止");
  }

  private spawnCommand(
    project: ProjectConfig,
    step: ProjectStep,
    command: ProjectStep["start"],
  ): ChildProcess {
    const cwd = resolveInside(project.path, command.cwd, "cwd");
    this.log(project.id, step.id, "system", `执行 ${command.executable}`);
    return spawn(command.executable, command.args, {
      cwd,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...loadStepEnv(project, step) },
    });
  }

  private pipeLogs(projectId: string, stepId: string, child: ChildProcess): void {
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) =>
      this.log(projectId, stepId, "stdout", chunk),
    );
    child.stderr?.on("data", (chunk: string) =>
      this.log(projectId, stepId, "stderr", chunk),
    );
  }

  private async waitForProbe(step: ProjectStep, child?: ChildProcess): Promise<void> {
    if (step.probe.type === "process") {
      if (!child) throw new Error("进程探针缺少子进程");
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
      if (child.exitCode !== null) throw new Error("进程启动后立即退出");
      return;
    }
    const deadline = Date.now() + step.probe.timeoutMs;
    let lastError = "探针超时";
    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) throw new Error("进程在探针成功前退出");
      try {
        if (step.probe.type === "tcp") {
          await tcpProbe(step.probe.host, step.probe.port);
        } else {
          const response = await fetch(step.probe.url, {
            signal: AbortSignal.timeout(Math.min(1_000, step.probe.timeoutMs)),
          });
          if (response.status !== step.probe.expectedStatus) {
            throw new Error(`HTTP 状态码 ${response.status}`);
          }
        }
        return;
      } catch (error) {
        lastError = messageOf(error);
        await delay(100);
      }
    }
    throw new Error(`探针失败：${lastError}`);
  }

  private transition(runtime: RuntimeSnapshot, next: ProjectStatus): void {
    if (!TRANSITIONS[runtime.status].includes(next)) {
      throw new AppError("INVALID_STATE_TRANSITION", "非法状态转换", 409, {
        from: runtime.status,
        to: next,
      });
    }
    runtime.status = next;
    runtime.updatedAt = new Date().toISOString();
  }

  private persist(runtime: RuntimeSnapshot): void {
    runtime.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(runtime);
    this.runtimes.set(runtime.projectId, snapshot);
    this.store.saveRuntime(snapshot);
  }

  private log(
    projectId: string,
    stepId: string | null,
    stream: LogEntry["stream"],
    message: string,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      projectId,
      stepId,
      stream,
      message: redactLog(message).trimEnd(),
    };
    const entries = this.logs.get(projectId) ?? [];
    entries.push(entry);
    if (entries.length > 500) entries.splice(0, entries.length - 500);
    this.logs.set(projectId, entries);
    for (const listener of this.listeners.get(projectId) ?? []) listener(entry);
  }

  private async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const queued = previous.then(() => current);
    this.locks.set(id, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === queued) this.locks.delete(id);
    }
  }
}

function freshStep(stepId: string): StepRuntime {
  return {
    stepId,
    status: "pending",
    pid: null,
    startedAt: null,
    error: null,
  };
}

function requireStep(runtime: RuntimeSnapshot, id: string): StepRuntime {
  const step = runtime.steps.find((item) => item.stepId === id);
  if (!step) throw new Error(`运行时缺少步骤 ${id}`);
  return step;
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  if (child.pid) return;
  await Promise.race([
    once(child, "spawn").then(() => undefined),
    once(child, "error").then(([error]) => Promise.reject(error)),
  ]);
}

async function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode };
  const [code, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  return { code, signal };
}

async function terminateManaged(managed: ManagedProcess): Promise<void> {
  if (managed.child.pid !== managed.pid || managed.child.exitCode !== null) return;
  try {
    process.kill(-managed.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return;
  }
  const exited = waitForExit(managed.child).then(() => true);
  if (await Promise.race([exited, delay(3_000).then(() => false)])) return;
  if (managed.child.pid === managed.pid && managed.child.exitCode === null) {
    try {
      process.kill(-managed.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await waitForExit(managed.child);
  }
}

function tcpProbe(host: string, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("TCP 探针超时"));
    });
    socket.once("error", reject);
  });
}

async function probeOnce(step: ProjectStep): Promise<boolean> {
  try {
    if (step.probe.type === "tcp") {
      await tcpProbe(step.probe.host, step.probe.port);
    } else if (step.probe.type === "http") {
      const response = await fetch(step.probe.url, {
        signal: AbortSignal.timeout(800),
      });
      if (response.status !== step.probe.expectedStatus) return false;
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? redactLog(error.message) : "未知错误";
}

function loadStepEnv(project: ProjectConfig, step: ProjectStep): Record<string, string> {
  if (!step.envFile) return {};
  const file = realpathSync(resolveInside(project.path, step.envFile, "envFile"));
  const root = realpathSync(project.path);
  const rel = relative(root, file);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new AppError("SYMLINK_ESCAPE", "envFile 通过符号链接逃逸项目根目录", 400);
  }
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(file, "utf8"))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
