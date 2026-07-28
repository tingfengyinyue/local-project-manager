# Project Dock

一个只在本机运行的项目控制台，用统一配置管理本地项目的预检、启动、停止、健康状态与实时日志。

## 安全原则

- 服务默认仅监听 `127.0.0.1`。
- 命令以“可执行程序 + 参数数组”运行，不使用 shell 字符串。
- 只管理平台自己启动并登记的进程。
- 项目与步骤目录必须位于批准的根目录中。
- `.env` 只作为可选路径引用，平台不展示或持久化其中内容。

## 开发

要求 Node.js 24+ 与 pnpm 10+：

```bash
pnpm install
pnpm dev
```

Web 与 API 的实际端口以各应用配置为准。运行完整质量门：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 配置

页面支持新增和编辑任意项目。配置字段与约束由
`@lpm/contracts` 统一定义。

服务默认允许访问 `~/Projects` 与 `~/Documents`。可通过系统 PATH
分隔符配置更多根目录：

```bash
LPM_ALLOWED_ROOTS="$HOME/Projects:$HOME/Developer" pnpm dev
```

项目数据保存在 `~/.local-project-manager/projects.sqlite`，不会提交到 Git。

如需首次启动时导入模板，复制并修改公开示例，然后指定文件：

```bash
cp configs/example-projects.json configs/personal-projects.json
LPM_SEED_FILE="$PWD/configs/personal-projects.json" pnpm dev
```

`configs/personal-projects.json` 已被 Git 忽略，避免公开本机路径和个人项目清单。

详细架构见 `docs/plans/2026-07-24-local-project-manager-design.md`。
