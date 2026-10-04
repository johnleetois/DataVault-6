import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Express } from "express";
import { env } from "./env.js";

function isAllowedDevOrigin(origin: string): boolean {
  if (env.NODE_ENV === "production") return false;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

export function configureHttp(app: Express): void {
  app.set("trust proxy", 1);
  const allowedOrigins = [
    env.WEB_ORIGIN,
    env.APP_BASE_URL,
    "http://localhost:8080",
    "http://localhost:8081",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8081"
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.replace(/\/+$/, ""));

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const normalized = origin.replace(/\/+$/, "");
        if (
          allowedOrigins.includes(normalized) ||
          allowedOrigins.includes("*") ||
          isAllowedDevOrigin(normalized)
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true
    })
  );
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
}
