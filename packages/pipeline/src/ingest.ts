import type { Prisma, PrismaClient } from "@job-radar/db";
import type { NormalizedJob } from "@job-radar/job-normalizer";

export type IngestOutcome = "created" | "updated" | "unchanged" | "duplicate";

function jobFields(n: NormalizedJob) {
  return {
    contentHash: n.contentHash,
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
 *  2. même empreinte (entreprise + titre + ville) → la source est rattachée à l'offre existante ;
 *  3. sinon → nouvelle offre.
 */
export async function ingestJob(prisma: PrismaClient, n: NormalizedJob, now = new Date()): Promise<IngestOutcome> {
  const link = await prisma.jobSourceLink.findUnique({
    where: { source_sourceJobId: { source: n.source, sourceJobId: n.sourceJobId } },
    select: { id: true, jobId: true, job: { select: { contentHash: true } } },
  });

  if (link) {
    const changed = link.job.contentHash !== n.contentHash;
    await prisma.$transaction([
      prisma.jobSourceLink.update({
        where: { id: link.id },
        data: { lastSeenAt: now, sourceUrl: n.sourceUrl, canonicalUrl: n.canonicalUrl, rawData: json(n.rawData) },
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
    canonicalUrl: n.canonicalUrl,
    rawData: json(n.rawData),
    firstSeenAt: now,
    lastSeenAt: now,
  };

  const same = await prisma.job.findUnique({ where: { fingerprint: n.fingerprint }, select: { id: true } });
  if (same) {
    await prisma.$transaction([
      prisma.jobSourceLink.create({ data: { ...sourceLink, jobId: same.id } }),
      prisma.job.update({ where: { id: same.id }, data: { lastSeenAt: now } }),
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
