import "./src/config/load-env.js";
import { defineConfig } from "prisma/config";
import { requireLogDatabaseUrl } from "./src/config/database-urls.js";

const logDatabaseUrl = process.env.LOG_DATABASE_URL?.trim();
const isMigrationCommand = process.argv.includes("migrate");

export default defineConfig({
  schema: "prisma/log-schema.prisma",
  migrations: { path: "prisma/log-migrations" },
  ...(logDatabaseUrl ? { datasource: { url: isMigrationCommand ? requireLogDatabaseUrl() : logDatabaseUrl } } : {})
});
