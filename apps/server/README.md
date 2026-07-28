# @lpm/server

本地项目管理器的 Fastify 服务端。要求 Node.js 24+，仅监听
`127.0.0.1`，使用 Node 内置 `node:sqlite` 保存项目配置和最近运行状态。

## 启动

```bash
pnpm --filter @lpm/server dev
```

环境变量：

- `LPM_PORT`：监听端口，默认 `4310`
- `LPM_DATABASE_PATH`：SQLite 文件，默认
  `~/.local-project-manager/projects.sqlite`
- `LPM_ALLOWED_ROOTS`：允许的项目根目录列表，以系统 PATH 分隔符分隔，
  默认 `~/Projects` 与 `~/Documents`
- `LPM_SEED_FILE`：可选的初始项目模板文件，默认关闭

服务固定监听 `127.0.0.1`。CORS 仅接受
`http://localhost:<port>` 和 `http://127.0.0.1:<port>`。

## API

所有普通响应使用直观的顶层键，例如 `{ project }`、`{ projects }`、
`{ runtime }`、`{ result }`。项目列表和项目详情中的项目对象附带
`runtime`。错误统一为：

```json
{"error":{"code":"ERROR_CODE","message":"说明","context":{}}}
```

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/preflight`
- `POST /api/projects/:id/start`
- `POST /api/projects/:id/stop`
- `GET /api/projects/:id/runtime`
- `GET /api/projects/:id/logs`：SSE，发送 `connected`、`log` 事件

`preflight` 检查项目路径、cwd、envFile 和可执行程序。envFile 只检查
存在性及路径边界，绝不读取内容。进程按依赖拓扑顺序启动，失败时逆序
回滚；停止时同样逆序执行。`process` 步骤由服务保存并核对进程句柄后
停止 detached 进程组，`task` 步骤启动命令成功退出即视为运行，停止时
执行显式 stop 命令。

## 测试

```bash
pnpm --filter @lpm/server test
```

测试只使用系统临时目录和 `process.execPath` Node fixture，不访问真实项目。
