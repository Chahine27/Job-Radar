import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions, LogController } from "fastify";
import { SESSION_COOKIE, requireAuth, resolveSession } from "./auth";
import { createJobService, type JobDetail } from "./jobs/service";
import { type AiService, type LetterNotice, aiRoutes } from "./routes/ai";
import { authRoutes } from "./routes/auth";
import { type Collector, collectionRoutes } from "./routes/collection";
import { type LeadsOptions, leadRoutes } from "./routes/leads";
import { notificationRoutes } from "./routes/notifications";
import { sourceRoutes } from "./routes/sources";
import type { Mailer, Notifier } from "@job-radar/notifications";
import { jobRoutes } from "./routes/jobs";
import { type Geocoder, profileRoutes } from "./routes/profile";
import { prefsRoutes } from "./routes/prefs";
import { romeRoutes } from "./routes/rome";
import type { RomeSuggestDeps } from "./rome-suggest";
import { type SettingsService, settingsRoutes } from "./routes/settings";
import { setupRoutes } from "./routes/setup";
import type { Stores } from "./stores";

export type AppOptions = {
  stores: Stores;
  /** Origine du front autorisée à appeler l'API (ex. http://localhost:5173). */
  appUrl: string;
  /** Cookie `Secure` (HTTPS) — true en production. */
  secureCookie: boolean;
  logger?: FastifyServerOptions["logger"];
  /** Collecte (bouton Actualiser + état). Absent → routes non exposées. */
  collector?: Collector;
  notifiers?: Notifier[];
  /** Annonce complète collée sur une offre : envoie la notification « à postuler » si le score reste bon. */
  onJobCompleted?: (job: JobDetail) => Promise<unknown>;
  /** Lettre de motivation IA terminée : notification du navigateur (sauf si la page est ouverte). */
  onLetterReady?: (n: LetterNotice) => Promise<unknown>;
  /** Bouton « Arrêter Job Radar » : demande au lanceur de tout arrêter. Absent (lancé avec « pnpm dev ») → 404. */
  stopApp?: () => void;
  vapidPublicKey?: string | null;
  /** Identifiants présents dans .env, par source (affichage page Sources). Fonction = valeur à jour. */
  sourcesConfigured?: Record<string, boolean> | (() => Record<string, boolean>);
  /** Appels utilisés / limite, pour les sources à quota (Jooble). */
  sourceQuotas?: () => Promise<Record<string, { used: number; limit: number }>>;
  geocoder?: Geocoder;
  /** Calcule le trajet d'une offre si besoin (à son ouverture). */
  ensureTravel?: (jobId: string) => Promise<string | null>;
  searchCompanies?: LeadsOptions["searchCompanies"];
  companiesConfigured?: LeadsOptions["companiesConfigured"];
  findAddress?: LeadsOptions["findAddress"];
  /** IA locale (Ollama) : résumé et analyse des offres. */
  ai?: AiService;
  /** Envoi des candidatures spontanées par email (compte SMTP de .env). */
  mailer?: Mailer;
  /** Page « Réglages » : clés de .env et tests des services. Absent → routes non exposées. */
  settings?: SettingsService;
  /** Propositions de codes métier ROME (ROMEO, IA locale). Absent → recherche dans la liste officielle seule. */
  rome?: RomeSuggestDeps;
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 256 * 1024,
    // Pas une ligne par requête (le site interroge l'état de la collecte régulièrement) ; les erreurs restent journalisées.
    logController: new LogController({ disableRequestLogging: true }),
  });
  const allowedOrigin = new URL(opts.appUrl).origin;

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("userId", null);

  // Erreur interne : on la journalise, mais on ne renvoie aucun détail (chemins, requêtes SQL...).
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
    return reply.code(status).send({ error: error.message });
  });

  // Protection CSRF : un navigateur envoie toujours l'en-tête Origin sur un POST/PUT.
  // S'il vient d'un autre site → refusé. (En plus du cookie SameSite=Strict.)
  app.addHook("onRequest", async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== allowedOrigin) {
      return reply.code(403).send({ error: "FORBIDDEN_ORIGIN" });
    }
  });

  app.addHook("onRequest", async (request) => {
    request.userId = await resolveSession(opts.stores.sessions, request.cookies[SESSION_COOKIE]);
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  if (opts.stopApp) {
    const stopApp = opts.stopApp;
    app.post("/api/system/stop", { preHandler: requireAuth }, async (_request, reply) => {
      stopApp();
      return reply.code(202).send({ status: "stopping" });
    });
  }

  await app.register(authRoutes, { stores: opts.stores, secureCookie: opts.secureCookie });
  await app.register(setupRoutes, { stores: opts.stores, secureCookie: opts.secureCookie, ...(opts.geocoder ? { geocoder: opts.geocoder } : {}) });
  await app.register(prefsRoutes, { stores: opts.stores });
  await app.register(profileRoutes, { stores: opts.stores, ...(opts.geocoder ? { geocoder: opts.geocoder } : {}) });
  // Un seul service : le cache des scores est partagé, et l'avis de l'IA corrige les scores trop optimistes.
  const jobService = createJobService(opts.stores, undefined, opts.ai ? { aiModel: opts.ai.model } : {});
  await app.register(jobRoutes, {
    jobs: jobService,
    stores: opts.stores,
    ...(opts.ensureTravel ? { ensureTravel: opts.ensureTravel } : {}),
    ...(opts.onJobCompleted ? { onJobCompleted: opts.onJobCompleted } : {}),
  });
  await app.register(aiRoutes, { stores: opts.stores, jobs: jobService, ...(opts.ai ? { ai: opts.ai } : {}), ...(opts.mailer ? { mailer: opts.mailer } : {}), ...(opts.onLetterReady ? { onLetterReady: opts.onLetterReady } : {}) });
  if (opts.collector) await app.register(collectionRoutes, { collector: opts.collector });
  await app.register(leadRoutes, {
    stores: opts.stores,
    ...(opts.searchCompanies ? { searchCompanies: opts.searchCompanies } : {}),
    ...(opts.findAddress ? { findAddress: opts.findAddress } : {}),
    ...(opts.companiesConfigured ? { companiesConfigured: opts.companiesConfigured } : {}),
  });
  await app.register(romeRoutes, { deps: opts.rome ?? {} });
  if (opts.settings) await app.register(settingsRoutes, { settings: opts.settings });
  await app.register(sourceRoutes, { stores: opts.stores, configured: opts.sourcesConfigured ?? {}, quotas: opts.sourceQuotas });
  await app.register(notificationRoutes, {
    stores: opts.stores,
    notifiers: opts.notifiers ?? [],
    vapidPublicKey: opts.vapidPublicKey ?? null,
  });

  return app;
}
