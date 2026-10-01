import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { createPrismaNotifyRepo } from "./notify";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe("anti double notification (base réelle)", () => {
  it("une offre ne peut être réservée qu'une fois par canal", async () => {
    const job = await prisma.job.create({
      data: { fingerprint: "f1", contentHash: "h", title: "Dev", description: "Vue", technologies: [] },
    });
    const repo = createPrismaNotifyRepo(prisma);
    expect(await repo.claim(job.id, "email")).toBe(true);
    expect(await repo.claim(job.id, "email")).toBe(false);
    expect(await repo.claim(job.id, "webpush")).toBe(true);
    await repo.finish(job.id, "email", "sent");
    await repo.markNotified([job.id]);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).notifiedAt).not.toBeNull();
    expect(await repo.candidates(new Date(0))).toEqual([]);
  });
});
