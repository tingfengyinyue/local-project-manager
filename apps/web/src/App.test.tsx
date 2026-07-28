import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const id = "9341d0a8-9094-4f62-8b44-943c144aaef5";
const now = "2026-07-24T09:00:00.000Z";
const projectRecord = {
  project: {
    id,
    name: "引擎控制台",
    path: "/tmp/example-engine",
    description: "本地核心服务",
    icon: "⬡",
    tags: ["core", "api"],
    enabled: true,
    steps: [{
      id: "server",
      name: "API 服务",
      type: "command",
      mode: "process",
      start: { executable: "pnpm", args: ["dev"], cwd: "." },
      dependsOn: [],
      probe: {
        type: "http",
        url: "http://127.0.0.1:3000",
        expectedStatus: 200,
        timeoutMs: 20000,
      },
    }],
    createdAt: now,
    updatedAt: now,
  },
  runtime: {
    projectId: id,
    status: "stopped",
    operationId: null,
    steps: [{
      stepId: "server",
      status: "stopped",
      pid: null,
      startedAt: null,
      error: null,
    }],
    error: null,
    updatedAt: now,
  },
};

function renderApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("项目控制台", () => {
  it("渲染真实项目并可按关键字筛选", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ projects: [projectRecord] }),
      { status: 200 },
    )));
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole("link", { name: "引擎控制台" })).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:3000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开/ })).toHaveAttribute(
      "href",
      "http://127.0.0.1:3000",
    );

    await user.type(screen.getByPlaceholderText("搜索名称、路径或标签…"), "不存在");
    expect(screen.getByText("没有符合条件的项目")).toBeInTheDocument();
  });

  it("展示统一的接口错误并提供重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "UNAVAILABLE", message: "项目服务尚未启动" },
    }), { status: 503 })));
    renderApp();

    expect(await screen.findByText("无法连接项目服务")).toBeInTheDocument();
    expect(screen.getByText("项目服务尚未启动 · UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeEnabled();
  });

  it("运行中的项目使用不可点击的运行状态按钮", async () => {
    const runningRecord = structuredClone(projectRecord);
    runningRecord.runtime.status = "running";
    runningRecord.runtime.steps[0]!.status = "running";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ projects: [runningRecord] }),
      { status: 200 },
    )));
    renderApp();

    const button = await screen.findByRole("button", { name: "运行中" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("button--running");
  });

  it("外部运行项目禁止重复启动、停止和重启", async () => {
    const externalRecord = {
      ...structuredClone(projectRecord),
      runtime: {
        ...structuredClone(projectRecord.runtime),
        status: "running",
        external: true,
        steps: projectRecord.runtime.steps.map((step) => ({
          ...step,
          status: "running",
        })),
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ projects: [externalRecord] }),
      { status: 200 },
    )));
    renderApp();

    expect(await screen.findByLabelText("状态：外部运行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已运行" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重启" })).toBeDisabled();
  });
});

