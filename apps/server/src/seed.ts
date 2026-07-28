import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  projectConfigSchema,
  projectInputSchema,
  type ProjectInput,
} from "@lpm/contracts";
import { ProjectStore } from "./database.js";
import { assertProjectPaths, validateProjectRoot } from "./security.js";

export async function seedProjects(
  store: ProjectStore,
  filename: string,
  allowedRoots: readonly string[],
): Promise<number> {
  let source: string;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  const inputs = projectInputSchema.array().parse(JSON.parse(source)) as ProjectInput[];
  const existingPaths = new Set(store.listProjects().map((project) => project.path));
  let created = 0;
  for (const input of inputs) {
    if (existingPaths.has(input.path)) continue;
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
    existingPaths.add(project.path);
    created += 1;
  }
  return created;
}
