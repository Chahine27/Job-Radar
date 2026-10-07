import { type NormalizedJob, fingerprintOf } from "@job-radar/job-normalizer";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { dedupeJobs } from "./dedupe";
import { ingestJob } from "./ingest";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

/** Offre fictive d'une source : l'identifiant, le titre et le lieu changent d'une source à l'autre, comme en vrai. */
function offer(source: string, id: string, title: string, over: Partial<NormalizedJob> = {}): NormalizedJob {
  const city = over.city === undefined ? "Paris" : over.city;
  return {
    source, sourceJobId: id, sourceUrl: `https://${source}.test/offre/${id}`, canonicalUrl: null,
    fingerprint: fingerprintOf({ source, sourceJobId: id, company: "Nordia", title, city }),
    contentHash: `h-${source}-${id}`, title, company: "Nordia", description: `Annonce ${id}`,
    contractType: null, experienceText: null, experienceMinYrs: null, experienceMaxYrs: null,
    salaryMin: null, salaryMax: null, salaryPeriod: null, salaryText: null,
    city, postalCode: null, department: "75", address: null, latitude: null, longitude: null,
    locationPrecision: "unknown", remoteType: "unknown", technologies: [], publishedAt: null, rawData: {}, ...over,
  };
}

describe("même offre, écrite autrement par une autre source", () => {
  it("titre avec/sans contrat et lieu « Paris » / « 8ème Arrondissement » → une seule offre, plusieurs sources", async () => {
    expect(await ingestJob(prisma, offer("france-travail", "ft1", "Assistant comptable - CDD (H/F)"))).toBe("created");
    expect(await ingestJob(prisma, offer("adzuna", "az1", "Assistant comptable - CDD", { city: "8ème Arrondissement" }))).toBe("duplicate");
    expect(await ingestJob(prisma, offer("jooble", "jb1", "Assistant comptable", { city: null, department: null }))).toBe("duplicate");
    expect(await prisma.job.count()).toBe(1);
    expect(await prisma.jobSourceLink.count()).toBe(3);
  });

  it("CDI et CDD écrits dans les titres, ou autre département → offres distinctes", async () => {
    await ingestJob(prisma, offer("france-travail", "ft1", "Gestionnaire de paie - CDI"));
    expect(await ingestJob(prisma, offer("adzuna", "az1", "Gestionnaire de paie - CDD"))).toBe("created");
    expect(await ingestJob(prisma, offer("adzuna", "az2", "Gestionnaire de paie - CDI", { city: "Lyon", department: "69" }))).toBe("created");
    expect(await prisma.job.count()).toBe(3);
  });

  it("même lien d'annonce (paramètres de suivi en plus) → même offre ; une description vide ne l'efface jamais", async () => {
    await ingestJob(prisma, offer("manual", "m1", "Aide-soignant", { sourceUrl: "https://emploi.test/offre/42", description: "" }));
    expect(
      await ingestJob(prisma, offer("jooble", "jb1", "Aide-soignant de nuit", { sourceUrl: "https://emploi.test/offre/42?utm_source=x", description: "Soins et transmissions" })),
    ).toBe("duplicate");
    const [job] = await prisma.job.findMany();
    expect(job!.description).toBe("Soins et transmissions"); // complétée par le doublon
    await ingestJob(prisma, offer("jooble", "jb1", "Aide-soignant de nuit", { sourceUrl: "https://emploi.test/offre/42", description: "", contentHash: "autre" }));
    expect((await prisma.job.findFirstOrThrow()).description).toBe("Soins et transmissions");
  });
});

describe("dedupeJobs : doublons déjà en base", () => {
  /** Deux offres identiques créées avant la règle : on les insère sans passer par la détection. */
  async function twoExistingDuplicates() {
    const a = offer("france-travail", "ft1", "Assistant comptable - CDD (H/F)");
    const b = offer("adzuna", "az1", "Assistant comptable - CDD", { city: "8ème Arrondissement" });
    for (const [i, n] of [a, b].entries()) {
      await prisma.job.create({
        data: {
          fingerprint: n.fingerprint, contentHash: n.contentHash, title: n.title, company: n.company, description: n.description,
          city: n.city, department: n.department, technologies: [], firstSeenAt: new Date(2026, 9, 1 + i), lastSeenAt: new Date(),
          sources: { create: { source: n.source, sourceJobId: n.sourceJobId, sourceUrl: n.sourceUrl } },
        },
      });
    }
    return prisma.job.findMany({ orderBy: { firstSeenAt: "asc" } });
  }

  it("sans apply : repère les doublons, ne supprime rien", async () => {
    await twoExistingDuplicates();
    const r = await dedupeJobs(prisma);
    expect(r.groups).toHaveLength(1);
    expect(r.merged).toBe(0);
    expect(await prisma.job.count()).toBe(2);
    expect((await prisma.job.findMany()).every((j) => j.dedupeKey)).toBe(true);
  });

  it("avec apply : garde l'offre sur laquelle tu as agi, rapatrie les sources, supprime le doublon", async () => {
    const [older, newer] = await twoExistingDuplicates();
    await prisma.job.update({ where: { id: newer!.id }, data: { status: "APPLIED" } });
    const r = await dedupeJobs(prisma, { apply: true });
    expect(r.merged).toBe(1);
    const left = await prisma.job.findMany({ include: { sources: true } });
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(newer!.id); // celle où tu as postulé, même si l'autre est plus ancienne
    expect(left[0]!.status).toBe("APPLIED");
    expect(left[0]!.sources).toHaveLength(2);
    expect(left[0]!.firstSeenAt).toEqual(older!.firstSeenAt);
    expect((await dedupeJobs(prisma, { apply: true })).groups).toHaveLength(0);
  });

  it("le statut le plus avancé est conservé", async () => {
    const [older, newer] = await twoExistingDuplicates();
    await prisma.job.update({ where: { id: older!.id }, data: { status: "SEEN" } });
    await prisma.job.update({ where: { id: newer!.id }, data: { status: "SAVED" } });
    await dedupeJobs(prisma, { apply: true });
    const left = await prisma.job.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]!.status).toBe("SAVED");
  });
});
