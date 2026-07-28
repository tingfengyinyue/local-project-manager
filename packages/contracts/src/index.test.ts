import { describe, expect, it } from "vitest";
import { projectConfigSchema, projectPatchSchema } from "./index.js";

const baseProject = {
  id: "7ce1d03d-b7cc-4e80-adaf-732e18b5bb78",
  name: "Fixture",
  path: "/tmp/fixture",
  description: "",
  icon: "F",
  tags: [],
  enabled: true,
  createdAt: "2026-07-24T09:00:00.000Z",
  updatedAt: "2026-07-24T09:00:00.000Z",
};

describe("projectConfigSchema", () => {
  it("accepts a valid dependency graph", () => {
    const result = projectConfigSchema.safeParse({
      ...baseProject,
      steps: [
        {
          id: "infra",
          name: "Infra",
          type: "docker-compose",
          mode: "task",
          start: { executable: "docker", args: ["compose", "up", "-d"], cwd: "." },
          stop: { executable: "docker", args: ["compose", "down"], cwd: "." },
          dependsOn: [],
          probe: { type: "process" },
        },
        {
          id: "api",
          name: "API",
          type: "command",
          mode: "process",
          start: { executable: "node", args: ["server.js"], cwd: "." },
          dependsOn: ["infra"],
          probe: { type: "tcp", host: "127.0.0.1", port: 8080, timeoutMs: 1000 },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects cyclic dependencies", () => {
    const result = projectConfigSchema.safeParse({
      ...baseProject,
      steps: [
        {
          id: "a",
          name: "A",
          type: "command",
          mode: "process",
          start: { executable: "node", args: ["a.js"], cwd: "." },
          dependsOn: ["b"],
          probe: { type: "process" },
        },
        {
          id: "b",
          name: "B",
          type: "command",
          mode: "process",
          start: { executable: "node", args: ["b.js"], cwd: "." },
          dependsOn: ["a"],
          probe: { type: "process" },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("allows one-shot task steps without a stop command", () => {
    const result = projectConfigSchema.safeParse({
      ...baseProject,
      steps: [
        {
          id: "infra",
          name: "Infra",
          type: "docker-compose",
          mode: "task",
          start: { executable: "docker", args: ["compose", "up", "-d"], cwd: "." },
          dependsOn: [],
          probe: { type: "process" },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("does not inject defaults into partial updates", () => {
    expect(projectPatchSchema.parse({
      serviceUrl: "http://127.0.0.1:3000",
    })).toEqual({
      serviceUrl: "http://127.0.0.1:3000",
    });
  });
});
