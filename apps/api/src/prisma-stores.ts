import { Prisma, type PrismaClient } from "@job-radar/db";
import { buildManualJob, removeManualJob, saveManualJob } from "@job-radar/pipeline";
import { LetterKitSchema, ProfileSchema } from "@job-radar/shared";
import type { FullTextInfo, HomeLocation, JobRow, ProfileRecord, Stores } from "./stores";

const jobInclude = {
  sources: { select: { source: true, sourceUrl: true } },
  travel: { select: { minutes: true } },
} as const;

type JobWithRelations = Omit<JobRow, "sources" | "travelMinutes"> & {
  sources: Array<{ source: string; sourceUrl: string }>;
  travel: { minutes: number | null } | null;
  fullText: string | null;
  fullExperienceYrs: number | null;
  fullInfo: unknown;
};

function toJobRow(j: JobWithRelations): JobRow {
  const { sources, travel, fullText, fullExperienceYrs, fullInfo, ...rest } = j;
  const row: JobRow = {
    ...rest,
    sources: sources.map((s) => ({ source: s.source, url: s.sourceUrl })),
    travelMinutes: travel?.minutes ?? null,
  };
  if (fullText && j.fullTextAt) {
    // Annonce complète collée : elle remplace l'extrait (score et IA recalculés grâce au contentHash).
    row.description = fullText;
    row.contentHash = `${j.contentHash}:full${j.fullTextAt.getTime()}`;
    if (fullExperienceYrs !== null) {
      row.experienceMinYrs = fullExperienceYrs;
      row.experienceText = `${fullExperienceYrs} an${fullExperienceYrs > 1 ? "s" : ""} minimum`;
    }
    // Ce que la source ne donnait pas (contrat, télétravail, salaire), lu par l'IA dans l'annonce complète.
    const info = (fullInfo && typeof fullInfo === "object" ? fullInfo : {}) as FullTextInfo;
    if (!row.contractType && info.contractType) row.contractType = info.contractType;
    if (row.remoteType === "unknown" && info.remoteType && info.remoteType !== "unknown") row.remoteType = info.remoteType;
    if (row.salaryMin === null && row.salaryMax === null && info.salaryMin) {
      row.salaryMin = info.salaryMin;
      row.salaryMax = info.salaryMax ?? info.salaryMin;
    }
  }
  return row;
}

const jobSelect = {
  id: true,
  contentHash: true,
  title: true,
  company: true,
  description: true,
  contractType: true,
  experienceText: true,
  experienceMinYrs: true,
  salaryMin: true,
  salaryMax: true,
  salaryText: true,
  city: true,
  postalCode: true,
  department: true,
  address: true,
  remoteType: true,
  technologies: true,
  publishedAt: true,
  firstSeenAt: true,
  status: true,
  fullText: true,
  fullTextAt: true,
  fullExperienceYrs: true,
  fullInfo: true,
  ...jobInclude,
} as const;

type ProfileRow = {
  data: unknown;
  homeLabel: string | null;
  homeLat: number | null;
  homeLng: number | null;
  updatedAt: Date;
};

function toRecord(row: ProfileRow): ProfileRecord {
  const home =
    row.homeLabel !== null && row.homeLat !== null && row.homeLng !== null
      ? { label: row.homeLabel, lat: row.homeLat, lng: row.homeLng }
      : null;
  // Le JSON en base est revalidé : une donnée corrompue provoque une erreur claire.
  return { profile: ProfileSchema.parse(row.data), home, updatedAt: row.updatedAt };
}

function homeColumns(home: HomeLocation | null | undefined) {
  if (home === undefined) return {}; // non fourni → on ne touche pas
  if (home === null) return { homeLabel: null, homeLat: null, homeLng: null };
  return { homeLabel: home.label, homeLat: home.lat, homeLng: home.lng };
}

const APP_SELECT = { inputHash: true, model: true, letter: true, edited: true, sentAt: true, sentTo: true, createdAt: true, updatedAt: true } as const;

