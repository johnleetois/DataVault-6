import "./src/config/load-env.js";
import { defineConfig } from "prisma/config";
import { requireSystemDatabaseUrl } from "./src/config/database-urls.js";

// Offline schema commands need no credentials. Never fall back to the runtime URL.
const directUrl = process.env.SYSTEM_DATABASE_DIRECT_URL?.trim();
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(directUrl ? { datasource: { url: requireSystemDatabaseUrl(process.env, "SYSTEM_DATABASE_DIRECT_URL") } } : {})
});
