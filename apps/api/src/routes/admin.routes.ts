import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate, requireSuperAdmin } from "../auth/middleware.js";
import type { RequestHandler } from "express";
import { AdminManagementService } from "../services/admin-management.service.js";

function requestActor(request: Request) {
  return {
    actorType: request.principal!.role,
    actorId: request.principal!.id,
    actorEmail: request.principal!.email,
    ipAddress: request.ip,
    userAgent: request.get("user-agent")
  } as const;
}

const idSchema = z.string().uuid();
const createAdminSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320)
});
const patchAdminSchema = createAdminSchema.partial().refine((value) => Object.keys(value).length > 0);
const statusSchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "DISABLED"]) });
const activateAdminSchema = z.object({ password: z.string().min(8).max(100).optional() });

export function createAdminRouter(service = new AdminManagementService(), authenticateMiddleware: RequestHandler = authenticate): Router {
  const router = Router();
  router.use(authenticateMiddleware, requireSuperAdmin);

  router.post("/", async (request, response, next) => {
    try {
      const clientBaseUrl = extractClientBaseUrl(request);
      response.status(201).json(await service.createAdmin(createAdminSchema.parse(request.body), requestActor(request), clientBaseUrl));
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (request, response, next) => {
    try {
      response.status(200).json(await service.listAdmins(requestActor(request)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (request, response, next) => {
    try {
      response.status(200).json(await service.getAdmin(idSchema.parse(request.params.id), requestActor(request)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", async (request, response, next) => {
    try {
      const input = patchAdminSchema.parse(request.body);
      response.status(200).json(await service.updateAdmin(idSchema.parse(request.params.id), {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {})
      }, requestActor(request)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/status", async (request, response, next) => {
    try {
      const input = statusSchema.parse(request.body);
      response.status(200).json(await service.updateStatus(idSchema.parse(request.params.id), input.status, requestActor(request)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/resend-verification", async (request, response, next) => {
    try {
      const clientBaseUrl = extractClientBaseUrl(request);
      response.status(202).json(await service.resendVerification(idSchema.parse(request.params.id), requestActor(request), clientBaseUrl));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/activate", async (request, response, next) => {
    try {
      const input = activateAdminSchema.parse(request.body || {});
      response.status(200).json(await service.activateAdmin(idSchema.parse(request.params.id), input.password, requestActor(request)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/sync-firebase", async (_request, response, next) => {
    try {
      response.status(200).json(await service.syncAllToFirebase());
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (request, response, next) => {
    try {
      await service.deleteAdmin(idSchema.parse(request.params.id), requestActor(request));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function extractClientBaseUrl(request: import("express").Request): string | undefined {
  const origin = request.get("origin");
  if (origin && !origin.includes(":4000")) return origin.replace(/\/+$/, "");
  const referer = request.get("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      if (!u.host.includes(":4000")) return `${u.protocol}//${u.host}`;
    } catch {}
  }
  return undefined;
}

export const adminRouter = createAdminRouter();
