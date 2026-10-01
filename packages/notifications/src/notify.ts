import type { PrismaClient } from "@job-radar/db";
import { DEFAULT_RULES, type ScorableJob, type ScoringRules, scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import type { Profile } from "@job-radar/shared";
import { REMOTE_LABEL, salaryLabel } from "./format";
import type { Channel, JobAlert, Notifier } from "./types";

export type CandidateJob = ScorableJob & {
  id: string;
  company: string | null;
  city: string | null;
};

export type NotificationSettingsLite = { emailEnabled: boolean; pushEnabled: boolean };

/** Accès base pour les notifications (interface → testable sans PostgreSQL). */
export interface NotifyRepo {
  settings(): Promise<NotificationSettingsLite>;
  /** Offres jamais notifiées, apparues depuis `since`. */
  candidates(since: Date): Promise<CandidateJob[]>;
  /** Réserve (offre, canal). false si déjà fait → anti-double notification. */
  claim(jobId: string, channel: Channel): Promise<boolean>;
  finish(jobId: string, channel: Channel, status: "sent" | "failed", error?: string): Promise<void>;
  markNotified(jobIds: string[]): Promise<void>;
}

export type NotifyResult = { candidates: number; matched: number; sent: Partial<Record<Channel, number>>; errors: string[] };

function toAlert(job: CandidateJob, score: ReturnType<typeof scoreJob>, appUrl: string): JobAlert {
  return {
    jobId: job.id,
    title: job.title,
    company: job.company,
    place: [job.city, job.department ? `(${job.department})` : null].filter(Boolean).join(" ") || null,
    score: score.final,
    contract: job.contractType,
    salary: salaryLabel(job.salaryMin, job.salaryMax),
    remote: REMOTE_LABEL[job.remoteType] ?? null,
    skills: score.matchedSkills,
    missing: score.missingSkills,
    url: new URL(`/offres/${encodeURIComponent(job.id)}`, appUrl).href,
  };
}

/**
 * Après une collecte : annonce les NOUVELLES offres au-dessus du seuil du profil.
 * Une offre retrouvée plus tard ne redéclenche rien (README §11) : table Notification unique (offre, canal) + Job.notifiedAt.
 */
export async function notifyNewMatches(opts: {
  repo: NotifyRepo;
  notifiers: Notifier[];
  profile: Profile;
  since: Date;
  appUrl: string;
  rules?: ScoringRules;
  log?: (msg: string) => void;
}): Promise<NotifyResult> {
  const { repo, profile, log = () => {} } = opts;
  const settings = await repo.settings();
  const active = opts.notifiers.filter(
    (n) => n.isConfigured() && (n.channel === "email" ? settings.emailEnabled : settings.pushEnabled),
  );
  const result: NotifyResult = { candidates: 0, matched: 0, sent: {}, errors: [] };
  if (active.length === 0) return result;

  const candidates = await repo.candidates(opts.since);
  result.candidates = candidates.length;
  const matches = candidates
    .map((job) => ({ job, score: scoreJob(scoringInputFromJob(job), profile, opts.rules ?? DEFAULT_RULES) }))
    .filter(({ score }) => !score.hidden && score.final >= profile.minScoreForNotification)
    .sort((a, b) => b.score.final - a.score.final);
  result.matched = matches.length;
  if (matches.length === 0) return result;

  for (const notifier of active) {
    const claimed = [];
    for (const m of matches) if (await repo.claim(m.job.id, notifier.channel)) claimed.push(m);
    if (claimed.length === 0) continue;
    try {
      await notifier.sendAlerts(claimed.map((m) => toAlert(m.job, m.score, opts.appUrl)));
      for (const m of claimed) await repo.finish(m.job.id, notifier.channel, "sent");
      result.sent[notifier.channel] = claimed.length;
      log(`Notification ${notifier.channel} : ${claimed.length} offre(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const m of claimed) await repo.finish(m.job.id, notifier.channel, "failed", msg);
      result.errors.push(`${notifier.channel} : ${msg}`);
      log(`Notification ${notifier.channel} en échec : ${msg}`);
    }
  }
  await repo.markNotified(matches.map((m) => m.job.id));
  return result;
}

export function createPrismaNotifyRepo(prisma: PrismaClient): NotifyRepo {
  return {
    async settings() {
      const s = await prisma.notificationSettings.findUnique({ where: { id: "singleton" } });
      return { emailEnabled: s?.emailEnabled ?? true, pushEnabled: s?.pushEnabled ?? true };
    },
    async candidates(since) {
      const rows = await prisma.job.findMany({
        where: { firstSeenAt: { gte: since }, notifiedAt: null, status: "NEW" },
        select: {
          id: true,
          title: true,
          company: true,
          city: true,
          description: true,
          technologies: true,
          contractType: true,
          experienceMinYrs: true,
          salaryMin: true,
          salaryMax: true,
          department: true,
          remoteType: true,
          travel: { select: { minutes: true } },
        },
      });
      return rows.map(({ travel, ...j }) => ({ ...j, travelMinutes: travel?.minutes ?? null }));
    },
    async claim(jobId, channel) {
      try {
        await prisma.notification.create({ data: { jobId, channel, status: "pending" } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") return false; // déjà notifiée sur ce canal
        throw err;
      }
    },
    async finish(jobId, channel, status, error) {
      await prisma.notification.update({
        where: { jobId_channel: { jobId, channel } },
        data: { status, error: error?.slice(0, 1000) ?? null },
      });
    },
    async markNotified(jobIds) {
      if (!jobIds.length) return;
      const now = new Date();
      await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: { notifiedAt: now } });
      await prisma.jobEvent.createMany({ data: jobIds.map((jobId) => ({ jobId, type: "NOTIFIED" })) });
    },
  };
}
