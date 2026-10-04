import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// 1. Load repository root .env (NEXUS-6/.env)
const nexus6Env = fileURLToPath(new URL(import.meta.url.includes("/dist/") ? "../../../../../.env" : "../../../../.env", import.meta.url));
if (fs.existsSync(nexus6Env)) {
  config({ path: nexus6Env });
}

// 2. Load workspace root .env (DataBase/.env) with override priority
const workspaceEnv = fileURLToPath(new URL(import.meta.url.includes("/dist/") ? "../../../../../../.env" : "../../../../../.env", import.meta.url));
if (fs.existsSync(workspaceEnv)) {
  config({ path: workspaceEnv, override: true });
}

