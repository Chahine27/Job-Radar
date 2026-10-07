import { analyzeJobText, cleanFullText } from "@job-radar/pipeline";
import { JOB_STATUSES, ManualJobSchema } from "@job-radar/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { JobDetail, JobService } from "../jobs/service";
import type { Stores } from "../stores";

const ListQuery = z.object({
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  status: z.enum([...JOB_STATUSES, "active", "all"]).default("active"),
  includeHidden: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  q: z.string().max(200).optional(),
  sort: z.enum(["score", "date"]).default("score"),
  /** Rubrique du flux : « local » (dans ta zone), « remote » (télétravail complet), « unknown » (lieu non précisé). */
  zone: z.enum(["local", "remote", "unknown"]).optional(),
  /** Seulement les offres de cette source (« france-travail », « manual »…) ; absent = toutes. */
  source: z.string().trim().max(40).regex(/^[a-z0-9-]*$/).optional(),
  /** Pagination : 20 offres par page par défaut. */
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const IdParams = z.object({ id: z.string().min(1).max(64) });
const StatusBody = z.object({ status: z.enum(JOB_STATUSES) });
const FullTextBody = z.object({
  text: z.string().max(60_000),
  /** Expérience demandée lue par l'IA (sinon lue dans le texte). */
  experienceYears: z.number().int().min(0).max(30).nullish(),
  /** Autres infos lues par l'IA (complètent ce que la source ne donne pas). */
  info: z
    .object({
      contractType: z.enum(["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"]).nullish(),
      remoteType: z.enum(["remote", "hybrid", "onsite", "unknown"]).nullish(),
      salaryMin: z.number().int().min(8000).max(500_000).nullish(),
      salaryMax: z.number().int().min(8000).max(500_000).nullish(),
    })
    .nullish(),
});
const FindBody = z.object({
  url: z.string().max(2000).optional(),
  title: z.string().max(300).optional(),
  company: z.string().max(200).optional(),
});

export async function jobRoutes(
  app: FastifyInstance,
  opts: {
    jobs: JobService;
    stores: Stores;
    ensureTravel?: (jobId: string) => Promise<string | null>;
    /** Annonce complète collée : score recalculé (mail « à postuler » s'il reste bon). */
    onJobCompleted?: (job: JobDetail) => Promise<unknown>;
  },
) {
  const { jobs } = opts;
  app.addHook("preHandler", requireAuth);

  // ───── Offres ajoutées à la main ─────
  app.get("/api/jobs/manual", async (request) => ({ items: await jobs.listManual(request.userId!) }));
  app.get("/api/jobs/applications", async (request) => ({ items: await jobs.listApplications(request.userId!) }));

  // Lecture de l'annonce collée (sans IA) : pré-remplit le formulaire, rien n'est enregistré.
  app.post("/api/jobs/manual/analyze", async (request, reply) => {
    const body = z.object({ text: z.string().max(30_000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEXT" });
    return analyzeJobText(body.data.text);
  });

  app.post("/api/jobs/manual", async (request, reply) => {
    const body = ManualJobSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_JOB",
        issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const saved = await opts.stores.jobs.addManual(request.body);
    if (!saved) return reply.code(400).send({ error: "INVALID_JOB" });
    const job = await jobs.get(request.userId!, saved.jobId);
    return reply.code(201).send({ job, duplicate: saved.duplicate, otherSources: saved.otherSources });
  });

  app.delete("/api/jobs/manual/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const r = await opts.stores.jobs.removeManual(params.data.id);
    if (r === "not_found") return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    if (r === "not_manual") return reply.code(400).send({ error: "NOT_MANUAL", message: "Cette offre n'a pas été ajoutée à la main." });
    return { result: r };
  });

  app.get("/api/jobs", async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { limit, offset, ...filters } = query.data;
    const all = await jobs.list(request.userId!, filters);
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit };
  });

  app.get("/api/jobs/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    // Trajet calculé à l'ouverture : une erreur (quota, réseau) ne doit pas empêcher d'afficher l'offre.
    let travelIssue: string | null = null;
    if (opts.ensureTravel) {
      travelIssue = await opts.ensureTravel(params.data.id).catch((err) => {
        request.log.warn({ err }, "calcul du trajet impossible");
        return err instanceof Error ? err.message.split("\n")[0]!.slice(0, 200) : "erreur inconnue";
      });
    }
    const job = await jobs.get(request.userId!, params.data.id);
    if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return { ...job, travelIssue };
  });

  const setStatus = (status?: (typeof JOB_STATUSES)[number]) =>
    async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      let target = status;
      if (!target) {
        const body = StatusBody.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: "INVALID_STATUS" });
        target = body.data.status;
      }
      const job = await jobs.setStatus(request.userId!, params.data.id, target);
      if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
      return job;
    };

  // ───── Annonce complète collée (quand la source ne donne qu'un extrait) ─────
  app.put("/api/jobs/:id/full-text", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = FullTextBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEXT", message: "Texte trop long." });
    const text = cleanFullText(body.data.text);
    if (text.length < 300) {
      return reply.code(400).send({ error: "TEXT_TOO_SHORT", message: "Texte trop court : colle toute la page de l'annonce (Ctrl + A, Ctrl + C)." });
    }
    const row = await opts.stores.jobs.setFullText(params.data.id, {
      text,
      experienceYears: body.data.experienceYears ?? analyzeJobText(text).experienceYears,
      info: body.data.info ?? null,
    });
    if (!row) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const detail = await jobs.get(request.userId!, params.data.id);
    // Sans attendre l'envoi du mail : la réponse ne dépend pas du serveur SMTP.
    if (detail && opts.onJobCompleted) void opts.onJobCompleted(detail).catch((err) => request.log.error(err, "notification après annonce complète"));
    return detail;
  });

  // Page envoyée par l'extension (ou collée) : est-ce une offre déjà connue par un simple extrait ?
  app.post("/api/jobs/find-abridged", async (request, reply) => {
    const body = FindBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const job = await jobs.findAbridged(body.data);
    return { job: job ? { id: job.id, title: job.title, company: job.company, sources: job.sources.map((s) => s.source) } : null };
  });

  app.delete("/api/jobs/:id/full-text", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const row = await opts.stores.jobs.setFullText(params.data.id, null);
    if (!row) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return jobs.get(request.userId!, params.data.id);
  });

  app.post("/api/jobs/:id/status", setStatus());
  app.post("/api/jobs/:id/save", setStatus("SAVED"));
  app.post("/api/jobs/:id/apply", setStatus("APPLIED"));
  app.post("/api/jobs/:id/ignore", setStatus("IGNORED"));
}
