import { writeFileSync } from "node:fs";
import { OllamaClient, analyzeJobWithAi, pickRomeWithAi, readCvWithAi, readJobWithAi, writeCoverLetter } from "@job-radar/ai";
import { createPrismaClient } from "@job-radar/db";
import {
  createEmailNotifier,
  createMailer,
  createPrismaNotifyRepo,
  createWebPushNotifier,
  notifyCompletedJob,
  notifyNewMatches,
  notifyNotice,
} from "@job-radar/notifications";
import { CollectionRunner, createPrismaRunRepo, expireJobs, prismaCollect, prismaJoobleQuota } from "@job-radar/pipeline";
import { FallbackRoutingService, IgnRoutingService, PrimRoutingService, distanceKm, ensureTravelTimes, geocode, inIdf } from "@job-radar/routing";
import { scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { ProfileSchema } from "@job-radar/shared";
import {
  AdzunaSource,
  FranceTravailSource,
  JOOBLE_DEFAULTS,
  JoobleSource,
  LaBonneBoiteClient,
  RomeoClient,
  RechercheEntreprisesClient,
} from "@job-radar/source-connectors";
import { buildApp } from "./app";
import { updateEnvFile } from "./env-file";
import { ENV_PATH, loadEnv } from "./env";
import { liveMailer, liveNotifier, liveRouting, liveSource, smtpFrom, testService } from "./live";
import type { SettingsService } from "./routes/settings";
import { SETTING_KEYS } from "./settings-keys";
import { createPrismaStores } from "./prisma-stores";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

let log: (msg: string) => void = (msg) => console.log(msg);
const e = process.env;

/**
 * Services qui dépendent des clés de .env. Reconstruits quand une clé change dans la page « Réglages » :
 * le reste de l'appli passe par des relais (live.ts) et voit tout de suite les nouvelles valeurs.
 */
/** Itinéraire en voiture (IGN, France entière, sans clé) : un seul pour garder sa limite d'appels. */
const ignCar = new IgnRoutingService();

function buildKeyed() {
  const smtp = smtpFrom(e);
  const joobleKey = e.JOOBLE_API_KEY?.trim() || undefined;
  const joobleQuota = prismaJoobleQuota(prisma, joobleKey);
  const ftCreds = { clientId: e.FRANCE_TRAVAIL_CLIENT_ID?.trim(), clientSecret: e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim() };
  return {
    email: createEmailNotifier({
      ...smtp,
      from: e.SMTP_FROM?.trim(),
      to: async () => {
        const s = await prisma.notificationSettings.findUnique({ where: { id: "singleton" } });
        return s?.emailTo || e.NOTIFY_EMAIL_TO?.trim() || null;
      },
    }),
    // Candidatures spontanées : envoyées depuis le même compte SMTP (Gmail), seulement après ton clic « Envoyer ».
    mailer: createMailer(smtp),
    // Transports en commun en Île-de-France (PRIM, si la clé est là), sinon voiture partout en France (IGN).
    routing: new FallbackRoutingService([
      { service: new PrimRoutingService({ apiKey: e.PRIM_API_KEY?.trim() }), covers: (o, d) => inIdf(o) && inIdf(d) },
      { service: ignCar },
    ]),
    franceTravail: new FranceTravailSource(ftCreds),
    adzuna: new AdzunaSource({ appId: e.ADZUNA_APP_ID?.trim(), appKey: e.ADZUNA_APP_KEY?.trim() }),
    jooble: new JoobleSource({ apiKey: joobleKey, quota: joobleQuota }),
    joobleQuota,
    lbb: new LaBonneBoiteClient(ftCreds),
    romeo: new RomeoClient(ftCreds),
    // Lettre de motivation : un modèle plus gros (OLLAMA_LETTER_MODEL, ex. gemma4:12b) écrit mieux mais plus lentement ;
    // sans réglage, le même modèle que le reste.
    letterAi: e.OLLAMA_LETTER_MODEL?.trim() ? new OllamaClient({ baseUrl: e.OLLAMA_URL, model: e.OLLAMA_LETTER_MODEL, timeoutMs: 300_000 }) : null,
    configured: {
      "france-travail": Boolean(ftCreds.clientId && ftCreds.clientSecret),
      adzuna: Boolean(e.ADZUNA_APP_ID?.trim() && e.ADZUNA_APP_KEY?.trim()),
      jooble: Boolean(joobleKey),
    },
  };
}
let keyed = buildKeyed();

const settings: SettingsService = {
  values: () => Object.fromEntries(SETTING_KEYS.map((k) => [k, e[k]])),
  async save(updates) {
    await updateEnvFile(ENV_PATH, updates);
    for (const [k, v] of Object.entries(updates)) {
      if (v) e[k] = v;
      else delete e[k];
    }
    keyed = buildKeyed();
    log(`Réglages enregistrés : ${Object.keys(updates).join(", ")}`);
  },
  test: (service) => testService(service, settings.values(), { joobleQuota: (key) => prismaJoobleQuota(prisma, key), ollamaUrl: e.OLLAMA_URL }),
};

const notifiers = [
  liveNotifier(() => keyed.email),
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
const mailer = liveMailer(() => keyed.mailer);
const notifyRepo = createPrismaNotifyRepo(prisma);
const routing = liveRouting(() => keyed.routing);
/** Vérification des offres expirées : au plus toutes les 6 heures. */
let lastExpiryAt = 0;
// IA locale (Ollama, gratuite, sur ce PC). Réglages facultatifs : OLLAMA_URL, OLLAMA_MODEL.
const ollama = new OllamaClient({ baseUrl: e.OLLAMA_URL, model: e.OLLAMA_MODEL });
const sirene = new RechercheEntreprisesClient();

const runner = new CollectionRunner({
  log: (msg) => log(msg),
  repo: createPrismaRunRepo(prisma),
  sources: [
    liveSource(() => keyed.franceTravail),
    liveSource(() => keyed.adzuna),
    liveSource(() => keyed.jooble),
  ],
  collect: prismaCollect(prisma, env.CRON_INTERVAL_MINUTES),
  // Après chaque collecte : annonce les nouvelles offres compatibles.
  onFinished: async (report) => {
    if (Date.now() - lastExpiryAt > 6 * 3600_000) {
      lastExpiryAt = Date.now();
      await expireJobs({ prisma, ftIsOnline: (id) => keyed.franceTravail.isStillOnline(id), log: (m) => log(m) }).catch((err) =>
        log(`Expiration : ${String(err)}`),
      );
    }
    const run = await prisma.collectionRun.findUnique({ where: { id: report.runId }, select: { startedAt: true } });
    const row = await prisma.profile.findFirst();
    if (!run || !row) return;
    const profile = ProfileSchema.parse(row.data);
    const home = row.homeLat !== null && row.homeLng !== null ? { lat: row.homeLat, lng: row.homeLng } : null;
    const distanceOf = (j: { latitude: number | null; longitude: number | null }) =>
      home && j.latitude !== null && j.longitude !== null ? distanceKm(home, { lat: j.latitude, lng: j.longitude }) : null;
    // 1) temps de trajet des seules nouvelles offres qui peuvent être notifiées (≥ seuil − 5, car un bon
    //    trajet peut faire monter le score), 2) notifications. Les autres : calcul à l'ouverture de l'offre.
    const candidates = await notifyRepo.candidates(run.startedAt);
    const likely = candidates
      .filter((j) => {
        const s = scoreJob({ ...scoringInputFromJob(j), distanceKm: distanceOf(j) }, profile);
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
  // Lancé par « Lancer Job Radar.cmd » : ce fichier demande au lanceur (qui le surveille) de tout arrêter.
  ...(e.JOB_RADAR_STOP_FILE ? { stopApp: () => writeFileSync(e.JOB_RADAR_STOP_FILE!, "") } : {}),
      distanceOf,
      log: (m) => log(m),
    });
  },
});

const app = await buildApp({
  stores: createPrismaStores(prisma),
  collector: {
    start: (trigger) => runner.start(trigger),
    status: () => runner.status(),
    startSource: (source) => runner.start("manual", [source], true),
  },
  notifiers,
  // Offre « à compléter » complétée : « à postuler » si le score recalculé (celui affiché) reste bon.
  // Lettre de motivation terminée (offre ou candidature spontanée) : notification du navigateur.
  onLetterReady: ({ path, ...n }) => notifyNotice({ repo: notifyRepo, notifiers, notice: { ...n, url: new URL(path, env.APP_URL).href }, log: (m) => log(m) }),
  onJobCompleted: async (job) => {
    const row = await prisma.profile.findFirst();
    if (!row) return;
    await notifyCompletedJob({
      repo: notifyRepo,
      notifiers,
      profile: ProfileSchema.parse(row.data),
      job,
      score: { final: job.score.final, hidden: job.score.hidden, matchedSkills: job.matchedSkills, missingSkills: job.missingSkills },
      abridged: job.abridged,
      appUrl: env.APP_URL,
      log: (m) => log(m),
    });
  },
  vapidPublicKey: e.VAPID_PUBLIC_KEY?.trim() || null,
  geocoder: (q) => geocode(q, { limit: 5 }),
  searchCompanies: (p) => keyed.lbb.search(p),
  companiesConfigured: () => keyed.lbb.isConfigured(),
  // Adresse exacte des entreprises (API publique de l'État, sans clé).
  findAddress: (siret: string) => sirene.address(siret),
  // Trajet calculé à l'ouverture d'une offre (1 appel au plus, puis mis en cache).
  // Renvoie la raison si le trajet n'a pas pu être calculé (affichée sur la page de l'offre).
  ensureTravel: async (jobId) => {
    const report = await ensureTravelTimes({ prisma, routing, jobIds: [jobId], maxRoutes: 1, log: (m) => log(m) });
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { remoteType: true, travel: { select: { minutes: true } } } });
    if (!job || job.remoteType === "remote") return null;
    if (job.travel?.minutes != null) return null;
    if (job.travel) return "aucun itinéraire trouvé depuis ton point de départ";
    return report.skipped ?? "lieu de l'offre inconnu ou hors zone";
  },
  sourcesConfigured: () => keyed.configured,
  // Compteur Jooble affiché sur la page Sources (500 appels à vie par clé gratuite).
  sourceQuotas: async () => ({ jooble: { used: (await keyed.joobleQuota.get()).used, limit: JOOBLE_DEFAULTS.lifetimeLimit } }),
  ai: {
    model: ollama.model,
    status: () => ollama.status(),
    analyze: (job, profile) => analyzeJobWithAi(ollama, job, profile),
    writeLetter: (job, kit, opts) => writeCoverLetter(keyed.letterAi ?? ollama, job, kit, new Date(), opts),
    readJob: (text, hints) => readJobWithAi(ollama, text, hints),
    readCv: (cvText) => readCvWithAi(ollama, cvText),
  },
  mailer,
  settings,
  // Codes métier : ROMEO (France Travail) si les identifiants sont là, sinon l'IA locale choisit dans la liste officielle.
  rome: {
    romeo: { isConfigured: () => keyed.romeo.isConfigured(), predict: (titles) => keyed.romeo.predict(titles) },
    aiPick: (searches, candidates) => pickRomeWithAi(ollama, searches, candidates),
  },
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
app.log.info(`Temps de trajet : ${routing.name.includes("prim") ? "transports en commun en Île-de-France (PRIM), voiture ailleurs (IGN)" : "voiture (IGN) ; clé PRIM dans Réglages pour les transports en Île-de-France"}`);
app.log.info(`Notifications configurées : ${on.length ? on.join(", ") : "aucune (voir Réglages)"}`);

if (env.SCHEDULER_ENABLED) {
  await runner.startScheduler(60_000);
  app.log.info(`Collecte automatique active (vérification chaque minute, France Travail toutes les ${env.CRON_INTERVAL_MINUTES} min)`);
} else {
  app.log.info("Collecte automatique désactivée (SCHEDULER_ENABLED=false)");
}
