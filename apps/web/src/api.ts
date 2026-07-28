import {
  apiErrorSchema,
  preflightResultSchema,
  projectConfigSchema,
  projectInputSchema,
  projectPatchSchema,
  runtimeSnapshotSchema,
  type PreflightResult,
  type ProjectConfig,
  type ProjectInput,
  type ProjectPatch,
  type RuntimeSnapshot,
} from "@lpm/contracts";
import { z } from "zod";

const projectRecordSchema = z.object({
  project: projectConfigSchema,
  runtime: runtimeSnapshotSchema,
});
const projectListSchema = z.object({ projects: z.array(projectRecordSchema) });

export type ProjectRecord = z.infer<typeof projectRecordSchema>;
export type LogEntry = {
  timestamp: string;
  stepId: string | null;
  stream: string;
  message: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function decodeBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    response = await fetch(path, {
      ...init,
      headers,
    });
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? `网络连接失败：${cause.message}` : "网络连接失败",
      null,
      "NETWORK_ERROR",
    );
  }

  const body = await decodeBody(response);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.message,
        response.status,
        parsed.data.error.code,
        parsed.data.error.context,
      );
    }
    const fallback =
      typeof body === "string" && body.trim()
        ? body
        : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(fallback, response.status, "HTTP_ERROR");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "服务端返回的数据格式不正确",
      response.status,
      "INVALID_RESPONSE",
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

function projectPath(id: string, suffix = "") {
  return `/api/projects/${encodeURIComponent(id)}${suffix}`;
}

export const api = {
  listProjects: () => request("/api/projects", projectListSchema),
  getProject: (id: string) => request(projectPath(id), projectConfigSchema),
  createProject: (input: ProjectInput) =>
    request("/api/projects", projectConfigSchema, {
      method: "POST",
      body: JSON.stringify(projectInputSchema.parse(input)),
    }),
  updateProject: (id: string, patch: ProjectPatch) =>
    request(projectPath(id), projectConfigSchema, {
      method: "PATCH",
      body: JSON.stringify(projectPatchSchema.parse(patch)),
    }),
  deleteProject: async (id: string) => {
    let response: Response;
    try {
      response = await fetch(projectPath(id), { method: "DELETE" });
    } catch (cause) {
      throw new ApiError(
        cause instanceof Error ? `网络连接失败：${cause.message}` : "网络连接失败",
        null,
        "NETWORK_ERROR",
      );
    }
    if (!response.ok) {
      const body = await decodeBody(response);
      const parsed = apiErrorSchema.safeParse(body);
      throw new ApiError(
        parsed.success
          ? parsed.data.error.message
          : `删除失败（HTTP ${response.status}）`,
        response.status,
        parsed.success ? parsed.data.error.code : "HTTP_ERROR",
      );
    }
  },
  preflight: (id: string): Promise<PreflightResult> =>
    request(projectPath(id, "/preflight"), preflightResultSchema, {
      method: "POST",
    }),
  start: (id: string): Promise<RuntimeSnapshot> =>
    request(projectPath(id, "/start"), runtimeSnapshotSchema, {
      method: "POST",
    }),
  stop: (id: string): Promise<RuntimeSnapshot> =>
    request(projectPath(id, "/stop"), runtimeSnapshotSchema, {
      method: "POST",
    }),
  runtime: (id: string): Promise<RuntimeSnapshot> =>
    request(projectPath(id, "/runtime"), runtimeSnapshotSchema),
};

export function getHttpServices(project: ProjectConfig): string[] {
  if (project.serviceUrl) return [project.serviceUrl];
  return project.steps.flatMap((step) =>
    step.probe.type === "http" ? [step.probe.url] : [],
  );
}

