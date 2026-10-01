import { hash } from "@node-rs/argon2";
import { EXAMPLE_PROFILE, type LetterKit, type Profile } from "@job-radar/shared";
import type { Mailer, Notifier, OutgoingMail } from "@job-radar/notifications";
import { buildManualJob } from "@job-radar/pipeline";
import { buildApp } from "./app";
import type { SettingsService } from "./routes/settings";
import type {
  HomeLocation,
  LeadRow,
  JobRow,
  NotificationSettingsRecord,
  ProfileRecord,
  PushSubscriptionInput,
  Stores,
  StoredApplication,
  StoredLetter,
  UserRecord,
} from "./stores";

export function job(partial: Partial<JobRow> & Pick<JobRow, "id" | "title" | "description">): JobRow {
  return {
    contentHash: partial.id,
    company: "Entreprise test",
    contractType: "CDI",
    experienceText: null,
    experienceMinYrs: 2,
    salaryMin: 40000,
    salaryMax: 45000,
    salaryText: null,
    city: "Villeurbanne",
    postalCode: "69100",
    department: "69",
    address: null,
    remoteType: "hybrid",
    technologies: [],
    publishedAt: new Date("2026-09-27T10:00:00Z"),
    firstSeenAt: new Date("2026-09-27T10:05:00Z"),
    status: "NEW",
    travelMinutes: 30,
    sources: [{ source: "demo", url: `https://example.com/${partial.id}` }],
    fullTextAt: null,
    ...partial,
  };
}

export const TEST_JOBS: JobRow[] = [
  job({ id: "j-vue", title: "Développeur Vue.js", description: "Vue 3, TypeScript, Node.js" }),
  job({ id: "j-ruby", title: "Développeur Ruby", description: "Ruby on Rails, Kubernetes" }),
  job({ id: "j-cdd", title: "Développeur Vue.js CDD", description: "Vue 3", contractType: "CDD" }),
  job({
    id: "j-java",
    title: "Développeur Java",
    description: "Java, Spring Boot, Angular",
    publishedAt: new Date("2026-09-28T08:00:00Z"),
  }),
];

export const TEST_EMAIL = "test@example.com";
export const TEST_PASSWORD = "un-mot-de-passe-solide";
export const APP_URL = "http://localhost:5173";

/** Profil technique isolé aux tests API dont les offres de démonstration sont des postes de développement. */
export const DEVELOPER_TEST_PROFILE: Profile = {
  ...EXAMPLE_PROFILE,
  skills: [
    "Vue.js", "JavaScript", "TypeScript", "React", "Node.js", "Java", "Spring Boot", "API REST", "C#", ".NET",
    "Python", "C", "C++", "SQL", "HTML", "CSS", "Docker", "Git", "GitLab", "CI/CD",
  ],
  searches: [
    "Développeur Vue.js",
    "Développeur Java Spring",
    "Développeur React TypeScript",
    "Développeur Node.js",
    "Développeur Full Stack",
    "Développeur .NET",
  ],
  experienceMin: 1,
  experienceMax: 3,
  salaryMinimum: 38000,
  preferredTechs: [
    { name: "Vue.js", weight: 1 },
    { name: "Java", weight: 0.9 },
    { name: "Spring Boot", weight: 0.9 },
    { name: "React", weight: 0.8 },
    { name: "TypeScript", weight: 0.8 },
    { name: "Node.js", weight: 0.7 },
  ],
  scoringWeights: { technical: 0.35, experience: 0.2, contract: 0.15, salary: 0.1, location: 0.1, transport: 0.1 },
  spontaneous: { ...EXAMPLE_PROFILE.spontaneous, romes: ["M1805"] },
};

