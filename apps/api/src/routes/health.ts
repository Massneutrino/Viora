import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  app.get("/ready", async (request) => {
    try {
      await request.server.db.$queryRaw`SELECT 1`;
      return { status: "ready", database: "connected" };
    } catch {
      return { status: "degraded", database: "disconnected" };
    }
  });
};
