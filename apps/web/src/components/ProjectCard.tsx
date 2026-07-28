import { Link } from "react-router-dom";
import { getHttpServices, type ProjectRecord } from "../api";
import { StatusBadge } from "./StatusBadge";

type Action = "start" | "stop" | "restart" | "preflight";

type Props = {
  record: ProjectRecord;
  busyAction: Action | undefined;
  onAction: (id: string, action: Action) => void;
  onEdit: (id: string) => void;
};

function portLabel(record: ProjectRecord) {
  const ports = record.project.steps.flatMap((step) => {
    if (step.probe.type === "tcp") return [`${step.probe.host}:${step.probe.port}`];
    if (step.probe.type === "http") {
      try {
        const url = new URL(step.probe.url);
        return [`${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`];
      } catch {
        return [step.probe.url];
      }
    }
    return [];
  });
  return ports.length ? ports.join(" · ") : "无端口探针";
}

function serviceLabel(serviceUrl: string) {
  try {
    const url = new URL(serviceUrl);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return serviceUrl;
  }
}

export function ProjectCard({ record, busyAction, onAction, onEdit }: Props) {
  const { project, runtime } = record;
  const isBusy = Boolean(busyAction);
  const controlsLocked = isBusy || Boolean(runtime.operationId) ||
    runtime.status === "starting" || runtime.status === "stopping";
  const isRunning = runtime.status === "running";
  const isExternal = isRunning && Boolean(runtime.external);
  const runningCount = runtime.steps.filter((step) => step.status === "running").length;
  const serviceUrl = getHttpServices(project)[0];

  return (
    <article className={`project-card project-card--${runtime.status}`}>
      <div className="project-card__rail" aria-hidden="true">
        <span>{String(project.steps.length).padStart(2, "0")}</span>
      </div>
      <div className="project-card__body">
        <section className="project-card__overview">
          <header className="project-card__header">
            <span className="project-icon" aria-hidden="true">{project.icon}</span>
            <div className="project-card__identity">
              <Link to={`/projects/${project.id}`} className="project-card__title">
                {project.name}
              </Link>
              <code title={project.path}>{project.path}</code>
            </div>
            <StatusBadge status={runtime.status} external={isExternal} />
          </header>

          {project.description && <p className="project-card__description">{project.description}</p>}

          <div className="tag-list" aria-label="项目标签">
            {project.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
            {!project.enabled && <span className="tag tag--muted">已禁用</span>}
          </div>
        </section>

        <section className="project-card__controls">
          <div className="project-card__telemetry">
            <div>
              <span className="label">步骤</span>
              <strong>{runningCount}/{project.steps.length}</strong>
            </div>
            <div>
              <span className="label">端口 / 服务</span>
              {serviceUrl ? (
                <a
                  className="project-card__service"
                  href={serviceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`打开 ${serviceUrl}`}
                >
                  <strong>{serviceLabel(serviceUrl)}</strong>
                  <span>打开 ↗</span>
                </a>
              ) : <strong>{portLabel(record)}</strong>}
            </div>
            <div>
              <span className="label">更新</span>
              <strong>{new Date(runtime.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</strong>
            </div>
          </div>

          {runtime.error && <p className="inline-error" role="alert">{runtime.error}</p>}

          <footer className="project-card__actions">
            <button
              className={`button button--run${isRunning ? " button--running" : ""}`}
              disabled={controlsLocked || !project.enabled || isRunning}
              onClick={() => onAction(project.id, "start")}
            >
              {isExternal ? "已运行" : isRunning ? "运行中" : busyAction === "start" ? "启动中…" : "启动"}
            </button>
            <button
              className="button"
              disabled={controlsLocked || runtime.status === "stopped" || isExternal}
              onClick={() => onAction(project.id, "stop")}
            >
              {busyAction === "stop" ? "停止中…" : "停止"}
            </button>
            <button
              className="button"
              disabled={controlsLocked || !project.enabled || isExternal}
              onClick={() => onAction(project.id, "restart")}
            >
              {busyAction === "restart" ? "重启中…" : "重启"}
            </button>
            <button
              className="button button--quiet"
              disabled={controlsLocked}
              onClick={() => onAction(project.id, "preflight")}
            >
              {busyAction === "preflight" ? "检查中…" : "预检"}
            </button>
            <Link className="button button--quiet" to={`/projects/${project.id}`}>详情</Link>
            <button className="button button--quiet" disabled={controlsLocked} onClick={() => onEdit(project.id)}>
              编辑
            </button>
          </footer>
        </section>
      </div>
    </article>
  );
}

