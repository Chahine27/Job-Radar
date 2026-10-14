import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

describe("collecte", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "POST", url: "/api/jobs/refresh" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/collection/status" })).statusCode).toBe(401);
  });

  it("POST /api/jobs/refresh lance la collecte, puis signale qu'elle est déjà en cours", async () => {
    const { app, collector } = await createTestApp();
    const cookies = await login(app);
    const a = await app.inject({ method: "POST", url: "/api/jobs/refresh", cookies });
    expect(a.statusCode).toBe(202);
    expect(a.json()).toEqual({ status: "started", runId: "run-1" });
    const b = await app.inject({ method: "POST", url: "/api/jobs/refresh", cookies });
    expect(b.json().status).toBe("already_running");
    expect(collector.starts).toEqual(["manual", "manual"]);
  });

  it("POST /api/sources/:source/refresh relance une seule source ; source inactive → 409", async () => {
    const { app, collector } = await createTestApp();
    const cookies = await login(app);
    expect((await app.inject({ method: "POST", url: "/api/sources/adzuna/refresh" })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/sources/adzuna/refresh", cookies });
    expect(ok.statusCode).toBe(202);
    expect(collector.starts).toEqual(["adzuna"]);
    expect((await app.inject({ method: "POST", url: "/api/sources/off/refresh", cookies })).statusCode).toBe(409);
  });

  it("POST /api/system/stop : demande l'arrêt au lanceur ; absente quand Job Radar est lancé avec pnpm dev", async () => {
    let stops = 0;
    const { app } = await createTestApp({ stopApp: () => stops++ });
    expect((await app.inject({ method: "POST", url: "/api/system/stop" })).statusCode).toBe(401);
    const cookies = await login(app);
    expect((await app.inject({ method: "POST", url: "/api/system/stop", cookies })).statusCode).toBe(202);
    expect(stops).toBe(1);
    const manual = await createTestApp();
    expect((await manual.app.inject({ method: "POST", url: "/api/system/stop", cookies: await login(manual.app) })).statusCode).toBe(404);
  });

  it("GET /api/collection/status : « N nouvelle(s) » = offres Nouvelles visibles du flux, pas toutes celles en base", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/collection/status", cookies });
    expect(res.statusCode).toBe(200);
    const feed = (await app.inject({ method: "GET", url: "/api/jobs?status=NEW&minScore=0", cookies })).json();
    const visible = (Array.isArray(feed) ? feed : feed.items).length;
    expect(res.json().newJobs).toBe(visible);
    expect(visible).toBeLessThan(4); // le CDD hors profil est masqué
  });
});
