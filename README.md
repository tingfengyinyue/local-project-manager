<p align="center">
  <img src="apps/web/public/project-dock.svg" width="72" alt="项目坞图标" />
</p>

<h1 align="center">项目坞 · Project Dock</h1>

<p align="center">
  在一个本地控制台中配置、启动、停止并观察你的开发项目。
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="README_EN.md">English</a>
</p>

![项目坞工作台](docs/images/dashboard.png)

## 功能

- 通过统一配置管理命令、Docker Compose、依赖顺序和环境文件。
- 启动前检查路径、可执行文件、端口占用与健康探针。
- 管理进程生命周期，启动失败时自动逆序回滚。
- 识别从其他终端启动的外部服务，避免重复启动或误停止。
- 展示 HTTP、TCP 和进程健康状态，持续读取实时日志。
- 为每个项目配置访问地址，从控制台直接打开本地页面。
- 通过页面新增、编辑和删除项目，无需修改源代码。

<p>
  <img src="docs/images/project-detail.png" width="49%" alt="项目详情与启动命令" />
  <img src="docs/images/project-form.png" width="49%" alt="项目配置表单" />
</p>

## 技术架构

- Web：React 19、Vite、TanStack Query、React Router
- API：Fastify、TypeScript、Server-Sent Events
- 数据：Node.js SQLite
- 契约：Zod 共享 Schema
- 测试：Vitest、Testing Library、Playwright

```text
apps/web          React 控制台
apps/server       本地 API 与进程管理
packages/contracts 共享数据契约
configs           可选项目模板
```

## 快速开始

要求 Node.js 24+ 与 pnpm 10+：

```bash
git clone https://github.com/tingfengyinyue/local-project-manager.git
cd local-project-manager
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:4311`。API 默认运行在
`http://127.0.0.1:4310`。

## 项目配置

页面支持新增和编辑任意项目，配置字段由 `@lpm/contracts` 统一校验。
服务默认允许访问 `~/Projects` 与 `~/Documents`，可配置更多根目录：

```bash
LPM_ALLOWED_ROOTS="$HOME/Projects:$HOME/Developer" pnpm dev
```

如需首次启动时导入模板：

```bash
cp configs/example-projects.json configs/personal-projects.json
LPM_SEED_FILE="$PWD/configs/personal-projects.json" pnpm dev
```

项目数据保存在 `~/.local-project-manager/projects.sqlite`。
`configs/personal-projects.json`、数据库、日志和 `.env` 均不会提交到 Git。

## 安全边界

- 服务默认仅监听 `127.0.0.1`，CORS 只允许本机来源。
- 命令使用“可执行程序 + 参数数组”，不执行 shell 字符串。
- 只停止由项目坞启动并登记的进程。
- 项目、工作目录和环境文件必须位于批准的根目录内。
- `.env` 只作为可选路径加载，不展示或持久化其中内容。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

详细架构见
[`docs/plans/2026-07-24-local-project-manager-design.md`](docs/plans/2026-07-24-local-project-manager-design.md)。

MIT License
