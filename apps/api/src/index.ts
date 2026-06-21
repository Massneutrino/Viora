import Fastify from "fastify";
import cors from "@fastify/cors";
import { PHASE_0 } from "@viora/domain";
import {
  vAgent,
  stubMarketAgent,
  stubOpsAgent,
  stubTrustComplianceAgent,
  stubWorkerContextAgent,
} from "@viora/agents";
import { prisma } from "@viora/database";
import { healthRoutes } from "./routes/health.js";
import { intakeRoutes } from "./routes/intake.js";
import { bookingRoutes } from "./routes/bookings.js";
import { workerRoutes } from "./routes/workers.js";
import { adminRoutes } from "./routes/admin.js";

const port = Number(process.env.API_PORT ?? 4000);

async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.decorate("agents", {
    v: vAgent,
    worker: stubWorkerContextAgent,
    market: stubMarketAgent,
    compliance: stubTrustComplianceAgent,
    ops: stubOpsAgent,
  });

  app.decorate("db", prisma);

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(intakeRoutes, { prefix: "/v1/intake" });
  await app.register(bookingRoutes, { prefix: "/v1/bookings" });
  await app.register(workerRoutes, { prefix: "/v1/workers" });
  await app.register(adminRoutes, { prefix: "/v1/admin" });

  app.get("/", async () => ({
    name: "Viora API",
    phase: "Phase 0 Pilot",
    scope: PHASE_0,
  }));

  return app;
}

buildServer()
  .then((app) => app.listen({ port, host: "0.0.0.0" }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

declare module "fastify" {
  interface FastifyInstance {
    agents: {
      v: typeof vAgent;
      worker: typeof stubWorkerContextAgent;
      market: typeof stubMarketAgent;
      compliance: typeof stubTrustComplianceAgent;
      ops: typeof stubOpsAgent;
    };
    db: typeof prisma;
  }
}
