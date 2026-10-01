import { OllamaClient, analyzeJobWithAi, readJobWithAi, writeCoverLetter } from "@job-radar/ai";
import { createPrismaClient } from "@job-radar/db";
import {
  createEmailNotifier,
  createMailer,
  createPrismaNotifyRepo,
  createWebPushNotifier,
  notifyNewMatches,
} from "@job-radar/notifications";
import { CollectionRunner, createPrismaRunRepo, expireJobs, prismaCollect, prismaJoobleQuota } from "@job-radar/pipeline";
import { PrimRoutingService, ensureTravelTimes, geocode } from "@job-radar/routing";
import { scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { ProfileSchema } from "@job-radar/shared";
import {
  type AtsKind,
  AdzunaSource,
  CompanyCareersSource,
  FranceTravailSource,
  JOOBLE_DEFAULTS,
  JoobleSource,
  LaBonneBoiteClient,
  RechercheEntreprisesClient,
} from "@job-radar/source-connectors";
import { buildApp } from "./app";
import { loadEnv } from "./env";
import { createPrismaStores } from "./prisma-stores";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

let log: (msg: string) => void = (msg) => console.log(msg);
const e = process.env;

const notifiers = [
  createEmailNotifier({
    host: e.SMTP_HOST?.trim(),
    port: e.SMTP_PORT ? Number(e.SMTP_PORT) : undefined,
    user: e.SMTP_USER?.trim(),
    password: e.SMTP_PASSWORD?.replace(/\s/g, ""), // mot de passe d'application Gmail souvent collé avec des espaces
    from: e.SMTP_FROM?.trim(),
    to: async () => {
      const s = await prisma.notificationSettings.findUnique({ where: { id: "singleton" } });
      return s?.emailTo || e.NOTIFY_EMAIL_TO?.trim() || null;
    },
  }),
  createWebPushNotifier({
    publicKey: e.VAPID_PUBLIC_KEY?.trim(),
    privateKey: e.VAPID_PRIVATE_KEY?.trim(),
    subject: e.VAPID_SUBJECT?.trim() || (e.NOTIFY_EMAIL_TO ? `mailto:${e.NOTIFY_EMAIL_TO.trim()}` : undefined),
    subscriptions: {
      list: async () =>
        (await prisma.pushSubscription.findMany()).map((p) => ({
          endpoint: p.endpoint,
          keys: p.keys as { p256dh: string; auth: string },
        })),
      remove: async (endpoint) => void (await prisma.pushSubscription.deleteMany({ where: { endpoint } })),
    },
  }),
];
// Candidatures spontanées : envoyées depuis le même compte SMTP (Gmail), seulement après ton clic « Envoyer ».
const mailer = createMailer({
  host: e.SMTP_HOST?.trim(),
  port: e.SMTP_PORT ? Number(e.SMTP_PORT) : undefined,
  user: e.SMTP_USER?.trim(),
  password: e.SMTP_PASSWORD?.replace(/\s/g, ""),
});
const notifyRepo = createPrismaNotifyRepo(prisma);
const routing = new PrimRoutingService({ apiKey: e.PRIM_API_KEY?.trim() });
const franceTravail = new FranceTravailSource({
  clientId: e.FRANCE_TRAVAIL_CLIENT_ID?.trim(),
  clientSecret: e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim(),
});
/** Vérification des offres expirées : au plus toutes les 6 heures. */
let lastExpiryAt = 0;
// IA locale (Ollama, gratuite, sur ce PC). Réglages facultatifs : OLLAMA_URL, OLLAMA_MODEL.
const ollama = new OllamaClient({ baseUrl: e.OLLAMA_URL, model: e.OLLAMA_MODEL });
const joobleKey = e.JOOBLE_API_KEY?.trim();
const joobleQuota = prismaJoobleQuota(prisma, joobleKey);
const sirene = new RechercheEntreprisesClient();
const lbb = new LaBonneBoiteClient({ clientId: e.FRANCE_TRAVAIL_CLIENT_ID?.trim(), clientSecret: e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim() });

const runner = new CollectionRunner({
  log: (msg) => log(msg),
  repo: createPrismaRunRepo(prisma),
  sources: [
    franceTravail,
    new AdzunaSource({ appId: e.ADZUNA_APP_ID?.trim(), appKey: e.ADZUNA_APP_KEY?.trim() }),
    new JoobleSource({ apiKey: joobleKey, quota: joobleQuota }),
    new CompanyCareersSource({
      companies: async () =>
        (await prisma.companyTarget.findMany()).map((c) => ({ ...c, ats: c.ats as AtsKind })),
    }),
  ],
  collect: prismaCollect(prisma, env.CRON_INTERVAL_MINUTES),
  // Après chaque collecte : annonce les nouvelles offres compatibles.
  onFinished: async (report) => {
    if (Date.now() - lastExpiryAt > 6 * 3600_000) {
      lastExpiryAt = Date.now();
      await expireJobs({ prisma, ftIsOnline: (id) => franceTravail.isStillOnline(id), log: (m) => log(m) }).catch((err) =>
        log(`Expiration : ${String(err)}`),
      );
    }
    const run = await prisma.collectionRun.findUnique({ where: { id: report.runId }, select: { startedAt: true } });
    const row = await prisma.profile.findFirst();
    if (!run || !row) return;
    const profile = ProfileSchema.parse(row.data);
    // 1) temps de trajet des seules nouvelles offres qui peuvent être notifiées (≥ seuil − 5, car un bon
    //    trajet peut faire monter le score), 2) notifications. Les autres : calcul à l'ouverture de l'offre.
    const candidates = await notifyRepo.candidates(run.startedAt);
    const likely = candidates
      .filter((j) => {
        const s = scoreJob(scoringInputFromJob(j), profile);
        return !s.hidden && s.final >= profile.minScoreForNotification - 5;
      })
      .map((j) => j.id);
    await ensureTravelTimes({ prisma, routing, jobIds: likely, maxRoutes: 30, log: (m) => log(m) }).catch((err) =>
      log(`Trajets : ${String(err)}`),
    );
    await notifyNewMatches({
      repo: notifyRepo,
      notifiers,
      profile,
      since: run.startedAt,
      appUrl: env.APP_URL,
      log: (m) => log(m),
    });
  },
});

const app = await buildApp({
  stores: createPrismaStores(prisma),
  collector: runner,
  notifiers,
  vapidPublicKey: e.VAPID_PUBLIC_KEY?.trim() || null,
  geocoder: (q) => geocode(q, { limit: 5 }),
  ...(lbb.isConfigured() ? { searchCompanies: (p: Parameters<LaBonneBoiteClient["search"]>[0]) => lbb.search(p) } : {}),
  // Adresse exacte des entreprises (API publique de l'État, sans clé).
  findAddress: (siret: string) => sirene.address(siret),
  // Trajet calculé à l'ouverture d'une offre (1 appel au plus, puis mis en cache).
  // Renvoie la raison si le trajet n'a pas pu être calculé (affichée sur la page de l'offre).
  ensureTravel: async (jobId) => {
    const report = await ensureTravelTimes({ prisma, routing, jobIds: [jobId], maxRoutes: 1, log: (m) => log(m) });
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { remoteType: true, travel: { select: { minutes: true } } } });
    if (!job || job.remoteType === "remote") return null;
    if (job.travel?.minutes != null) return null;
    if (job.travel) return "aucun itinéraire en transports trouvé depuis ton point de départ";
    return report.skipped ?? "lieu de l'offre inconnu ou hors zone";
  },
  sourcesConfigured: {
    "france-travail": Boolean(e.FRANCE_TRAVAIL_CLIENT_ID?.trim() && e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim()),
    adzuna: Boolean(e.ADZUNA_APP_ID?.trim() && e.ADZUNA_APP_KEY?.trim()),
    jooble: Boolean(joobleKey),
  },
  // Compteur Jooble affiché sur la page Sources (500 appels à vie par clé gratuite).
  sourceQuotas: async () => ({ jooble: { used: (await joobleQuota.get()).used, limit: JOOBLE_DEFAULTS.lifetimeLimit } }),
  ai: {
    model: ollama.model,
    status: () => ollama.status(),
    analyze: (job, profile) => analyzeJobWithAi(ollama, job, profile),
    writeLetter: (job, kit, opts) => writeCoverLetter(ollama, job, kit, new Date(), opts),
    readJob: (text, hints) => readJobWithAi(ollama, text, hints),
  },
  mailer,
  appUrl: env.APP_URL,
  secureCookie: env.NODE_ENV === "production",
  logger:
    env.NODE_ENV === "development"
      ? { level: "info", transport: { target: "pino-pretty", options: { ignore: "pid,hostname" } } }
      : { level: "info" },
});

const shutdown = async () => {
  await runner.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log = (msg) => app.log.info(msg);

// 127.0.0.1 : accessible uniquement depuis ton PC.
await app.listen({ host: env.API_HOST, port: env.API_PORT });

const on = notifiers.filter((n) => n.isConfigured()).map((n) => n.channel);
app.log.info(`Temps de trajet : ${routing.isConfigured() ? "PRIM configuré" : "non configuré (PRIM_API_KEY dans .env)"}`);
app.log.info(`Notifications configurées : ${on.length ? on.join(", ") : "aucune (voir .env)"}`);

if (env.SCHEDULER_ENABLED) {
  await runner.startScheduler(60_000);
  app.log.info(`Collecte automatique active (vérification chaque minute, France Travail toutes les ${env.CRON_INTERVAL_MINUTES} min)`);
} else {
  app.log.info("Collecte automatique désactivée (SCHEDULER_ENABLED=false)");
}
