import { searchRome } from "@job-radar/shared/rome";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import { type RomeSuggestDeps, suggestRomes } from "../rome-suggest";

const SuggestBody = z.object({ searches: z.array(z.string().trim().max(80)).min(1).max(10) });

/** Codes métier ROME : propositions à partir des métiers recherchés, et recherche dans la liste officielle. */
export async function romeRoutes(app: FastifyInstance, opts: { deps: RomeSuggestDeps }) {
  app.addHook("preHandler", requireAuth);

  app.post("/api/rome/suggest", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = SuggestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "Ajoute au moins un métier à rechercher." });
    return suggestRomes(body.data.searches, opts.deps);
  });

  app.get("/api/rome/search", async (request) => {
    const q = z.string().max(80).catch("").parse((request.query as { q?: unknown }).q);
    return { items: q.trim().length >= 2 ? searchRome(q, 8).map(({ code, label }) => ({ code, label })) : [] };
  });
}
