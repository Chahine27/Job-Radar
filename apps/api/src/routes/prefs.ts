import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { Stores } from "../stores";

/** Une préférence = valeurs simples (texte, nombre, oui/non, liste de textes) : de quoi retenir des filtres, rien d'autre. */
const Value = z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(100)).max(30)]);
const PageParams = z.object({ page: z.string().regex(/^[a-z][a-z-]{0,29}$/) });
const PrefsBody = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), Value).refine((o) => Object.keys(o).length <= 30, "30 réglages max");

/** Filtres de chaque page retenus côté serveur : retrouvés quel que soit le navigateur ou l'adresse du site. */
export async function prefsRoutes(app: FastifyInstance, opts: { stores: Stores }) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/prefs", async (request) => opts.stores.uiPrefs.get(request.userId!));

  app.put("/api/prefs/:page", async (request, reply) => {
    const params = PageParams.safeParse(request.params);
    const body = PrefsBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_PREFS" });
    await opts.stores.uiPrefs.set(request.userId!, params.data.page, body.data);
    return { ok: true };
  });
}
