import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import {
  projectConfigSchema,
  projectInputSchema,
  projectPatchSchema,
} from "@lpm/contracts";
import { ZodError, z } from "zod";
import { ProjectStore } from "./database.js";
import { AppError, errorBody } from "./errors.js";
import { RuntimeManager } from "./runtime.js";
import {
  assertConfiguredPath,
  assertProjectPaths,
  validateProjectRoot,
} from "./security.js";

const idParamsSchema = z.object({ id: z.string().uuid() });
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export interface ServerOptions {
  databasePath?: string;
  allowedRoots?: readonly string[];
  logger?: boolean;
}

export interface ServerContext {
  app: FastifyInstance;
  store: ProjectStore;
  runtime: RuntimeManager;
}

export function createServer(options: ServerOptions = {}): ServerContext {
  const app = Fastify({ logger: options.logger ?? false });
  const store = new ProjectStore(
    options.databasePath ??
      process.env.LPM_DATABASE_PATH ??
      join(process.cwd(), "data", "projects.sqlite"),
  );
  const allowedRoots = (options.allowedRoots ?? [join(homedir(), "Projects")]).map((root) =>
    assertConfiguredPath(root, [root], "允许根目录"),
  );
  const runtime = new RuntimeManager(store, allowedRoots);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type,Accept");
    } else if (origin) {
      throw new AppError("ORIGIN_NOT_ALLOWED", "不允许的跨域来源", 403);
    }
    if (request.method === "OPTIONS") {
      await reply.status(204).send();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "请求数据校验失败",
          context: { issues: error.issues },
        },
      });
      return;
    }
    const status =
      error instanceof AppError
        ? error.statusCode
        : typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            typeof error.statusCode === "number"
          ? error.statusCode
          : 500;
    void reply.status(status).send(errorBody(error));
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/projects", async () => ({
    projects: await Promise.all(
      store.listProjects().map(async (project) => ({
        project,
        runtime: await runtime.observe(project),
      })),
    ),
  }));

  app.post("/api/projects", async (request, reply) => {
    const input = projectInputSchema.parse(request.body);
    await validateProjectRoot(input.path, allowedRoots);
    const now = new Date().toISOString();
    const project = projectConfigSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    assertProjectPaths(project);
    store.createProject(project);
    runtime.get(project);
    return reply.status(201).send(project);
  });

  app.get("/api/projects/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = store.requireProject(id);
    return project;
  });

  app.patch("/api/projects/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const existing = store.requireProject(id);
    runtime.assertMutable(existing);
    const patch = projectPatchSchema.parse(request.body);
    const updated = projectConfigSchema.parse({
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await validateProjectRoot(updated.path, allowedRoots);
    assertProjectPaths(updated);
    store.updateProject(updated);
    runtime.reset(updated);
    return updated;
  });

  app.delete("/api/projects/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = store.requireProject(id);
    runtime.assertMutable(project);
    store.deleteProject(id);
    runtime.forget(id);
    return reply.status(204).send();
  });

  app.post("/api/projects/:id/preflight", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = store.requireProject(id);
    return runtime.preflight(project);
  });

  app.post("/api/projects/:id/start", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = store.requireProject(id);
    return runtime.start(project);
  });

  app.post("/api/projects/:id/stop", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = store.requireProject(id);
    return runtime.stop(project);
  });

  app.get("/api/projects/:id/runtime", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = store.requireProject(id);
    return runtime.observe(project);
  });

  app.get("/api/projects/:id/logs", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    store.requireProject(id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(request.headers.origin
        ? {
            "Access-Control-Allow-Origin": request.headers.origin,
            Vary: "Origin",
          }
        : {}),
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ projectId: id })}\n\n`);
    const unsubscribe = runtime.subscribe(id, (entry) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 15_000);
    reply.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.addHook("onClose", async () => {
    await runtime.shutdown(store.listProjects());
    store.close();
  });

  return { app, store, runtime };
}
