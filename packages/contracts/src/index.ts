import { z } from "zod";

export const projectStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
  "unknown",
]);

export const probeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("process") }),
  z.object({
    type: z.literal("tcp"),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535),
    timeoutMs: z.number().int().positive().default(15_000),
  }),
  z.object({
    type: z.literal("http"),
    url: z.string().url(),
    expectedStatus: z.number().int().min(100).max(599).default(200),
    timeoutMs: z.number().int().positive().default(20_000),
  }),
]);

export const commandSchema = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().default("."),
});

export const projectStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1).max(80),
    type: z.enum(["command", "docker-compose"]).default("command"),
    mode: z.enum(["process", "task"]).default("process"),
    start: commandSchema,
    stop: commandSchema.optional(),
    dependsOn: z.array(z.string()).default([]),
    envFile: z.string().optional(),
    probe: probeSchema.default({ type: "process" }),
  })
  .superRefine((step, context) => {
    if (step.dependsOn.includes(step.id)) {
      context.addIssue({
        code: "custom",
        path: ["dependsOn"],
        message: "步骤不能依赖自身",
      });
    }
  });

const projectConfigObjectSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    path: z.string().startsWith("/"),
    serviceUrl: z.string().url().optional(),
    description: z.string().max(2_000).default(""),
    icon: z.string().min(1).max(8).default("◼"),
    tags: z.array(z.string().min(1).max(30)).default([]),
    enabled: z.boolean().default(true),
    steps: z.array(projectStepSchema).min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });

function validateProjectSteps(
  project: { steps: z.infer<typeof projectStepSchema>[] },
  context: z.RefinementCtx,
): void {
    const ids = new Set(project.steps.map((step) => step.id));
    if (ids.size !== project.steps.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "步骤 ID 必须唯一",
      });
    }
    project.steps.forEach((step, index) => {
      step.dependsOn.forEach((dependency) => {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["steps", index, "dependsOn"],
            message: `依赖步骤不存在：${dependency}`,
          });
        }
      });
    });

    const dependencies = new Map(
      project.steps.map((step) => [step.id, step.dependsOn] as const),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (stepId: string): boolean => {
      if (visiting.has(stepId)) return true;
      if (visited.has(stepId)) return false;
      visiting.add(stepId);
      const cyclic = (dependencies.get(stepId) ?? []).some(hasCycle);
      visiting.delete(stepId);
      visited.add(stepId);
      return cyclic;
    };
    if (project.steps.some((step) => hasCycle(step.id))) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "步骤依赖不能形成循环",
      });
    }
}

export const projectConfigSchema =
  projectConfigObjectSchema.superRefine(validateProjectSteps);

const projectInputObjectSchema = projectConfigObjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const projectInputSchema =
  projectInputObjectSchema.superRefine(validateProjectSteps);

export const projectPatchSchema = z.object({
  name: projectConfigObjectSchema.shape.name.optional(),
  path: projectConfigObjectSchema.shape.path.optional(),
  serviceUrl: projectConfigObjectSchema.shape.serviceUrl.optional(),
  description: z.string().max(2_000).optional(),
  icon: z.string().min(1).max(8).optional(),
  tags: z.array(z.string().min(1).max(30)).optional(),
  enabled: z.boolean().optional(),
  steps: projectConfigObjectSchema.shape.steps.optional(),
});

export const stepRuntimeSchema = z.object({
  stepId: z.string(),
  status: z.enum(["pending", "starting", "running", "stopping", "stopped", "failed"]),
  pid: z.number().int().positive().nullable(),
  startedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});

export const runtimeSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  status: projectStatusSchema,
  external: z.boolean().optional(),
  operationId: z.string().uuid().nullable(),
  steps: z.array(stepRuntimeSchema),
  error: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const preflightResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(
    z.object({
      stepId: z.string().nullable(),
      kind: z.enum(["path", "executable", "env-file", "port"]),
      ok: z.boolean(),
      message: z.string(),
    }),
  ),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ProjectStep = z.infer<typeof projectStepSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;
export type PreflightResult = z.infer<typeof preflightResultSchema>;
