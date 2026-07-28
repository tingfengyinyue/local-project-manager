# 本地项目管理平台设计

## 目标

以配置驱动方式管理个人项目的依赖、启动、停止、健康检查与日志。平台只监听本机，不录入工作项目，不读取或存储密钥。

## 架构

- `apps/server`：Fastify API、SQLite 持久化、进程组管理、SSE 日志。
- `apps/web`：React 控制台、项目编辑、预检与运行详情。
- `packages/contracts`：前后端共享的 Zod schema 与 TypeScript 类型。
- Registry 将项目拆成有依赖关系的步骤，首版支持 `command` 与 `docker-compose`，探针支持 `process`、`tcp`、`http`。

## 安全边界

- 仅绑定 `127.0.0.1`。
- 可执行程序和参数分开保存，禁止通过 shell 拼接执行。
- 项目路径必须位于批准的根目录中。
- 只终止平台启动并持有身份信息的进程组。
- 环境变量只保存名称，日志对常见凭据格式脱敏。

## 状态与恢复

项目状态为 `stopped | starting | running | stopping | failed | unknown`。同一项目的变更操作串行化；重复请求返回当前操作。启动失败时逆序停止已启动步骤。平台重启后将历史运行实例标记为 `unknown`，经进程身份和健康探针核验后再更新。

## 首批项目

纳入 `learning-engine`、`lark-channel-hub`、`lark-channel-bridge-fork`、`md-tts`、`codebase-memory-mcp-pro`。明确排除 `portal-skills` 与 `订阅接入`。

## 验收

单元测试覆盖配置校验、状态机、拓扑排序、脱敏和路径限制；API 集成测试覆盖 CRUD、预检、启动/停止幂等性和失败回滚；浏览器测试覆盖新增配置、启动、日志、停止和断线恢复。最终对首批个人项目执行只读预检与受控烟测。
