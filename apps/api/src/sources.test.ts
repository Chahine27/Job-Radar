import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("sources", () => {
  it("liste avec libellé, état de configuration et intervalle minimum", async () => {
    const { req } = await setup();
    const items = (await req("GET", "/api/sources")).json().items;
    const adzuna = items.find((i: { source: string }) => i.source === "adzuna");
    expect(adzuna).toMatchObject({ label: "Adzuna", configured: false, minIntervalMinutes: 90 });
  });

  it("refuse un intervalle plus court que la limite de la source", async () => {
    const { req } = await setup();
    const bad = await req("PUT", "/api/sources/adzuna", { enabled: true, intervalMinutes: 30 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain("Minimum 90 min");
    expect((await req("PUT", "/api/sources/adzuna", { enabled: true, intervalMinutes: 120 })).statusCode).toBe(200);
    expect((await req("PUT", "/api/sources/inconnue", { enabled: true, intervalMinutes: 120 })).statusCode).toBe(404);
  });
});
