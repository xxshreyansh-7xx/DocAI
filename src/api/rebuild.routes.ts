import type { FastifyInstance } from "fastify";
import type { RebuildController } from "./rebuild.controller";

export async function registerRebuildRoutes(
  app: FastifyInstance,
  controller: RebuildController,
): Promise<void> {
  app.post("/rebuild/jobs", controller.submit);
  app.get("/rebuild/jobs/:jobId", controller.status);
  app.get("/rebuild/jobs/:jobId/result", controller.result);
}
