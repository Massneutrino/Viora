import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { PHASE_0 } from "@viora/domain";
import {
  vAgent,
  createTrustComplianceAgent,
  createMarketAgent,
  createWorkerContextAgent,
  createEmployerContextAgent,
  createOpsAgent,
  createMemoryAgent,
  getActiveLlmConfig,
} from "@viora/agents";
import type {
  EmployerContextAgent,
  MarketAgent,
  MemoryAgent,
  OpsAgent,
  TrustComplianceAgent,
  WorkerContextAgent,
} from "@viora/agents";
import { prisma } from "@viora/database";
import { healthRoutes } from "./routes/health.js";
import { intakeRoutes } from "./routes/intake.js";
import { bookingRoutes } from "./routes/bookings.js";
import { workerRoutes } from "./routes/workers.js";
import { organisationRoutes } from "./routes/organisations.js";
import { adminRoutes } from "./routes/admin.js";
import { complianceAdminRoutes } from "./routes/compliance.js";
import { demoRoutes } from "./routes/demo.js";
import { pilotRoutes } from "./routes/pilot.js";
import { sandboxRoutes } from "./routes/sandbox.js";
import { memoryRoutes } from "./routes/memory.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { voiceRoutes } from "./routes/voice.js";
import { vWorkflowRoutes } from "./routes/v-workflows.js";
import { scheduleRoutes } from "./routes/schedule.js";

const port = Number(process.env.API_PORT ?? 6200);

function checkEnv() {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const aiKey = provider === "google" ? "GOOGLE_API_KEY" : "ANTHROPIC_API_KEY";
  const missing = ["DATABASE_URL", aiKey].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `[Viora API] Missing required env vars: ${missing.join(", ")}\n` +
        `Run from repo root: npm run dev  (not tsx directly — dotenv won't load otherwise)`,
    );
    process.exit(1);
  }
}
checkEnv();
const llm = getActiveLlmConfig();
console.log(`[Viora API] LLM: ${llm.provider} / ${llm.model}`);

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  const complianceAgent = createTrustComplianceAgent(prisma);
  const memoryAgent = createMemoryAgent(prisma);
  const marketAgent = createMarketAgent(prisma, complianceAgent, memoryAgent);
  app.decorate("agents", {
    v: vAgent,
    employer: createEmployerContextAgent(prisma, complianceAgent, marketAgent, memoryAgent),
    worker: createWorkerContextAgent(prisma, memoryAgent),
    market: marketAgent,
    compliance: complianceAgent,
    ops: createOpsAgent(prisma),
    memory: memoryAgent,
  });

  app.decorate("db", prisma);

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(intakeRoutes, { prefix: "/v1/intake" });
  await app.register(bookingRoutes, { prefix: "/v1/bookings" });
  await app.register(workerRoutes, { prefix: "/v1/workers" });
  await app.register(organisationRoutes, { prefix: "/v1/organisations" });
  await app.register(pilotRoutes, { prefix: "/v1/pilot" });
  await app.register(voiceRoutes, { prefix: "/v1/voice" });
  await app.register(scheduleRoutes, { prefix: "/v1" });
  await app.register(memoryRoutes, { prefix: "/v1" });
  await app.register(whatsappRoutes, { prefix: "/v1/webhooks" });
  await app.register(adminRoutes, { prefix: "/v1/admin" });
  await app.register(vWorkflowRoutes, { prefix: "/v1/admin" });
  await app.register(complianceAdminRoutes, { prefix: "/v1/admin" });
  await app.register(demoRoutes, { prefix: "/v1/admin" });
  await app.register(sandboxRoutes, { prefix: "/v1/admin/sandbox" });

  app.get("/", async () => ({
    name: "Viora API",
    phase: "Phase 0 Pilot",
    scope: PHASE_0,
  }));

  return app;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  buildServer()
    .then((app) => app.listen({ port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

declare module "fastify" {
  interface FastifyInstance {
    agents: {
      v: typeof vAgent;
      employer: EmployerContextAgent;
      worker: WorkerContextAgent;
      market: MarketAgent;
      compliance: TrustComplianceAgent;
      ops: OpsAgent;
      memory: MemoryAgent;
    };
    db: typeof prisma;
  }
}
