import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  findWorkflow,
  simulateWorkflow,
  validateWorkflow,
  workflowSummaries,
  type WorkflowSimulationResult,
} from "@viora/domain";
import type { Prisma } from "@viora/database";
import { writeAuditEvent } from "../audit.js";

const simulateBodySchema = z
  .object({
    scenarioId: z.string().min(1).optional(),
    inputs: z.record(z.unknown()).optional(),
  })
  .default({});

function serialiseSimulation(result: WorkflowSimulationResult): Prisma.InputJsonValue {
  return {
    workflowId: result.workflowId,
    scenarioId: result.scenarioId,
    path: result.path,
    messages: result.messages,
    decisions: result.decisions,
    expectedAuditActions: result.expectedAuditActions,
    blocked: result.blocked,
    escalated: result.escalated,
    degraded: result.degraded,
  } as unknown as Prisma.InputJsonValue;
}

export const vWorkflowRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v-workflows", async () => ({
    workflows: workflowSummaries(),
  }));

  app.get("/v-workflows/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const workflow = findWorkflow(id);
    if (!workflow) return reply.code(404).send({ error: "Workflow not found." });

    return {
      workflow,
      validationWarnings: validateWorkflow(workflow),
    };
  });

  app.post("/v-workflows/:id/simulate", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const workflow = findWorkflow(id);
    if (!workflow) return reply.code(404).send({ error: "Workflow not found." });

    const body = simulateBodySchema.parse(request.body ?? {});
    const scenario = body.scenarioId ?? workflow.scenarios[0]?.id;
    if (!scenario) return reply.code(409).send({ error: "Workflow has no scenarios." });

    try {
      const result = simulateWorkflow(workflow, scenario, body.inputs ?? {});
      await writeAuditEvent(app.db, {
        actorType: "admin",
        actorId: "admin-demo",
        action: "workflow.simulate",
        entityType: "VWorkflow",
        entityId: workflow.id,
        inputs: {
          workflowId: workflow.id,
          scenarioId: scenario,
          syntheticInputs: body.inputs ?? {},
        } as Prisma.InputJsonValue,
        outputs: serialiseSimulation(result),
        outcome: result.blocked
          ? "blocked"
          : result.escalated
            ? "escalated"
            : result.degraded
              ? "degraded"
              : "simulated",
      });

      return { result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow simulation failed.";
      return reply.code(400).send({ error: message });
    }
  });
};
