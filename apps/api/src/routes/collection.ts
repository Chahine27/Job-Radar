import type { CollectionStatus, StartResult } from "@job-radar/pipeline";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth";

/** Ce dont les routes ont besoin du CollectionRunner (interface → testable). */
export interface Collector {
  start(trigger: "manual"): Promise<StartResult | null>;
  status(): Promise<CollectionStatus>;
}

export async function collectionRoutes(app: FastifyInstance, opts: { collector: Collector }) {
  app.addHook("preHandler", requireAuth);

  // README §13 : empêche les refresh simultanés, lance la collecte en arrière-plan.
  app.post(
    "/api/jobs/refresh",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      const res = await opts.collector.start("manual");
      if (!res) return reply.code(409).send({ error: "NO_ENABLED_SOURCE" });
      return reply.code(202).send(res);
    },
  );

  app.get("/api/collection/status", async () => opts.collector.status());
}
