import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { PreflightResult, ProjectInput, RuntimeSnapshot } from "@lpm/contracts";
import { api, ApiError, type ProjectRecord } from "./api";
import { ProjectCard } from "./components/ProjectCard";
import { ProjectDetail } from "./components/ProjectDetail";
import { ProjectForm } from "./components/ProjectForm";
import { StatusBadge } from "./components/StatusBadge";

type Action = "start" | "stop" | "restart" | "preflight";

function messageOf(error: unknown) {
  if (error instanceof ApiError) return `${error.message}${error.code ? ` · ${error.code}` : ""}`;
  return error instanceof Error ? error.message : "发生未知错误";
}

function HomePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [busy, setBusy] = useState<Record<string, Action>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preflight, setPreflight] = useState<{ name: string; result: PreflightResult } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [commandActive, setCommandActive] = useState(0);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandPanelRef = useRef<HTMLElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    refetchInterval: 5000,
  });

  const records = projectsQuery.data?.projects ?? [];
  const tags = useMemo(
    () => [...new Set(records.flatMap((record) => record.project.tags))].sort(),
    [records],
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return records.filter(({ project, runtime }) => {
      const matchesText = !needle || [project.name, project.path, project.description, ...project.tags]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(needle));
      return matchesText && (status === "all" || runtime.status === status) &&
        (tag === "all" || project.tags.includes(tag));
    });
  }, [records, search, status, tag]);
  const commandResults = useMemo(() => {
    const needle = commandSearch.trim().toLocaleLowerCase("zh-CN");
    return records.filter(({ project }) =>
      !needle ||
      [project.name, project.path, ...project.tags].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(needle),
      ),
    );
  }, [commandSearch, records]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (commandOpen) {
      setCommandActive(0);
      requestAnimationFrame(() => commandInputRef.current?.focus());
    } else {
      setCommandSearch("");
    }
  }, [commandOpen]);

  function closeCommandPalette() {
    setCommandOpen(false);
    requestAnimationFrame(() => commandTriggerRef.current?.focus());
  }

  function openCommandResult(index: number) {
    const result = commandResults[index];
    if (!result) return;
    setCommandOpen(false);
    navigate(`/projects/${result.project.id}`);
  }

  function trapCommandFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      commandPanelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function putRuntime(id: string, runtime: RuntimeSnapshot) {
    queryClient.setQueryData<{ projects: ProjectRecord[] }>(["projects"], (current) => current ? ({
      projects: current.projects.map((record) =>
        record.project.id === id ? { ...record, runtime } : record,
      ),
    }) : current);
  }

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: Action }) => {
      if (action === "preflight") return api.preflight(id);
      if (action === "restart") {
        putRuntime(id, await api.stop(id));
        return api.start(id);
      }
      return api[action](id);
    },
  });

  async function runAction(id: string, action: Action) {
    if (busy[id]) return;
    setBusy((current) => ({ ...current, [id]: action }));
    setNotice(null);
    try {
      const result = await actionMutation.mutateAsync({ id, action });
      const record = records.find(({ project }) => project.id === id);
      if (action === "preflight") {
        setPreflight({ name: record?.project.name ?? "项目", result: result as PreflightResult });
      } else {
        putRuntime(id, result as RuntimeSnapshot);
        setNotice({ tone: "ok", text: `${record?.project.name ?? "项目"}：${action === "start" ? "启动指令已完成" : action === "stop" ? "停止指令已完成" : "重启指令已完成"}` });
      }
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProjectInput }) =>
      id ? api.updateProject(id, input) : api.createProject(input),
    onSuccess: async () => {
      setEditing(null);
      setNotice({ tone: "ok", text: "项目配置已保存" });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: async () => {
      setEditing(null);
      setNotice({ tone: "ok", text: "项目已删除" });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const editingRecord = editing && editing !== "new"
    ? records.find(({ project }) => project.id === editing)
    : undefined;
  const operationError = saveMutation.error ?? deleteMutation.error;

  return (
    <div className="app-shell">
      <header className="topbar" inert={commandOpen ? true : undefined}>
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="img">
              <path d="M6.5 24.5h19" />
              <rect x="7.5" y="10" width="5" height="10.5" rx="1.5" />
              <rect x="14" y="13" width="5" height="7.5" rx="1.5" opacity=".72" />
              <rect x="20.5" y="7" width="4" height="13.5" rx="1.5" opacity=".42" />
            </svg>
          </span>
          <div>
            <strong>项目坞</strong>
            <small>本地项目管理</small>
          </div>
        </div>
        <button
          ref={commandTriggerRef}
          className="command-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={commandOpen}
          onClick={() => setCommandOpen(true)}
        >
          <span>搜索并打开项目</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="topbar__meta">
          <span>
            <i className={`live-dot${projectsQuery.isError ? " live-dot--fault" : ""}`} />
            {projectsQuery.isPending ? "正在建立链路" : projectsQuery.isError ? "控制链路断开" : "控制链路在线"}
          </span>
          <button className="button button--run" onClick={() => setEditing("new")}>＋ 登记项目</button>
        </div>
      </header>

      <main className="dashboard" inert={commandOpen ? true : undefined}>
        <section className="hero">
          <div>
            <p className="workspace-kicker">项目注册表</p>
            <h1>运行<span>工作台</span></h1>
            <p>预检依赖，启动本机服务，沿执行步骤读取真实状态。</p>
          </div>
          <div className="summary-strip" aria-label="项目统计">
            <div><span>登记</span><strong>{records.length}</strong></div>
            <div><span>运行</span><strong>{records.filter((item) => item.runtime.status === "running").length}</strong></div>
            <div><span>故障</span><strong className="fault-text">{records.filter((item) => item.runtime.status === "failed").length}</strong></div>
          </div>
        </section>

        <section className="filters" aria-label="项目筛选">
          <label className="search-field">
            <span className="visually-hidden">搜索项目</span>
            <b aria-hidden="true">⌕</b>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称、路径或标签…" />
          </label>
          <label>
            <span>状态</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">全部状态</option>
              <option value="running">运行中</option>
              <option value="stopped">已停止</option>
              <option value="starting">启动中</option>
              <option value="stopping">停止中</option>
              <option value="failed">故障</option>
              <option value="unknown">未知</option>
            </select>
          </label>
          <label>
            <span>标签</span>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="all">全部标签</option>
              {tags.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <button className="button button--quiet" onClick={() => { setSearch(""); setStatus("all"); setTag("all"); }}>清除筛选</button>
          <span className="filter-count">显示 {visible.length} / {records.length}</span>
        </section>

        {notice && <div className={`notice notice--${notice.tone}`} role="status"><span>{notice.tone === "ok" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
        {operationError && <div className="notice notice--error" role="alert"><span>!</span>{messageOf(operationError)}</div>}

        {projectsQuery.isPending && <div className="loading-rack">正在同步项目清单…</div>}
        {projectsQuery.isError && (
          <div className="empty-state empty-state--error" role="alert">
            <strong>无法连接项目服务</strong>
            <p>{messageOf(projectsQuery.error)}</p>
            <button className="button" onClick={() => void projectsQuery.refetch()}>重新连接</button>
          </div>
        )}
        {!projectsQuery.isPending && !projectsQuery.isError && visible.length === 0 && (
          <div className="empty-state">
            <strong>{records.length ? "没有符合条件的项目" : "控制台还是空的"}</strong>
            <p>{records.length ? "调整筛选条件，或清除当前筛选。" : "登记第一个项目，配置它的启动步骤与健康探针。"}</p>
            {!records.length && <button className="button button--run" onClick={() => setEditing("new")}>登记第一个项目</button>}
          </div>
        )}

        <section className="project-grid" aria-label="项目列表">
          {visible.map((record) => (
            <ProjectCard
              key={record.project.id}
              record={record}
              busyAction={busy[record.project.id]}
              onAction={(id, action) => void runAction(id, action)}
              onEdit={setEditing}
            />
          ))}
        </section>
      </main>

      {commandOpen && (
        <div
          className="command-palette"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCommandPalette();
          }}
        >
          <section
            ref={commandPanelRef}
            className="command-palette__panel"
            role="dialog"
            aria-modal="true"
            aria-label="搜索并打开项目"
            onKeyDown={trapCommandFocus}
          >
            <div className="command-palette__field">
              <span aria-hidden="true">⌕</span>
              <input
                ref={commandInputRef}
                value={commandSearch}
                onChange={(event) => {
                  setCommandSearch(event.target.value);
                  setCommandActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandActive((current) =>
                      Math.min(current + 1, Math.max(0, commandResults.length - 1)),
                    );
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandActive((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openCommandResult(commandActive);
                  }
                }}
                placeholder="输入名称、路径或标签"
                aria-label="搜索项目"
              />
              <kbd>esc</kbd>
            </div>
            <div className="command-palette__results" role="listbox">
              {commandResults.length ? commandResults.map((record, index) => (
                <button
                  key={record.project.id}
                  type="button"
                  role="option"
                  aria-selected={index === commandActive}
                  className={index === commandActive ? "is-active" : ""}
                  onMouseEnter={() => setCommandActive(index)}
                  onClick={() => openCommandResult(index)}
                >
                  <span className="command-palette__icon" aria-hidden="true">
                    {record.project.icon}
                  </span>
                  <span>
                    <strong>{record.project.name}</strong>
                    <small>{record.project.path}</small>
                  </span>
                  <StatusBadge status={record.runtime.status} />
                </button>
              )) : (
                <p className="command-palette__empty">没有匹配的项目</p>
              )}
            </div>
            <footer className="command-palette__foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
              <span><kbd>↵</kbd> 打开</span>
              <span><kbd>esc</kbd> 关闭</span>
            </footer>
          </section>
        </div>
      )}

      {editing && (editing === "new" || editingRecord) && (
        <ProjectForm
          project={editingRecord?.project}
          pending={saveMutation.isPending || deleteMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await saveMutation.mutateAsync({
              ...(editing !== "new" ? { id: editing } : {}),
              input,
            });
          }}
          {...(editingRecord ? {
            onDelete: async () => {
              await deleteMutation.mutateAsync(editingRecord.project.id);
            },
          } : {})}
        />
      )}

      {preflight && (
        <div className="sheet-backdrop sheet-backdrop--center" role="presentation">
          <section className="preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
            <header className="sheet-header">
              <div><p className="panel-context">启动前检查</p><h2 id="preflight-title">{preflight.name}</h2></div>
              <button className="icon-button" onClick={() => setPreflight(null)} aria-label="关闭">×</button>
            </header>
            <div className={`preflight-verdict preflight-verdict--${preflight.result.ok ? "ok" : "fail"}`}>
              <strong>{preflight.result.ok ? "可以启动" : "预检未通过"}</strong>
              <span>{preflight.result.checks.filter((check) => check.ok).length}/{preflight.result.checks.length} 项通过</span>
            </div>
            <ul className="check-list">
              {preflight.result.checks.map((check, index) => (
                <li key={`${check.kind}-${check.stepId}-${index}`} className={check.ok ? "check--ok" : "check--fail"}>
                  <span>{check.ok ? "✓" : "!"}</span>
                  <div><strong>{check.kind.toUpperCase()} · {check.stepId ?? "PROJECT"}</strong><p>{check.message}</p></div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/projects/:id" element={<ProjectDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

