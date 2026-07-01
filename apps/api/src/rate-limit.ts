import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

type RouteRateLimitOptions = {
  max: number;
  timeWindowMs: number;
};

export function readRateLimitMax(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Per-route IP rate limit — active in production only. */
export async function registerRouteRateLimit(
  app: FastifyInstance,
  options: RouteRateLimitOptions,
): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  await app.register(rateLimit, {
    max: options.max,
    timeWindow: options.timeWindowMs,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: "Too many requests",
      retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
    }),
  });
}