export function createPrismaStores(prisma: PrismaClient): Stores {
  return {
    analyses: {
      async latest(jobId) {
        const row = await prisma.jobAnalysis.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
        if (!row) return null;
        let result: unknown = null;
        try {
          result = JSON.parse(row.summary);
        } catch {
          return null;
        }
        return { inputHash: row.inputHash, model: row.model, result, createdAt: row.createdAt };
      },
      async latestAll() {
        const rows = await prisma.jobAnalysis.findMany({ orderBy: { createdAt: "desc" }, distinct: ["jobId"] });
        const map = new Map<string, { inputHash: string; model: string; result: unknown; createdAt: Date }>();
        for (const row of rows) {
          try {
            map.set(row.jobId, { inputHash: row.inputHash, model: row.model, result: JSON.parse(row.summary), createdAt: row.createdAt });
          } catch {
            // analyse illisible : ignorée
          }
        }
        return map;
      },
      async save(jobId, a) {
        // Colonne summary = réponse complète (JSON) ; les listes sont aussi rangées dans leurs colonnes.
        const data = {
          model: a.model,
          summary: JSON.stringify(a.result),
          matchedSkills: a.lists.required,
          missingSkills: a.lists.bonus,
          risks: a.lists.risks,
        };
        const row = await prisma.jobAnalysis.upsert({
          where: { jobId_inputHash: { jobId, inputHash: a.inputHash } },
          create: { jobId, inputHash: a.inputHash, ...data },
          update: { ...data, createdAt: new Date() },
        });
        return { inputHash: row.inputHash, model: row.model, result: a.result, createdAt: row.createdAt };
      },
    },
    letterKits: {
      async get(userId) {
        const row = await prisma.letterKit.findUnique({ where: { userId } });
        if (!row) return null;
        const parsed = LetterKitSchema.safeParse(row.data);
        return parsed.success ? parsed.data : null;
      },
      async save(userId, kit) {
        await prisma.letterKit.upsert({ where: { userId }, create: { userId, data: kit }, update: { data: kit } });
        return kit;
      },
    },
    letters: {
      get: (jobId) =>
        prisma.coverLetter.findUnique({
          where: { jobId },
          select: { inputHash: true, model: true, content: true, edited: true, createdAt: true, updatedAt: true },
        }),
      async save(jobId, l) {
        const data = { inputHash: l.inputHash, model: l.model, content: l.content, edited: false };
        return prisma.coverLetter.upsert({
          where: { jobId },
          create: { jobId, ...data },
          update: { ...data, createdAt: new Date() },
          select: { inputHash: true, model: true, content: true, edited: true, createdAt: true, updatedAt: true },
        });
      },
      async edit(jobId, content) {
        const r = await prisma.coverLetter.updateMany({ where: { jobId }, data: { content, edited: true } });
        if (r.count === 0) return null;
        return prisma.coverLetter.findUnique({
          where: { jobId },
          select: { inputHash: true, model: true, content: true, edited: true, createdAt: true, updatedAt: true },
        });
      },
    },
    uiPrefs: {
      async get(userId) {
        const row = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
        const v = row?.uiPrefs;
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Record<string, unknown>>) : {};
      },
      async set(userId, page, value) {
        // Lecture + écriture : une seule personne utilise l'appli, pas de conflit à gérer.
        const current = await this.get(userId);
        await prisma.user.update({ where: { id: userId }, data: { uiPrefs: { ...current, [page]: value } as Prisma.InputJsonObject } });
      },
    },
    applications: {
      get: (leadId) => prisma.spontaneousApplication.findUnique({ where: { leadId }, select: APP_SELECT }),
      save: (leadId, a) =>
        prisma.spontaneousApplication.upsert({
          where: { leadId },
          create: { leadId, ...a, edited: false },
          update: { ...a, edited: false, createdAt: new Date() },
          select: APP_SELECT,
        }),
      async edit(leadId, letter) {
        const r = await prisma.spontaneousApplication.updateMany({ where: { leadId }, data: { letter, edited: true } });
        if (r.count === 0) return null;
        return prisma.spontaneousApplication.findUnique({ where: { leadId }, select: APP_SELECT });
      },
      async markSent(leadId, to, at) {
        await prisma.spontaneousApplication.update({ where: { leadId }, data: { sentAt: at, sentTo: to } });
      },
    },
    leads: {
      list: () => prisma.companyLead.findMany({ orderBy: [{ hiringPotential: "desc" }, { name: "asc" }] }),
      async upsertMany(leads, now) {
        let created = 0;
        let updated = 0;
        for (const l of leads) {
          const exists = await prisma.companyLead.findUnique({ where: { siret: l.siret }, select: { id: true } });
          if (exists) {
            await prisma.companyLead.update({ where: { siret: l.siret }, data: { ...l, lastSeenAt: now } });
            updated++;
          } else {
            await prisma.companyLead.create({ data: { ...l, firstSeenAt: now, lastSeenAt: now } });
            created++;
          }
        }
        return { created, updated };
      },
      async update(id, data) {
        const current = await prisma.companyLead.findUnique({ where: { id }, select: { contactedAt: true } });
        if (!current) return null;
        const contacted = data.status === "CONTACTED" || data.status === "FOLLOWED_UP";
        return prisma.companyLead.update({
          where: { id },
          data: { ...data, ...(contacted && !current.contactedAt ? { contactedAt: new Date() } : {}) },
        });
      },
      get: (id) => prisma.companyLead.findUnique({ where: { id } }),
      async setAddress(id, address, at) {
        await prisma.companyLead.update({ where: { id }, data: { address, addressCheckedAt: at } });
      },
      async setTravel(id, minutes, originKey) {
        await prisma.companyLead.update({ where: { id }, data: { travelMinutes: minutes, travelOriginKey: originKey } });
      },
      async lastRefreshAt() {
        return (await prisma.companyLead.aggregate({ _max: { lastSeenAt: true } }))._max.lastSeenAt;
      },
    },
    sources: {
      async list() {
        const states = await prisma.sourceState.findMany({ orderBy: { source: "asc" } });
        const last = await Promise.all(
          states.map((st) =>
            prisma.sourceRun.findFirst({ where: { source: st.source }, orderBy: { createdAt: "desc" }, select: { status: true, error: true } }),
          ),
        );
        return states.map((st, i) => ({ ...st, lastStatus: last[i]?.status ?? null, lastError: last[i]?.error ?? null }));
      },
      async update(source, data) {
        const exists = await prisma.sourceState.findUnique({ where: { source } });
        if (!exists) return null;
        await prisma.sourceState.update({
          where: { source },
          // Activer une source la rend « due » tout de suite.
          data: { ...data, ...(data.enabled && !exists.enabled ? { nextRunAt: new Date(), failures: 0 } : {}) },
        });
        return (await this.list()).find((r) => r.source === source) ?? null;
      },
    },
    companies: {
      list: () => prisma.companyTarget.findMany({ orderBy: { name: "asc" } }),
      async add(data) {
        try {
          return await prisma.companyTarget.create({ data });
        } catch (err) {
          if ((err as { code?: string }).code === "P2002") return null;
          throw err;
        }
      },
      async setEnabled(id, enabled) {
        const r = await prisma.companyTarget.updateMany({ where: { id }, data: { enabled } });
        return r.count ? prisma.companyTarget.findUnique({ where: { id } }) : null;
      },
      async remove(id) {
        return (await prisma.companyTarget.deleteMany({ where: { id } })).count > 0;
      },
    },
    notifications: {
      async getSettings() {
        const row = await prisma.notificationSettings.findUnique({ where: { id: "singleton" } });
        return {
          emailEnabled: row?.emailEnabled ?? true,
          pushEnabled: row?.pushEnabled ?? true,
          emailTo: row?.emailTo ?? null,
        };
      },
      async saveSettings(s) {
        const row = await prisma.notificationSettings.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", ...s },
          update: s,
        });
        return { emailEnabled: row.emailEnabled, pushEnabled: row.pushEnabled, emailTo: row.emailTo };
      },
      async subscribe(userId, sub) {
        await prisma.pushSubscription.upsert({
          where: { endpoint: sub.endpoint },
          create: { userId, endpoint: sub.endpoint, keys: sub.keys },
          update: { userId, keys: sub.keys },
        });
      },
      async unsubscribe(endpoint) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint } });
      },
      countSubscriptions: () => prisma.pushSubscription.count(),
      async recent(limit) {
        const rows = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: limit });
        const titles = new Map(
          (await prisma.job.findMany({ where: { id: { in: rows.map((r) => r.jobId) } }, select: { id: true, title: true } })).map(
            (j) => [j.id, j.title],
          ),
        );
        return rows.map((r) => ({ ...r, jobTitle: titles.get(r.jobId) ?? null }));
      },
    },
    users: {
      findByEmail: (email) =>
        prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, passwordHash: true },
        }),
      findById: (id) =>
        prisma.user.findUnique({
          where: { id },
          select: { id: true, email: true, passwordHash: true },
        }),
      count: () => prisma.user.count(),
      create: (email, passwordHash) =>
        prisma.user.create({ data: { email, passwordHash }, select: { id: true, email: true, passwordHash: true } }),
    },
    sessions: {
      async create(input) {
        await prisma.session.create({ data: input });
      },
      find: (id) =>
        prisma.session.findUnique({ where: { id }, select: { userId: true, expiresAt: true } }),
      async delete(id) {
        await prisma.session.deleteMany({ where: { id } });
      },
    },
    profiles: {
      async get(userId) {
        const row = await prisma.profile.findUnique({ where: { userId } });
        return row ? toRecord(row) : null;
      },
      async save(userId, profile, home) {
        const row = await prisma.profile.upsert({
          where: { userId },
          update: { data: profile, ...homeColumns(home) },
          create: { userId, data: profile, ...homeColumns(home) },
        });
        return toRecord(row);
      },
    },
    jobs: {
      async list() {
        const rows = await prisma.job.findMany({ select: jobSelect, orderBy: { firstSeenAt: "desc" } });
        return rows.map(toJobRow);
      },
      async get(id) {
        const row = await prisma.job.findUnique({ where: { id }, select: jobSelect });
        return row ? toJobRow(row) : null;
      },
      async appliedDates() {
        const rows = await prisma.jobEvent.findMany({
          where: { type: "STATUS_CHANGED", toValue: "APPLIED" },
          orderBy: { createdAt: "asc" }, // la PREMIÈRE fois : c'est la date de candidature
          distinct: ["jobId"],
          select: { jobId: true, createdAt: true },
        });
        return new Map(rows.map((r) => [r.jobId, r.createdAt]));
      },
      async setStatus(id, status) {
        return prisma.$transaction(async (tx) => {
          const current = await tx.job.findUnique({ where: { id }, select: { status: true } });
          if (!current) return null;
          if (current.status !== status) {
            await tx.job.update({ where: { id }, data: { status } });
            await tx.jobEvent.create({
              data: { jobId: id, type: "STATUS_CHANGED", fromValue: current.status, toValue: status },
            });
          }
          const row = await tx.job.findUniqueOrThrow({ where: { id }, select: jobSelect });
          return toJobRow(row);
        });
      },
      async addManual(input) {
        const n = buildManualJob(input);
        return n ? saveManualJob(prisma, n) : null;
      },
      removeManual: (id) => removeManualJob(prisma, id),
      async setFullText(id, full) {
        const r = await prisma.job.updateMany({
          where: { id },
          data: full
            ? {
                fullText: full.text,
                fullTextAt: new Date(),
                fullExperienceYrs: full.experienceYears,
                fullInfo: full.info ? (full.info as object) : Prisma.DbNull,
              }
            : { fullText: null, fullTextAt: null, fullExperienceYrs: null, fullInfo: Prisma.DbNull },
        });
        if (r.count === 0) return null;
        const row = await prisma.job.findUnique({ where: { id }, select: jobSelect });
        return row ? toJobRow(row) : null;
      },
    },
  };
}
