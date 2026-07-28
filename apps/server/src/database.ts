import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  projectConfigSchema,
  runtimeSnapshotSchema,
  type ProjectConfig,
  type RuntimeSnapshot,
} from "@lpm/contracts";
import { AppError } from "./errors.js";

export class ProjectStore {
  readonly database: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        runtime_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.database.close();
  }

  listProjects(): ProjectConfig[] {
    const rows = this.database
      .prepare("SELECT config_json FROM projects ORDER BY created_at ASC")
      .all() as Array<{ config_json: string }>;
    return rows.map((row) => projectConfigSchema.parse(JSON.parse(row.config_json)));
  }

  getProject(id: string): ProjectConfig | undefined {
    const row = this.database
      .prepare("SELECT config_json FROM projects WHERE id = ?")
      .get(id) as { config_json: string } | undefined;
    return row
      ? projectConfigSchema.parse(JSON.parse(row.config_json))
      : undefined;
  }

  requireProject(id: string): ProjectConfig {
    const project = this.getProject(id);
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404, { id });
    return project;
  }

  createProject(project: ProjectConfig): void {
    try {
      this.database
        .prepare(
          "INSERT INTO projects (id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(project.id, JSON.stringify(project), project.createdAt, project.updatedAt);
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        throw new AppError("PROJECT_EXISTS", "项目 ID 已存在", 409, { id: project.id });
      }
      throw error;
    }
  }

  updateProject(project: ProjectConfig): void {
    const result = this.database
      .prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(project), project.updatedAt, project.id);
    if (result.changes === 0) {
      throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404, { id: project.id });
    }
  }

  deleteProject(id: string): void {
    const result = this.database.prepare("DELETE FROM projects WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404, { id });
    }
  }

  saveRuntime(runtime: RuntimeSnapshot): void {
    this.database
      .prepare(
        `INSERT INTO runs (project_id, status, runtime_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           status = excluded.status,
           runtime_json = excluded.runtime_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        runtime.projectId,
        runtime.status,
        JSON.stringify(runtime),
        runtime.updatedAt,
      );
  }

  getRuntime(id: string): RuntimeSnapshot | undefined {
    const row = this.database
      .prepare("SELECT runtime_json FROM runs WHERE project_id = ?")
      .get(id) as { runtime_json: string } | undefined;
    return row
      ? runtimeSnapshotSchema.parse(JSON.parse(row.runtime_json))
      : undefined;
  }
}
