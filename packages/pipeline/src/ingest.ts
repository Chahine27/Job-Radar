import type { Prisma, PrismaClient } from "@job-radar/db";
import { type NormalizedJob, dedupeKeyOf, sameOffer, urlKey } from "@job-radar/job-normalizer";

export type IngestOutcome = "created" | "updated" | "unchanged" | "duplicate";

function jobFields(n: NormalizedJob) {
  return {
    contentHash: n.contentHash,
    dedupeKey: dedupeKeyOf(n.company, n.title),
    title: n.title,
    company: n.company,
    description: n.description,
    contractType: n.contractType,
    experienceText: n.experienceText,
    experienceMinYrs: n.experienceMinYrs,
    experienceMaxYrs: n.experienceMaxYrs,
    salaryMin: n.salaryMin,
    salaryMax: n.salaryMax,
    salaryPeriod: n.salaryPeriod,
    salaryText: n.salaryText,
    city: n.city,
    postalCode: n.postalCode,
    department: n.department,
    address: n.address,
    latitude: n.latitude,
    longitude: n.longitude,
    locationPrecision: n.locationPrecision,
    remoteType: n.remoteType,
    technologies: n.technologies,
    publishedAt: n.publishedAt,
  };
}

const json = (v: unknown) => (v ?? undefined) as Prisma.InputJsonValue | undefined;

/**
 * Enregistre une offre normalisée en évitant les doublons (README §10) :
 *  1. même source + même identifiant → mise à jour de l'offre existante ;
 *  2. même lien d'annonce (clé d'URL), même empreinte (entreprise + titre + ville), ou même offre écrite autrement
 *     (« … - CDD (H/F) » / « … - CDD », « Paris » / « 8ème Arrondissement », cf. sameOffer)
 *     → la source est rattachée à l'offre existante ;
 *  3. sinon → nouvelle offre.
 * Une description vide ne remplace jamais une description existante ; une offre sans description est complétée
 * par le doublon qui en apporte une. Le statut et les corrections faites à la main ne sont jamais touchés.
 */
export async function ingestJob(prisma: PrismaClient, n: NormalizedJob, now = new Date()): Promise<IngestOutcome> {
  const link = await prisma.jobSourceLink.findUnique({
    where: { source_sourceJobId: { source: n.source, sourceJobId: n.sourceJobId } },
    select: { id: true, jobId: true, job: { select: { contentHash: true, description: true } } },
  });
  // Lien de l'annonce elle-même (pas le lien partenaire de France Travail : il peut être commun à plusieurs offres).
  const key = urlKey(n.sourceUrl);
  const lostDescription = (old: string) => !n.description.trim() && old.trim() !== "";

  if (link) {
    // Détail non récupéré cette fois (page vide) : on garde ce qu'on avait.
    const changed = link.job.contentHash !== n.contentHash && !lostDescription(link.job.description);
    await prisma.$transaction([
      prisma.jobSourceLink.update({
        where: { id: link.id },
        data: { lastSeenAt: now, sourceUrl: n.sourceUrl, canonicalUrl: key, rawData: json(n.rawData) },
      }),
      prisma.job.update({
        where: { id: link.jobId },
        data: changed ? { ...jobFields(n), lastSeenAt: now } : { lastSeenAt: now },
      }),
      ...(changed
        ? [prisma.jobEvent.create({ data: { jobId: link.jobId, type: "UPDATED", toValue: n.contentHash } })]
        : []),
    ]);
    return changed ? "updated" : "unchanged";
  }

  const sourceLink = {
    source: n.source,
    sourceJobId: n.sourceJobId,
    sourceUrl: n.sourceUrl,
    canonicalUrl: key,
    rawData: json(n.rawData),
    firstSeenAt: now,
    lastSeenAt: now,
  };

  const byUrl = key ? await prisma.jobSourceLink.findFirst({ where: { canonicalUrl: key }, select: { jobId: true } }) : null;
  let same: { id: string; description: string } | null = await prisma.job.findUnique({
    where: byUrl ? { id: byUrl.jobId } : { fingerprint: n.fingerprint },
    select: { id: true, description: true },
  });
  // Même offre écrite autrement par une autre source (titre, contrat, lieu) : rattachée à l'offre connue.
  const dedupeKey = dedupeKeyOf(n.company, n.title);
  if (!same && dedupeKey) {
    const candidates = await prisma.job.findMany({
      where: { dedupeKey },
      select: { id: true, description: true, title: true, city: true, department: true },
      orderBy: { firstSeenAt: "asc" },
    });
    same = candidates.find((c) => sameOffer(c, n)) ?? null;
  }
  if (same) {
    // L'offre connue n'avait pas de description : celle du doublon la complète (score et IA sur le vrai texte).
    const fill = !same.description.trim() && n.description.trim() !== "";
    await prisma.$transaction([
      prisma.jobSourceLink.create({ data: { ...sourceLink, jobId: same.id } }),
      prisma.job.update({ where: { id: same.id }, data: fill ? { ...jobFields(n), lastSeenAt: now } : { lastSeenAt: now } }),
      prisma.jobEvent.create({ data: { jobId: same.id, type: "SOURCE_ADDED", toValue: n.source } }),
    ]);
    return "duplicate";
  }

  await prisma.job.create({
    data: {
      ...jobFields(n),
      fingerprint: n.fingerprint,
      firstSeenAt: now,
      lastSeenAt: now,
      sources: { create: sourceLink },
      events: { create: { type: "CREATED", toValue: n.source } },
    },
  });
  return "created";
}
