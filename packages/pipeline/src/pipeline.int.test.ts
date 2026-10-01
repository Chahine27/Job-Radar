import { normalize } from "@job-radar/job-normalizer";
import { EXAMPLE_PROFILE } from "@job-radar/shared";
import { FT_SAMPLE_OFFER, type JobSource, JoobleSource, type RawJob } from "@job-radar/source-connectors";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { prismaJoobleQuota } from "./api-quota";
import { buildManualJob, removeManualJob, saveManualJob } from "./manual";
import { collectOnce } from "./collect";
import { expireJobs } from "./expire";
import { ingestJob } from "./ingest";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

const raw = (data: object, source = "france-travail"): RawJob => ({
  source,
  sourceJobId: (data as { id: string }).id,
  data,
  collectedAt: new Date(),
});

describe("source → normalisation → base (README §32)", () => {
  it("crée, reconnaît, met à jour et fusionne les doublons", async () => {
    const first = normalize(raw(FT_SAMPLE_OFFER))!;
    expect(await ingestJob(prisma, first)).toBe("created");
    expect(await ingestJob(prisma, first)).toBe("unchanged");

    const changed = normalize(raw({ ...FT_SAMPLE_OFFER, salaire: { libelle: "Annuel de 45000 Euros" } }))!;
    expect(await ingestJob(prisma, changed)).toBe("updated");
    expect((await prisma.job.findFirstOrThrow()).salaryMin).toBe(45000);

    // Même offre (entreprise + titre + ville) venue d'une autre source → rattachée, pas dupliquée.
    const other = { ...changed, source: "adzuna", sourceJobId: "az-1", sourceUrl: "https://adzuna/1" };
    expect(await ingestJob(prisma, other)).toBe("duplicate");
    expect(await prisma.job.count()).toBe(1);
    expect(await prisma.jobSourceLink.count()).toBe(2);
    const events = (await prisma.jobEvent.findMany()).map((e) => e.type).sort();
    expect(events).toEqual(["CREATED", "SOURCE_ADDED", "UPDATED"]);
  });

  it("collecte complète : une source en erreur n'arrête pas les autres, tout est tracé", async () => {
    const ok: JobSource = {
      name: "france-travail",
      search: async (q) => (q.department === "69" ? [raw(FT_SAMPLE_OFFER), raw({ ...FT_SAMPLE_OFFER, id: "2", intitule: "Développeur Java" })] : []),
      healthCheck: async () => ({ status: "OK" }),
    };
    const broken: JobSource = {
      name: "adzuna",
      search: async () => {
        throw new Error("HTTP 500");
      },
      healthCheck: async () => ({ status: "ERROR", message: "x" }),
    };
    const r = await collectOnce({ prisma, sources: [ok, broken], profile: EXAMPLE_PROFILE, trigger: "cli", publishedSinceDays: 7 });
    expect(r).toMatchObject({ status: "partial", fetched: 2, created: 2 });
    expect(r.sources.map((s) => s.status)).toEqual(["OK", "ERROR"]);

    const runs = await prisma.sourceRun.findMany({ orderBy: { source: "asc" } });
    expect(runs.map((x) => [x.source, x.status])).toEqual([
      ["adzuna", "ERROR"],
      ["france-travail", "OK"],
    ]);
    const states = await prisma.sourceState.findMany({ orderBy: { source: "asc" } });
    expect(states.find((s) => s.source === "adzuna")!.failures).toBe(1);
    expect(states.find((s) => s.source === "france-travail")!.lastSuccessAt).not.toBeNull();
    expect((await prisma.collectionRun.findFirstOrThrow()).status).toBe("partial");
  });

  it("offres expirées : seulement quand toutes les sources le confirment, jamais les sauvegardées", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 86_400_000);
    await ingestJob(prisma, normalize(raw(FT_SAMPLE_OFFER))!, old);
    await ingestJob(prisma, normalize(raw({ ...FT_SAMPLE_OFFER, id: "ENCORE", intitule: "Dev encore en ligne" }))!, old);
    await ingestJob(prisma, normalize(raw({ ...FT_SAMPLE_OFFER, id: "SAUVEE", intitule: "Dev sauvegardé" }))!, old);
    await prisma.job.updateMany({ where: { title: "Dev sauvegardé" }, data: { status: "SAVED" } });

    const asked: string[] = [];
    const r = await expireJobs({
      prisma,
      now,
      ftIsOnline: async (id) => {
        asked.push(id);
        return id === "ENCORE";
      },
    });
    expect(r.expired).toBe(1);
    expect(asked.sort()).toEqual(["199XYZT", "ENCORE"]);
    const byTitle = Object.fromEntries((await prisma.job.findMany()).map((j) => [j.title, j.status]));
    expect(byTitle["Développeur Full Stack Vue.js / Node.js (H/F)"]).toBe("EXPIRED");
    expect(byTitle["Dev encore en ligne"]).toBe("NEW");
    expect(byTitle["Dev sauvegardé"]).toBe("SAVED");
  });

  it("Jooble : offres enregistrées, appels comptés en base, pas de 2ᵉ appel le même jour", async () => {
    const quota = prismaJoobleQuota(prisma, "abcd-1234-efgh");
    let calls = 0;
    const jooble = new JoobleSource({
      apiKey: "abcd-1234-efgh",
      quota,
      sleep: async () => {},
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                title: "Développeur Vue.js",
                location: "Vénissieux",
                snippet: "Vue.js et TypeScript",
                type: "CDI",
                link: "https://fr.jooble.org/desc/-111?ckey=x",
                company: "ACME Jooble",
                updated: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const profile = { ...EXAMPLE_PROFILE, searches: ["Développeur Vue.js", "Développeur frontend"], locations: [{ label: "Rhône", department: "69" }] };
    const r1 = await collectOnce({ prisma, profile, sources: [jooble], trigger: "manual" });
    expect(r1.created).toBe(1);
    expect(calls).toBe(1); // 2 recherches, 1 zone → 1 seul appel
    expect((await quota.get()).used).toBe(1);

    const r2 = await collectOnce({ prisma, profile, sources: [jooble], trigger: "manual" });
    expect(r2.sources[0]!.status).toBe("OK");
    expect(calls).toBe(1); // moins de 20 h : ignorée
    expect((await prisma.apiQuota.findMany()).map((q) => q.used)).toEqual([1]);
    expect((await prisma.job.findFirstOrThrow()).department).toBe("69");
  });

  it("offre ajoutée à la main : sauvegardée, jamais expirée ; rattachée si déjà connue ; retrait", async () => {
    const form = {
      title: "Développeur Vue.js",
      company: "Acme Manuel",
      location: "Vénissieux",
      description: "Vue.js et TypeScript, CDI, 2 ans d'expérience minimum.",
    };
    const a = await saveManualJob(prisma, buildManualJob(form)!);
    expect(a.duplicate).toBe(false);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: a.jobId } });
    expect(job).toMatchObject({ status: "SAVED", contractType: "CDI", city: "Vénissieux", department: "69" });

    // Deuxième ajout identique : rattaché à la même offre.
    const b = await saveManualJob(prisma, buildManualJob(form)!);
    expect(b).toMatchObject({ jobId: a.jobId, duplicate: true });
    expect(await prisma.job.count()).toBe(1);

    // Vieille de 100 jours : l'expiration ne la touche pas.
    await prisma.job.update({ where: { id: a.jobId }, data: { lastSeenAt: new Date(Date.now() - 100 * 86_400_000) } });
    await expireJobs({ prisma });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: a.jobId } })).status).toBe("SAVED");

    expect(await removeManualJob(prisma, a.jobId)).toBe("deleted");
    expect(await prisma.job.count()).toBe(0);
  });
});
