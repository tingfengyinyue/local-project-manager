import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, getHttpServices, type LogEntry } from "../api";
import { StatusBadge } from "./StatusBadge";

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : "发生未知错误";
}

type CommandConfig = {
  executable: string;
  args: string[];
  cwd: string;
};

function shellQuote(value: string) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function commandCwd(projectPath: string, cwd: string) {
  if (cwd.startsWith("/")) return cwd;
  if (!cwd || cwd === ".") return projectPath;
  return `${projectPath}/${cwd.replace(/^\.\//, "")}`;
}

function fullCommand(projectPath: string, command: CommandConfig) {
  const invocation = [command.executable, ...command.args].map(shellQuote).join(" ");
  return `cd ${shellQuote(commandCwd(projectPath, command.cwd))} && ${invocation}`;
}

function probeLabel(probe: {
  type: "process" | "tcp" | "http";
  host?: string;
  port?: number;
  url?: string;
  expectedStatus?: number;
  timeoutMs?: number;
}) {
  if (probe.type === "tcp") {
    return `TCP ${probe.host}:${probe.port} · 超时 ${probe.timeoutMs} ms`;
  }
  if (probe.type === "http") {
    return `HTTP ${probe.url} · 期望 ${probe.expectedStatus} · 超时 ${probe.timeoutMs} ms`;
  }
  return "进程存活探针";
}

