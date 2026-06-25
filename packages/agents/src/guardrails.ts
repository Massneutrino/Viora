import type { AutonomyLevel } from "@viora/domain";
import type { GuardrailPolicy, PrismaClient } from "@viora/database";

const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

export type GuardrailAction = "broadcast" | "assign" | "replacement" | "dynamic_rate_clear";

export interface GuardrailDecision {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reason: string;
  policy: GuardrailPolicy | null;
}

interface EvaluateGuardrailActionInput {
  organisationId?: string;
  workerId?: string;
  action: GuardrailAction;
  roleType?: string;
  payRate?: number | null;
  strategy?: string | null;
  approvedBy?: string;
}

function requiresAutonomyApproval(action: GuardrailAction, autonomyLevel: AutonomyLevel): boolean {
  if (action === "dynamic_rate_clear") return AUTONOMY_RANK[autonomyLevel] < AUTONOMY_RANK.L3;
  if (action === "broadcast" || action === "assign" || action === "replacement") {
    return AUTONOMY_RANK[autonomyLevel] <= AUTONOMY_RANK.L1;
  }
  return false;
}

export async function evaluateGuardrailAction(
  db: PrismaClient,
  input: EvaluateGuardrailActionInput,
): Promise<GuardrailDecision> {
  const policy = input.organisationId
    ? await db.guardrailPolicy.findUnique({ where: { organisationId: input.organisationId } })
    : input.workerId
      ? await db.guardrailPolicy.findUnique({ where: { workerId: input.workerId } })
      : null;

  if (input.approvedBy) {
    return {
      allowed: true,
      requiresHumanApproval: false,
      reason: `Approved by admin ${input.approvedBy}.`,
      policy,
    };
  }

  if (!policy) {
    return {
      allowed: false,
      requiresHumanApproval: true,
      reason: "GuardrailPolicy missing.",
      policy: null,
    };
  }

  const reasons: string[] = [];
  const approvedRoleTypes = policy.approvedRoleTypes ?? [];
  if (
    input.roleType &&
    approvedRoleTypes.length > 0 &&
    !approvedRoleTypes.includes(input.roleType)
  ) {
    reasons.push(`Role ${input.roleType} is not approved for autonomous action.`);
  }

  if (input.payRate != null) {
    if (policy.budgetCeiling != null && input.payRate > policy.budgetCeiling) {
      reasons.push(`Pay rate ${input.payRate} exceeds budget ceiling ${policy.budgetCeiling}.`);
    }
    if (policy.payFloor != null && input.payRate < policy.payFloor) {
      reasons.push(`Pay rate ${input.payRate} is below pay floor ${policy.payFloor}.`);
    }
  }

  if (requiresAutonomyApproval(input.action, policy.autonomyLevel)) {
    reasons.push(`${input.action} requires human approval at autonomy ${policy.autonomyLevel}.`);
  }

  if (input.action === "broadcast" && input.strategy === "manual_approval") {
    reasons.push("Broadcast strategy manual_approval requires human approval.");
  }

  if (reasons.length > 0) {
    return {
      allowed: false,
      requiresHumanApproval: true,
      reason: reasons.join(" "),
      policy,
    };
  }

  return {
    allowed: true,
    requiresHumanApproval: false,
    reason: "Within guardrail policy.",
    policy,
  };
}