/** Stockage en mémoire, même comportement que la version Prisma. */
export async function createMemoryStores(opts: { noUser?: boolean } = {}) {
  const users = new Map<string, UserRecord>();
  if (!opts.noUser) users.set("u1", { id: "u1", email: TEST_EMAIL, passwordHash: await hash(TEST_PASSWORD) });
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const profiles = new Map<string, ProfileRecord>([
    ["u1", { profile: structuredClone(DEVELOPER_TEST_PROFILE), home: null, updatedAt: new Date() }],
  ]);

  const jobs = new Map(TEST_JOBS.map((j) => [j.id, structuredClone(j)]));
  const events: Array<{ jobId: string; from: string; to: string; at: Date }> = [];

  let notifSettings: NotificationSettingsRecord = { emailEnabled: true, pushEnabled: true, emailTo: null };
  const pushSubs = new Map<string, PushSubscriptionInput>();

  const sourceRows = new Map(
    ["france-travail", "adzuna"].map((source) => [
      source,
      { source, enabled: source === "france-travail", intervalMinutes: 5, failures: 0, lastSuccessAt: null, nextRunAt: new Date(), lastStatus: null, lastError: null },
    ]),
  );

  const leadRows = new Map<string, LeadRow>();
  const analysisRows = new Map<string, { inputHash: string; model: string; result: unknown; createdAt: Date }>();
  const kitRows = new Map<string, LetterKit>();
  const originals = new Map<string, Pick<JobRow, "description" | "contentHash" | "experienceMinYrs" | "contractType">>();
  const letterRows = new Map<string, StoredLetter>();
  const appRows = new Map<string, StoredApplication>();
  const prefRows = new Map<string, Record<string, Record<string, unknown>>>();
  const stores: Stores = {
    uiPrefs: {
      get: async (userId) => structuredClone(prefRows.get(userId) ?? {}),
      set: async (userId, page, value) => void prefRows.set(userId, { ...(prefRows.get(userId) ?? {}), [page]: structuredClone(value) }),
    },
    applications: {
      get: async (leadId) => appRows.get(leadId) ?? null,
      save: async (leadId, a) => {
        const now = new Date();
        const prev = appRows.get(leadId);
        const row = { ...a, edited: false, sentAt: prev?.sentAt ?? null, sentTo: prev?.sentTo ?? null, createdAt: now, updatedAt: now };
        appRows.set(leadId, row);
        return row;
      },
      edit: async (leadId, letter) => {
        const row = appRows.get(leadId);
        if (!row) return null;
        const next = { ...row, letter, edited: true, updatedAt: new Date() };
        appRows.set(leadId, next);
        return next;
      },
      markSent: async (leadId, to, at) => {
        const row = appRows.get(leadId);
        if (row) appRows.set(leadId, { ...row, sentAt: at, sentTo: to });
      },
    },
    letterKits: {
      get: async (userId) => kitRows.get(userId) ?? null,
      save: async (userId, kit) => (kitRows.set(userId, kit), kit),
    },
    letters: {
      get: async (jobId) => letterRows.get(jobId) ?? null,
      save: async (jobId, l) => {
        const now = new Date();
        const row = { ...l, edited: false, createdAt: now, updatedAt: now };
        letterRows.set(jobId, row);
        return row;
      },
      edit: async (jobId, content) => {
        const row = letterRows.get(jobId);
        if (!row) return null;
        const next = { ...row, content, edited: true, updatedAt: new Date() };
        letterRows.set(jobId, next);
        return next;
      },
    },
    analyses: {
      latest: async (jobId) => analysisRows.get(jobId) ?? null,
      latestAll: async () => new Map(analysisRows),
      save: async (jobId, a) => {
        const row = { inputHash: a.inputHash, model: a.model, result: a.result, createdAt: new Date() };
        analysisRows.set(jobId, row);
        return row;
      },
    },
    leads: {
      list: async () => [...leadRows.values()].sort((a, b) => (b.hiringPotential ?? 0) - (a.hiringPotential ?? 0)),
      upsertMany: async (leads, now) => {
        let created = 0;
        let updated = 0;
        for (const l of leads) {
          const existing = [...leadRows.values()].find((r) => r.siret === l.siret);
          if (existing) {
            Object.assign(existing, l, { lastSeenAt: now });
            updated++;
          } else {
            const id = `l${leadRows.size + 1}`;
            leadRows.set(id, { ...l, id, status: "TO_CONTACT", notes: null, contactEmail: null, address: null, addressCheckedAt: null, contactedAt: null, travelMinutes: null, travelOriginKey: null, firstSeenAt: now, lastSeenAt: now });
            created++;
          }
        }
        return { created, updated };
      },
      update: async (id, data) => {
        const r = leadRows.get(id);
        if (!r) return null;
        Object.assign(r, data);
        return r;
      },
      get: async (id) => leadRows.get(id) ?? null,
      setAddress: async (id, address, at) => {
        const r = leadRows.get(id);
        if (r) Object.assign(r, { address, addressCheckedAt: at });
      },
      setTravel: async (id, minutes, originKey) => {
        const r = leadRows.get(id);
        if (r) Object.assign(r, { travelMinutes: minutes, travelOriginKey: originKey });
      },
      lastRefreshAt: async () => [...leadRows.values()].reduce<Date | null>((a, r) => (!a || r.lastSeenAt > a ? r.lastSeenAt : a), null),
    },
    sources: {
      list: async () => [...sourceRows.values()],
      update: async (source, data) => {
        const row = sourceRows.get(source);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
    },
    notifications: {
      getSettings: async () => notifSettings,
      saveSettings: async (s) => (notifSettings = s),
      subscribe: async (_userId, sub) => void pushSubs.set(sub.endpoint, sub),
      unsubscribe: async (endpoint) => void pushSubs.delete(endpoint),
      countSubscriptions: async () => pushSubs.size,
      recent: async () => [],
    },
    jobs: {
      list: async () => [...jobs.values()],
      get: async (id) => jobs.get(id) ?? null,
      appliedDates: async () => new Map(events.filter((e) => e.to === "APPLIED").reverse().map((e) => [e.jobId, e.at])),
      setStatus: async (id, status) => {
        const j = jobs.get(id);
        if (!j) return null;
        if (j.status !== status) events.push({ jobId: id, from: j.status, to: status, at: new Date() });
        j.status = status;
        return j;
      },
      addManual: async (input) => {
        const n = buildManualJob(input, `m-${jobs.size + 1}`);
        if (!n) return null;
        // Même entreprise + titre + ville qu'une offre existante → rattachée (comme la vraie base).
        const same = [...jobs.values()].find(
          (j) => n.company && j.company === n.company && j.title === n.title && (j.city ?? null) === n.city,
        );
        const target: JobRow =
          same ??
          {
            id: `job-${n.sourceJobId}`,
            contentHash: n.contentHash,
            title: n.title,
            company: n.company,
            description: n.description,
            contractType: n.contractType,
            experienceText: n.experienceText,
            experienceMinYrs: n.experienceMinYrs,
            salaryMin: n.salaryMin,
            salaryMax: n.salaryMax,
            salaryText: n.salaryText,
            city: n.city,
            postalCode: n.postalCode,
            department: n.department,
            address: n.address,
            remoteType: n.remoteType,
            technologies: n.technologies,
            publishedAt: n.publishedAt,
            firstSeenAt: new Date(),
            status: "NEW",
            travelMinutes: null,
            sources: [],
            fullTextAt: null,
          };
        const others = target.sources.map((s) => s.source).filter((s) => s !== "manual");
        target.sources.push({ source: "manual", url: n.sourceUrl });
        if (target.status === "NEW" || target.status === "SEEN") target.status = "SAVED";
        jobs.set(target.id, target);
        return { jobId: target.id, duplicate: Boolean(same), otherSources: [...new Set(others)] };
      },
      removeManual: async (id) => {
        const j = jobs.get(id);
        if (!j) return "not_found";
        if (!j.sources.some((s) => s.source === "manual")) return "not_manual";
        if (j.sources.every((s) => s.source === "manual")) {
          jobs.delete(id);
          return "deleted";
        }
        j.sources = j.sources.filter((s) => s.source !== "manual");
        return "unlinked";
      },
      setFullText: async (id, full) => {
        const j = jobs.get(id);
        if (!j) return null;
        const original = originals.get(id) ?? { description: j.description, contentHash: j.contentHash, experienceMinYrs: j.experienceMinYrs, contractType: j.contractType };
        originals.set(id, original);
        if (full) {
          const at = new Date();
          Object.assign(j, {
            description: full.text,
            contentHash: `${original.contentHash}:full${at.getTime()}`,
            experienceMinYrs: full.experienceYears ?? original.experienceMinYrs,
            contractType: original.contractType ?? full.info?.contractType ?? null,
            fullTextAt: at,
          });
        } else {
          Object.assign(j, { ...original, fullTextAt: null });
        }
        return j;
      },
    },
    users: {
      findByEmail: async (email) => [...users.values()].find((u) => u.email === email) ?? null,
      findById: async (id) => users.get(id) ?? null,
      count: async () => users.size,
      create: async (email, passwordHash) => {
        const u = { id: `u${users.size + 1}`, email, passwordHash };
        users.set(u.id, u);
        return u;
      },
    },
    sessions: {
      create: async ({ id, ...rest }) => void sessions.set(id, rest),
      find: async (id) => sessions.get(id) ?? null,
      delete: async (id) => void sessions.delete(id),
    },
    profiles: {
      get: async (userId) => profiles.get(userId) ?? null,
      save: async (userId, profile: Profile, home: HomeLocation | null | undefined) => {
        const prev = profiles.get(userId);
        const rec: ProfileRecord = {
          profile,
          home: home === undefined ? (prev?.home ?? null) : home,
          updatedAt: new Date(),
        };
        profiles.set(userId, rec);
        return rec;
      },
    },
  };
  return { stores, sessions, profiles, jobs, events, pushSubs, leadRows };
}

/** Faux collecteur : enregistre les demandes, simule « déjà en cours » au 2ᵉ appel. */
export function createFakeCollector() {
  const starts: string[] = [];
  const collector = {
    starts,
    async start(trigger: "manual") {
      starts.push(trigger);
      return { status: starts.length === 1 ? ("started" as const) : ("already_running" as const), runId: "run-1" };
    },
    async status() {
      return {
        running: starts.length > 0,
        lastRun: null,
        sources: [],
        newJobs: 3,
      };
    },
  };
  return collector;
}

export async function createTestApp(opts: { noUser?: boolean } = {}) {
  const mem = await createMemoryStores(opts);
  const collector = createFakeCollector();
  const tests: string[] = [];
  const travelRequests: string[] = [];
  const lbbSearches: unknown[] = [];
  /** Fausse IA : compte les appels, peut simuler Ollama éteint. */
  const aiCalls: Array<{ title: string; skills: string[] }> = [];
  const aiState: { online: boolean; adequation: "forte" | "moyenne" | "faible" } = { online: true, adequation: "forte" };
  const notifiers: Notifier[] = [
    { channel: "email", isConfigured: () => true, sendAlerts: async () => {}, sendTest: async () => void tests.push("email") },
    {
      channel: "webpush",
      isConfigured: () => false,
      sendAlerts: async () => {},
      sendTest: async () => void tests.push("webpush"),
    },
  ];
  /** Faux envoi d'email : garde les messages « envoyés ». */
  const sentMails: OutgoingMail[] = [];
  const mailer: Mailer = { isConfigured: () => true, address: () => "alex.martin@example.com", send: async (m) => void sentMails.push(m) };
  /** Faux .env de la page Réglages (valeurs inventées) et services testés. */
  const settingsValues: Record<string, string | undefined> = { SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", FRANCE_TRAVAIL_CLIENT_ID: "PAR_app_test_0123456789abcdef" };
  const settingsTests: string[] = [];
  const settings: SettingsService = {
    values: () => ({ ...settingsValues }),
    save: async (updates) => {
      for (const [k, v] of Object.entries(updates)) settingsValues[k] = v || undefined;
    },
    test: async (service) => (settingsTests.push(service), { ok: true, message: `${service} répond` }),
  };
  const app = await buildApp({
    mailer,
    settings,
    stores: mem.stores,
    appUrl: APP_URL,
    secureCookie: false,
    collector,
    notifiers,
    vapidPublicKey: "BTestPublicKey",
    ai: {
      model: "fake-model",
      status: async () =>
        aiState.online ? { available: true, model: "fake-model", installed: true } : { available: false, model: "fake-model", message: "Ollama ne répond pas" },
      readJob: async (text, hints) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: `lecture:${text.slice(0, 20)}`, skills: [] });
        return {
          model: "fake-model",
          durationMs: 4,
          fields: {
            title: hints?.title ?? "Développeur Vue.js",
            company: hints?.company ?? "Acme",
            location: "Paris (75)",
            address: null,
            contractType: "CDI",
            remoteType: "hybrid",
            salaryMin: null,
            salaryMax: null,
            experienceYears: 1,
            skills: ["Vue.js"],
          },
        };
      },
      readCv: async (cvText) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: `cv:${cvText.slice(0, 20)}`, skills: [] });
        return {
          model: "fake-model",
          durationMs: 6,
          proposal: {
            fullName: "Camille Martin",
            email: "camille.martin@example.com",
            phone: null,
            city: "Lyon",
            postalCode: "69003",
            department: "69",
            job: "Assistante comptable",
            searches: ["Assistant comptable", "Comptable"],
            skills: ["Sage", "Excel"],
            yearsOfExperience: 3,
            contracts: ["CDI"],
          },
        };
      },
      writeLetter: async (job, kit, opts) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: `lettre:${job.title}`, skills: [] });
        if (opts?.spontaneous) {
          return { model: "fake-model", durationMs: 7, content: `${kit.header}\n\nObjet : Candidature spontanée – ${job.title}\n\nChez Nordia, j'ai développé des écrans en Vue.js pour ${job.company}.` };
        }
        return { model: "fake-model", durationMs: 7, content: `${kit.header}\n\nObjet : Candidature au poste de ${job.title}\n\nJe maîtrise Kafka.` };
      },
      analyze: async (job, profile) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: job.title, skills: profile.skills });
        return {
          model: "fake-model",
          durationMs: 5,
          result: {
            resume: `Résumé de ${job.title}`,
            missions: ["Développer"],
            competences_obligatoires: ["Vue.js"],
            competences_bonus: ["Docker"],
            niveau: "junior",
            experience_min_ans: 2,
            employeur: "direct",
            points_attention: [],
            adequation: aiState.adequation,
            avis: "Ça colle.",
          },
        };
      },
    },
    sourcesConfigured: { "france-travail": true, adzuna: false },
    findAddress: async (siret: string) => (siret === "11111111100011" ? "12 RUE DE LA GARE 69200 VENISSIEUX" : null),
    searchCompanies: async (p) => {
      lbbSearches.push(p);
      return [
        { siret: "11111111100011", company_name: "ALPHA LOGICIELS", office_name: "", email: "yes", naf: "6201Z", naf_label: "Programmation informatique",
          headcount_min: 10, headcount_max: 19, location: { lat: 45.61, lon: 4.89 }, city: "Vénissieux", postcode: "69200", department_number: "69",
          hiring_potential: 61.23, is_high_potential: true },
        { siret: "22222222200022", company_name: "BETA SERVICES", office_name: "", email: "no", naf: "6202B", naf_label: "Tierce maintenance",
          headcount_min: 0, headcount_max: 0, location: { lat: 45.65, lon: 4.72 }, city: "Écully", postcode: "69130", department_number: "69",
          hiring_potential: 7.9, is_high_potential: false },
      ];
    },
    ensureTravel: async (jobId: string) => {
      travelRequests.push(jobId);
      if (jobId === "j-java") throw new Error("quota PRIM atteint");
      const j = mem.jobs.get(jobId);
      if (j) j.travelMinutes = 42;
      return null;
    },
    geocoder: async (q: string) =>
      q.includes("introuvable") ? [] : [{ label: "Place de la Gare 69100 Villeurbanne", lat: 45.7714, lng: 5.2467, precision: "address" }],
  });
  return { app, collector, tests, travelRequests, lbbSearches, aiCalls, aiState, sentMails, settingsValues, settingsTests, ...mem };
}

export async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const cookie = res.cookies.find((c) => c.name === "jr_session");
  if (!cookie) throw new Error(`login échoué : ${res.statusCode} ${res.body}`);
  return { jr_session: cookie.value };
}
