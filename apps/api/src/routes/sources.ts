import { minIntervalFor } from "@job-radar/pipeline";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { Stores } from "../stores";

export const SOURCE_LABELS: Record<string, string> = {
  "france-travail": "France Travail",
  adzuna: "Adzuna",
  jooble: "Jooble",
  "jobscraper:linkedin": "JobScraper · LinkedIn",
  "jobscraper:hellowork": "JobScraper · HelloWork",
  "jobscraper:wttj": "JobScraper · Welcome to the Jungle",
};

export type SourcesOptions = {
  stores: Stores;
  /** Identifiants présents dans .env, par source. Fonction = relue à chaque appel (Réglages). */
  configured: Record<string, boolean> | (() => Record<string, boolean>);
  /** Appels utilisés / limite, pour les sources à quota (Jooble). */
  quotas?: () => Promise<Record<string, { used: number; limit: number }>>;
};

const SourceBody = z.object({ enabled: z.boolean(), intervalMinutes: z.number().int().min(1).max(1440) });

export async function sourceRoutes(app: FastifyInstance, opts: SourcesOptions) {
  const { stores } = opts;
  app.addHook("preHandler", requireAuth);

  async function callsPerRun(userId: string) {
    const rec = await stores.profiles.get(userId);
    return rec ? rec.profile.searches.length * rec.profile.locations.length : 12;
  }

  app.get("/api/sources", async (request) => {
    const calls = await callsPerRun(request.userId!);
    const quotas = (await opts.quotas?.().catch(() => null)) ?? {};
    const configured = typeof opts.configured === "function" ? opts.configured() : opts.configured;
    return {
      items: (await stores.sources.list()).map((s) => ({
        ...s,
        quota: quotas[s.source] ?? null,
        label: SOURCE_LABELS[s.source] ?? s.source,
        minIntervalMinutes: minIntervalFor(s.source, calls),
        configured: configured[s.source] ?? false,
      })),
    };
  });

  app.put("/api/sources/:source", async (request, reply) => {
    const { source } = request.params as { source: string };
    const body = SourceBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const min = minIntervalFor(source, await callsPerRun(request.userId!));
    if (body.data.intervalMinutes < min) {
      return reply.code(400).send({ error: "INTERVAL_TOO_SHORT", message: `Minimum ${min} min pour respecter les limites de cette source.` });
    }
    const row = await stores.sources.update(source, body.data);
    if (!row) return reply.code(404).send({ error: "SOURCE_NOT_FOUND" });
    return row;
  });
}
