import "./load-env.js";
import { z } from "zod";
import { getDatasetDatabaseConfig } from "./dataset-databases.js";
import type { DatasetDatabaseConfig } from "./dataset-databases.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:8080"),
  APP_BASE_URL: z.preprocess((val) => typeof val === "string" && val.trim() === "" ? undefined : val, z.string().url().optional())
});

export type AppEnv = z.infer<typeof envSchema>;
export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) throw new Error("Invalid application environment configuration.");
  if (result.data.NODE_ENV === "production" && (!source.WEB_ORIGIN || result.data.WEB_ORIGIN === "http://localhost:8080" || result.data.WEB_ORIGIN === "*")) {
    throw new Error("WEB_ORIGIN must be explicitly configured in production.");
  }
  return result.data;
}

// Optional dataset engines are validated independently so missing credentials do not stop API startup.
export function parseDatasetDatabaseConfig(source: NodeJS.ProcessEnv = process.env): DatasetDatabaseConfig {
  return getDatasetDatabaseConfig(source);
}

export { requireSystemDatabaseUrl, requireLogDatabaseUrl } from "./database-urls.js";

let cachedEnv: AppEnv | null = null;
export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, prop: string | symbol) {
    if (!cachedEnv || process.env.NODE_ENV === "test") {
      cachedEnv = parseEnv(process.env);
    }
    return cachedEnv[prop as keyof AppEnv];
  }
});
