import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { createServer } from "./app.js";
import { seedProjects } from "./seed.js";

const port = Number.parseInt(process.env.LPM_PORT ?? "4310", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("LPM_PORT 必须是 1-65535 的整数");
}

const defaultAllowedRoots = [
  join(homedir(), "Projects"),
  join(homedir(), "Documents"),
].join(delimiter);
const allowedRoots = (process.env.LPM_ALLOWED_ROOTS ?? defaultAllowedRoots)
  .split(delimiter)
  .filter(Boolean);
const databasePath =
  process.env.LPM_DATABASE_PATH ??
  join(homedir(), ".local-project-manager", "projects.sqlite");

const { app, store } = createServer({
  allowedRoots,
  databasePath,
  logger: true,
});

const seedFile = process.env.LPM_SEED_FILE ?? "off";
if (seedFile !== "off") {
  const created = await seedProjects(store, seedFile, allowedRoots);
  if (created > 0) app.log.info({ created }, "已导入个人项目模板");
}

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host: "127.0.0.1", port });
