import type { ProjectStatus } from "@lpm/contracts";

const statusText: Record<ProjectStatus, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  failed: "故障",
  unknown: "未知",
};

export function StatusBadge({
  status,
  external = false,
}: {
  status: ProjectStatus;
  external?: boolean;
}) {
  const text = status === "running" && external ? "外部运行" : statusText[status];
  return (
    <span className={`status status--${status}`} aria-label={`状态：${text}`}>
      <span className="status__signal" aria-hidden="true" />
      {text}
    </span>
  );
}