export function ProjectDetail() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "retrying">("connecting");
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
    enabled: Boolean(id),
  });
  const runtimeQuery = useQuery({
    queryKey: ["runtime", id],
    queryFn: () => api.runtime(id),
    enabled: Boolean(id),
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (!id) return;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setStreamState((state) => state === "live" ? "retrying" : "connecting");
      source = new EventSource(`/api/projects/${encodeURIComponent(id)}/logs`);
      source.onopen = () => setStreamState("live");
      source.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data) as LogEntry;
          if (
            typeof entry.timestamp === "string" &&
            (typeof entry.stepId === "string" || entry.stepId === null) &&
            typeof entry.stream === "string" &&
            typeof entry.message === "string"
          ) {
            setLogs((current) => [...current.slice(-499), entry]);
          }
        } catch {
          // 忽略无法识别的日志帧，运行状态始终由 REST 快照决定。
        }
      };
      source.onerror = () => {
        setStreamState("retrying");
        source?.close();
        timer = setTimeout(connect, 1800);
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);

  const action = useMutation({
    mutationFn: async (kind: "start" | "stop" | "restart") => {
      if (kind === "restart") {
        await api.stop(id);
        return api.start(id);
      }
      return api[kind](id);
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["runtime", id], snapshot);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["runtime", id] });
    },
  });

  if (projectQuery.isPending || runtimeQuery.isPending) {
    return <main className="detail-page"><div className="loading-rack">正在读取项目快照…</div></main>;
  }
  if (projectQuery.isError || runtimeQuery.isError || !projectQuery.data || !runtimeQuery.data) {
    return (
      <main className="detail-page">
        <Link to="/" className="back-link">← 返回控制台</Link>
        <div className="empty-state empty-state--error" role="alert">
          <strong>项目详情不可用</strong>
          <p>{errorMessage(projectQuery.error ?? runtimeQuery.error)}</p>
        </div>
      </main>
    );
  }

  const project = projectQuery.data;
  const runtime = runtimeQuery.data;
  const services = getHttpServices(project);
  const controlsLocked = action.isPending || Boolean(runtime.operationId) ||
    runtime.status === "starting" || runtime.status === "stopping";
  const isExternal = runtime.status === "running" && Boolean(runtime.external);

  async function copyCommand(key: string, command: string) {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(key);
    window.setTimeout(() => {
      setCopiedCommand((current) => current === key ? null : current);
    }, 2500);
  }

  return (
    <main className="detail-page">
      <header className="detail-header">
        <div>
          <Link to="/" className="back-link">← 返回控制台</Link>
          <div className="detail-title">
            <span className="detail-icon" aria-hidden="true">{project.icon}</span>
            <div>
              <p className="detail-meta">项目 {project.id.slice(0, 8)}</p>
              <h1>{project.name}</h1>
              <code>{project.path}</code>
            </div>
          </div>
        </div>
        <div className="detail-command">
          <StatusBadge status={runtime.status} external={isExternal} />
          <button
            className={`button button--run${runtime.status === "running" ? " button--running" : ""}`}
            disabled={controlsLocked || runtime.status === "running"}
            onClick={() => action.mutate("start")}
          >
            {isExternal ? "已运行" : runtime.status === "running" ? "运行中" : "启动"}
          </button>
          <button className="button" disabled={controlsLocked || runtime.status === "stopped" || isExternal} onClick={() => action.mutate("stop")}>停止</button>
          <button className="button" disabled={controlsLocked || isExternal} onClick={() => action.mutate("restart")}>重启</button>
        </div>
      </header>

      {(runtime.error || action.error) && (
        <div className="fault-banner" role="alert">
          <span>FAULT</span>
          {runtime.error ?? errorMessage(action.error)}
        </div>
      )}

      <section className="project-profile" aria-labelledby="project-profile-title">
        <div className="project-profile__intro">
          <p className="panel-context">项目档案</p>
          <h2 id="project-profile-title">项目介绍</h2>
          <p className="project-profile__description">
            {project.description || "尚未填写项目介绍。可以在编辑配置中补充项目用途、主要功能和技术栈。"}
          </p>
          <div className="tag-list" aria-label="项目标签">
            {project.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
            {!project.enabled && <span className="tag tag--muted">已禁用</span>}
          </div>
        </div>
        <dl className="project-profile__facts">
          <div><dt>项目目录</dt><dd><code>{project.path}</code></dd></div>
          <div><dt>配置状态</dt><dd>{project.enabled ? "已启用" : "已禁用"}</dd></div>
          <div><dt>执行步骤</dt><dd>{project.steps.length} 个</dd></div>
          <div>
            <dt>配置更新</dt>
            <dd>{new Date(project.updatedAt).toLocaleString("zh-CN", { hour12: false })}</dd>
          </div>
        </dl>
      </section>

      <section className="command-plan" aria-labelledby="command-plan-title">
        <header className="panel-title">
          <div><p className="panel-context">启动清单</p><h2 id="command-plan-title">完整启动命令</h2></div>
          <span>按依赖顺序执行 {project.steps.length} 步</span>
        </header>
        <ol className="command-plan__list">
          {project.steps.map((step, index) => {
            const startCommand = fullCommand(project.path, step.start);
            const stopCommand = step.stop ? fullCommand(project.path, step.stop) : null;
            const startKey = `${step.id}:start`;
            const stopKey = `${step.id}:stop`;
            return (
              <li className="command-step" key={step.id}>
                <div className="command-step__heading">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.name}</h3>
                    <p>{step.type} · {step.mode === "process" ? "长驻进程" : "一次性任务"}</p>
                  </div>
                </div>
                <div className="command-step__body">
                  <div className="command-block">
                    <span className="command-block__label">启动</span>
                    <code><b aria-hidden="true">$</b> {startCommand}</code>
                    <button
                      type="button"
                      className="command-copy"
                      data-state={copiedCommand === startKey ? "success" : "default"}
                      onClick={() => void copyCommand(startKey, startCommand)}
                    >
                      {copiedCommand === startKey ? "已复制" : "复制"}
                    </button>
                  </div>
                  {stopCommand && (
                    <div className="command-block">
                      <span className="command-block__label">停止</span>
                      <code><b aria-hidden="true">$</b> {stopCommand}</code>
                      <button
                        type="button"
                        className="command-copy"
                        data-state={copiedCommand === stopKey ? "success" : "default"}
                        onClick={() => void copyCommand(stopKey, stopCommand)}
                      >
                        {copiedCommand === stopKey ? "已复制" : "复制"}
                      </button>
                    </div>
                  )}
                  <dl className="command-step__meta">
                    <div>
                      <dt>依赖</dt>
                      <dd>{step.dependsOn.length ? step.dependsOn.join(" → ") : "无"}</dd>
                    </div>
                    <div>
                      <dt>环境文件</dt>
                      <dd>{step.envFile ?? "未配置"}</dd>
                    </div>
                    <div>
                      <dt>健康探针</dt>
                      <dd>{probeLabel(step.probe)}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="detail-grid">
        <div className="step-rack">
          <header className="panel-title">
            <div><p className="panel-context">执行序列</p><h2>步骤状态</h2></div>
            <span>{runtime.steps.length} 个步骤</span>
          </header>
          <ol>
            {project.steps.map((step, index) => {
              const state = runtime.steps.find((item) => item.stepId === step.id);
              const status = state?.status ?? "pending";
              return (
                <li className={`runtime-step runtime-step--${status}`} key={step.id}>
                  <span className="runtime-step__number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{step.name}</strong>
                    <code>{step.start.executable} {step.start.args.join(" ")}</code>
                    {state?.error && <p role="alert">{state.error}</p>}
                  </div>
                  <div className="runtime-step__meta">
                    <span>{status.toUpperCase()}</span>
                    <small>{state?.pid ? `PID ${state.pid}` : "NO PID"}</small>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="service-panel">
            <p className="panel-context">HTTP 服务</p>
            {services.length ? services.map((url) => (
              <a className="service-link" key={url} href={url} target="_blank" rel="noreferrer">
                <span>{url}</span><strong>打开 ↗</strong>
              </a>
            )) : <p>没有配置 HTTP 探针</p>}
          </div>
        </div>

        <section className="log-console" aria-label="实时日志">
          <header className="panel-title">
            <div><p className="panel-context">进程输出</p><h2>实时日志</h2></div>
            <span className={`stream-state stream-state--${streamState}`}>
              <i aria-hidden="true" />{streamState === "live" ? "SSE 在线" : streamState === "retrying" ? "正在重连" : "正在连接"}
            </span>
          </header>
          <div className="log-console__toolbar">
            <span>保留最近 500 条</span>
            <button className="text-button" onClick={() => setLogs([])}>清空终端</button>
          </div>
          <div className="log-lines" aria-live="polite" aria-relevant="additions">
            {logs.length === 0 && <p className="log-placeholder">$ 等待进程输出_</p>}
            {logs.map((log, index) => (
              <div className={`log-line log-line--${log.stream}`} key={`${log.timestamp}-${index}`}>
                <time>{new Date(log.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</time>
                <span>[{log.stepId ?? "project"}]</span>
                <pre>{log.message}</pre>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      </section>
    </main>
  );
}

