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

  it("GET /api/collection/status renvoie l'état", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/collection/status", cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().newJobs).toBe(3);
  });
});
