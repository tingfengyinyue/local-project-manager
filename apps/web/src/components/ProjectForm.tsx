import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  projectInputSchema,
  type ProjectConfig,
  type ProjectInput,
  type ProjectStep,
} from "@lpm/contracts";

type Props = {
  project: ProjectConfig | undefined;
  pending: boolean;
  onSubmit: (input: ProjectInput) => Promise<void>;
  onClose: () => void;
  onDelete?: () => Promise<void>;
};

const newStep = (index: number): ProjectStep => ({
  id: `step-${index}`,
  name: `步骤 ${index}`,
  type: "command",
  mode: "process",
  start: { executable: "", args: [], cwd: "." },
  dependsOn: [],
  probe: { type: "process" },
});

function emptyProject(): ProjectInput {
  return {
    name: "",
    path: "",
    description: "",
    icon: "◼",
    tags: [],
    enabled: true,
    steps: [newStep(1)],
  };
}

function toInput(project?: ProjectConfig): ProjectInput {
  if (!project) return emptyProject();
  const { id: _id, createdAt: _created, updatedAt: _updated, ...input } = project;
  return structuredClone(input);
}

export function ProjectForm({ project, pending, onSubmit, onClose, onDelete }: Props) {
  const [value, setValue] = useState<ProjectInput>(() => toInput(project));
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setValue(toInput(project));
    setErrors([]);
    setConfirmDelete(false);
  }, [project]);

  const stepIds = useMemo(() => value.steps.map((step) => step.id), [value.steps]);

  function updateStep(index: number, update: (step: ProjectStep) => ProjectStep) {
    setValue((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? update(step) : step,
      ),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = projectInputSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "保存项目失败"]);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onClose();
    }}>
      <section className="project-form-sheet" role="dialog" aria-modal="true" aria-labelledby="form-title">
        <header className="sheet-header">
          <div>
            <p className="panel-context">项目配置</p>
            <h2 id="form-title">{project ? "编辑项目" : "登记新项目"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={pending} aria-label="关闭">×</button>
        </header>

        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              <span>项目名称</span>
              <input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} required />
            </label>
            <label className="field--icon">
              <span>图标</span>
              <input value={value.icon} maxLength={8} onChange={(e) => setValue({ ...value, icon: e.target.value })} required />
            </label>
            <label className="field--wide">
              <span>绝对路径</span>
              <input value={value.path} placeholder="/Users/me/project" onChange={(e) => setValue({ ...value, path: e.target.value })} required />
            </label>
            <label className="field--wide">
              <span>访问地址</span>
              <input
                type="url"
                value={value.serviceUrl ?? ""}
                placeholder="http://127.0.0.1:3000"
                onChange={(e) => setValue({
                  ...value,
                  serviceUrl: e.target.value.trim() || undefined,
                })}
              />
            </label>
            <label className="field--wide">
              <span>项目介绍</span>
              <textarea
                value={value.description}
                rows={5}
                maxLength={2000}
                placeholder="说明项目用途、主要功能、技术栈和适用场景"
                onChange={(e) => setValue({ ...value, description: e.target.value })}
              />
            </label>
            <label className="field--wide">
              <span>标签（逗号分隔）</span>
              <input
                value={value.tags.join(", ")}
                onChange={(e) => setValue({
                  ...value,
                  tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                })}
              />
            </label>
            <label className="toggle-field">
              <input type="checkbox" checked={value.enabled} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />
              <span>允许启动</span>
            </label>
          </div>

          <div className="step-editor-heading">
            <div>
              <p className="panel-context">执行顺序</p>
              <h3>执行步骤 · {value.steps.length}</h3>
            </div>
            <button
              type="button"
              className="button button--run"
              onClick={() => setValue({ ...value, steps: [...value.steps, newStep(value.steps.length + 1)] })}
            >
              ＋ 添加步骤
            </button>
          </div>

          <div className="step-editor">
            {value.steps.map((step, index) => (
              <fieldset className="step-panel" key={index}>
                <legend><span>{String(index + 1).padStart(2, "0")}</span> {step.name || "未命名步骤"}</legend>
                <button
                  type="button"
                  className="step-remove"
                  disabled={value.steps.length === 1}
                  onClick={() => setValue({ ...value, steps: value.steps.filter((_, i) => i !== index) })}
                  aria-label={`删除步骤 ${step.name}`}
                >×</button>

                <div className="form-grid form-grid--steps">
                  <label>
                    <span>步骤 ID</span>
                    <input value={step.id} onChange={(e) => updateStep(index, (s) => ({ ...s, id: e.target.value }))} required />
                  </label>
                  <label>
                    <span>显示名称</span>
                    <input value={step.name} onChange={(e) => updateStep(index, (s) => ({ ...s, name: e.target.value }))} required />
                  </label>
                  <label>
                    <span>类型</span>
                    <select value={step.type} onChange={(e) => updateStep(index, (s) => ({ ...s, type: e.target.value as ProjectStep["type"] }))}>
                      <option value="command">命令</option>
                      <option value="docker-compose">Docker Compose</option>
                    </select>
                  </label>
                  <label>
                    <span>模式</span>
                    <select
                      value={step.mode}
                      onChange={(e) => updateStep(index, (s) => {
                        const mode = e.target.value as ProjectStep["mode"];
                        return { ...s, mode };
                      })}
                    >
                      <option value="process">常驻进程</option>
                      <option value="task">一次性任务</option>
                    </select>
                  </label>
                  <label className="field--wide">
                    <span>工作目录（cwd）</span>
                    <input value={step.start.cwd} onChange={(e) => updateStep(index, (s) => ({ ...s, start: { ...s.start, cwd: e.target.value } }))} />
                  </label>
                  <label className="field--wide">
                    <span>可执行文件</span>
                    <input value={step.start.executable} placeholder="pnpm" onChange={(e) => updateStep(index, (s) => ({ ...s, start: { ...s.start, executable: e.target.value } }))} required />
                  </label>
                  <label className="field--wide">
                    <span>参数（每行一个）</span>
                    <textarea
                      rows={2}
                      value={step.start.args.join("\n")}
                      onChange={(e) => updateStep(index, (s) => ({ ...s, start: { ...s.start, args: e.target.value.split("\n").filter((arg) => arg.length > 0) } }))}
                    />
                  </label>
                  {step.mode === "task" && (
                    <>
                      <label className="field--wide">
                        <span>停止命令（可选）</span>
                        <input
                          value={step.stop?.executable ?? ""}
                          onChange={(e) => updateStep(index, (s) => {
                            if (!e.target.value) {
                              const { stop: _stop, ...withoutStop } = s;
                              return withoutStop;
                            }
                            return {
                              ...s,
                              stop: {
                                ...(s.stop ?? { args: [], cwd: "." }),
                                executable: e.target.value,
                              },
                            };
                          })}
                        />
                      </label>
                      <label className="field--wide">
                        <span>停止参数（每行一个）</span>
                        <textarea
                          rows={2}
                          value={step.stop?.args.join("\n") ?? ""}
                          disabled={!step.stop}
                          onChange={(e) => updateStep(index, (s) => ({
                            ...s,
                            stop: {
                              ...(s.stop ?? { executable: "", cwd: "." }),
                              args: e.target.value.split("\n").filter(Boolean),
                            },
                          }))}
                        />
                      </label>
                    </>
                  )}
                  <label>
                    <span>依赖步骤</span>
                    <select
                      multiple
                      value={step.dependsOn}
                      onChange={(e) => updateStep(index, (s) => ({
                        ...s,
                        dependsOn: Array.from(e.target.selectedOptions, (option) => option.value),
                      }))}
                    >
                      {stepIds.filter((id) => id !== step.id).map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>环境文件</span>
                    <input
                      value={step.envFile ?? ""}
                      placeholder=".env"
                      onChange={(e) => updateStep(index, (s) => {
                        const { envFile: _old, ...rest } = s;
                        return e.target.value ? { ...rest, envFile: e.target.value } : rest;
                      })}
                    />
                  </label>
                  <label>
                    <span>探针类型</span>
                    <select
                      value={step.probe.type}
                      onChange={(e) => updateStep(index, (s) => {
                        const type = e.target.value;
                        if (type === "tcp") return { ...s, probe: { type, host: "127.0.0.1", port: 3000, timeoutMs: 15000 } };
                        if (type === "http") return { ...s, probe: { type, url: "http://127.0.0.1:3000", expectedStatus: 200, timeoutMs: 20000 } };
                        return { ...s, probe: { type: "process" } };
                      })}
                    >
                      <option value="process">进程</option>
                      <option value="tcp">TCP</option>
                      <option value="http">HTTP</option>
                    </select>
                  </label>
                  {step.probe.type === "tcp" && (
                    <>
                      <label><span>主机</span><input value={step.probe.host} onChange={(e) => updateStep(index, (s) => s.probe.type === "tcp" ? { ...s, probe: { ...s.probe, host: e.target.value } } : s)} /></label>
                      <label><span>端口</span><input type="number" min={1} max={65535} value={step.probe.port} onChange={(e) => updateStep(index, (s) => s.probe.type === "tcp" ? { ...s, probe: { ...s.probe, port: Number(e.target.value) } } : s)} /></label>
                      <label><span>超时（ms）</span><input type="number" min={1} value={step.probe.timeoutMs} onChange={(e) => updateStep(index, (s) => s.probe.type === "tcp" ? { ...s, probe: { ...s.probe, timeoutMs: Number(e.target.value) } } : s)} /></label>
                    </>
                  )}
                  {step.probe.type === "http" && (
                    <>
                      <label className="field--wide"><span>服务 URL</span><input type="url" value={step.probe.url} onChange={(e) => updateStep(index, (s) => s.probe.type === "http" ? { ...s, probe: { ...s.probe, url: e.target.value } } : s)} /></label>
                      <label><span>期望状态码</span><input type="number" min={100} max={599} value={step.probe.expectedStatus} onChange={(e) => updateStep(index, (s) => s.probe.type === "http" ? { ...s, probe: { ...s.probe, expectedStatus: Number(e.target.value) } } : s)} /></label>
                      <label><span>超时（ms）</span><input type="number" min={1} value={step.probe.timeoutMs} onChange={(e) => updateStep(index, (s) => s.probe.type === "http" ? { ...s, probe: { ...s.probe, timeoutMs: Number(e.target.value) } } : s)} /></label>
                    </>
                  )}
                </div>
              </fieldset>
            ))}
          </div>

          {errors.length > 0 && (
            <div className="form-errors" role="alert">
              <strong>配置未通过校验</strong>
              <ul>{[...new Set(errors)].map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          )}

          <footer className="form-actions">
            {project && onDelete && (
              confirmDelete ? (
                <div className="delete-confirm" role="alert">
                  <span>确认永久删除？</span>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={pending}
                    onClick={() => void onDelete().catch((error: unknown) => {
                      setErrors([error instanceof Error ? error.message : "删除项目失败"]);
                      setConfirmDelete(false);
                    })}
                  >
                    确认删除
                  </button>
                  <button type="button" className="button" disabled={pending} onClick={() => setConfirmDelete(false)}>取消</button>
                </div>
              ) : (
                <button type="button" className="button button--danger-quiet" disabled={pending} onClick={() => setConfirmDelete(true)}>删除项目</button>
              )
            )}
            <span className="form-actions__spacer" />
            <button type="button" className="button" onClick={onClose} disabled={pending}>取消</button>
            <button type="submit" className="button button--run" disabled={pending}>{pending ? "保存中…" : "保存配置"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

