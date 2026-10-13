import type { PrismaClient } from "@job-radar/db";

/**
 * Offres expirées (plus en ligne). On ne devine pas : chaque source a sa règle.
 *  - France Travail : l'offre n'a pas été revue depuis 7 jours → on DEMANDE à France Travail si elle existe encore.
 *  - Sites carrières : chaque collecte récupère toutes les offres de l'entreprise → absente depuis 2 jours = retirée.
 *  - Adzuna, Jooble, HelloWork, WTTJ, Indeed : pas de vérification possible → publiée (ou vue la 1ʳᵉ fois) il y a plus de 45 jours.
 *  - Démo : jamais.
 * Une offre trouvée sur plusieurs sources n'expire que si TOUTES ses sources la donnent retirée.
 * Seules les offres « Nouvelle » / « Vue » passent en « Expirée » : sauvegardées et postulées ne bougent pas.
 */
export const EXPIRY = { ftUnseenDays: 7, careersUnseenDays: 2, adzunaMaxAgeDays: 45, maxFtChecks: 40 };

export type LinkInfo = { source: string; sourceJobId: string; lastSeenAt: Date };
export type ExpiryVerdict = "gone" | "online" | "unknown";

const DAY = 86_400_000;

/** Verdict pour une source d'une offre (fonction pure, testée). `ftOnline` : réponse de France Travail si demandée. */
export function linkVerdict(
  link: LinkInfo,
  job: { publishedAt: Date | null; firstSeenAt: Date },
  now: Date,
  ftOnline?: boolean | null,
): ExpiryVerdict {
  const unseenDays = (now.getTime() - link.lastSeenAt.getTime()) / DAY;
  switch (link.source) {
    case "france-travail":
      if (unseenDays < EXPIRY.ftUnseenDays) return "online";
      return ftOnline === false ? "gone" : ftOnline === true ? "online" : "unknown";
    // Sites carrières : chaque collecte relit toutes les offres de l'entreprise, une absente est retirée.
    case "company-careers":
      return unseenDays >= EXPIRY.careersUnseenDays ? "gone" : "online";
    case "adzuna":
    case "jooble":
    // Sites scrapés sur les dernières 24 h : une offre n'y est plus revue après sa 1ʳᵉ journée, l'absence ne dit rien.
    case "jobscraper:hellowork":
    case "jobscraper:wttj":
    case "jobscraper:indeed": {
      const ageDays = (now.getTime() - (job.publishedAt ?? job.firstSeenAt).getTime()) / DAY;
      return ageDays > EXPIRY.adzunaMaxAgeDays && unseenDays >= 1 ? "gone" : "online";
    }
    default:
      return "online";
  }
}

export type ExpiryReport = { checked: number; expired: number; ftChecks: number };

export async function expireJobs(opts: {
  prisma: PrismaClient;
  /** Vérification France Travail (FranceTravailSource.isStillOnline). */
  ftIsOnline?: (id: string) => Promise<boolean | null>;
  now?: Date;
  log?: (m: string) => void;
}): Promise<ExpiryReport> {
  const { prisma, log = () => {} } = opts;
  const now = opts.now ?? new Date();
  const report: ExpiryReport = { checked: 0, expired: 0, ftChecks: 0 };

  // Candidates : pas revues depuis au moins 1 jour.
  const jobs = await prisma.job.findMany({
    where: { status: { in: ["NEW", "SEEN"] }, lastSeenAt: { lt: new Date(now.getTime() - DAY) } },
    select: {
      id: true,
      publishedAt: true,
      firstSeenAt: true,
      sources: { select: { source: true, sourceJobId: true, lastSeenAt: true } },
    },
    orderBy: { lastSeenAt: "asc" },
    take: 500,
  });

  for (const job of jobs) {
    report.checked++;
    const verdicts: ExpiryVerdict[] = [];
    for (const link of job.sources) {
      let ftOnline: boolean | null | undefined;
      const needsFt =
        link.source === "france-travail" &&
        (now.getTime() - link.lastSeenAt.getTime()) / DAY >= EXPIRY.ftUnseenDays &&
        opts.ftIsOnline &&
        report.ftChecks < EXPIRY.maxFtChecks;
      if (needsFt) {
        report.ftChecks++;
        ftOnline = await opts.ftIsOnline!(link.sourceJobId);
        // Encore en ligne : on la note « revue » pour ne pas redemander avant 7 jours.
        if (ftOnline === true) {
          await prisma.jobSourceLink.updateMany({ where: { source: link.source, sourceJobId: link.sourceJobId }, data: { lastSeenAt: now } });
        }
      }
      verdicts.push(linkVerdict(link, job, now, ftOnline));
    }
    if (verdicts.length > 0 && verdicts.every((v) => v === "gone")) {
      await prisma.$transaction([
        prisma.job.update({ where: { id: job.id }, data: { status: "EXPIRED" } }),
        prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "EXPIRED", fromValue: "auto" } }),
      ]);
      report.expired++;
    }
  }
  if (report.expired) log(`Offres expirées : ${report.expired} (sur ${report.checked} vérifiées)`);
  return report;
}
