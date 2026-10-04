import { z } from "zod";

const databaseUrl = z.string().trim().min(1).refine((value) => {
  try {
    const url = new URL(value);
    return ["postgresql:", "postgres:"].includes(url.protocol) && !!url.hostname && url.pathname.length > 1;
  } catch {
    return false;
  }
});

// Database configuration is validated only when requested, preserving liveness.
export function requireSystemDatabaseUrl(
  source: NodeJS.ProcessEnv = process.env,
  key: "SYSTEM_DATABASE_URL" | "SYSTEM_DATABASE_DIRECT_URL" = "SYSTEM_DATABASE_URL"
): string {
  const result = databaseUrl.safeParse(source[key]);
  if (!result.success) throw new Error(`${key} must be configured with a valid PostgreSQL URL.`);
  return result.data;
}

export function requireLogDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const result = databaseUrl.safeParse(source.LOG_DATABASE_URL);
  if (!result.success) throw new Error("LOG_DATABASE_URL must be configured with a valid PostgreSQL URL.");
  const logUrl = new URL(result.data);
  const systemValues = [source.SYSTEM_DATABASE_URL, source.SYSTEM_DATABASE_DIRECT_URL].filter((value): value is string => Boolean(value));
  if (systemValues.some((value) => {
    const systemUrl = new URL(value);
    return systemUrl.protocol === logUrl.protocol && systemUrl.hostname === logUrl.hostname && systemUrl.port === logUrl.port && systemUrl.pathname === logUrl.pathname;
  })) {
    throw new Error("LOG_DATABASE_URL must point to a database separate from the system database.");
  }
  return result.data;
}
