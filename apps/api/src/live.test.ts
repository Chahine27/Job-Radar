import type { Notifier } from "@job-radar/notifications";
import type { JobSource, JoobleQuotaStore } from "@job-radar/source-connectors";
import { describe, expect, it } from "vitest";
import { liveNotifier, liveSource, smtpFrom, testService } from "./live";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeSource(name: string, withSearchAll: boolean): JobSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    search: async () => (calls.push("search"), []),
    healthCheck: async () => ({ status: "OK" }),
    ...(withSearchAll ? { searchAll: async () => (calls.push("searchAll"), { jobs: [], errors: [] }) } : {}),
  };
}

function memoryQuota(): JoobleQuotaStore {
  let used = 0;
  return { get: async () => ({ used, lastCallAt: null }), record: async (n) => void (used += n) };
}

describe("relais : nouvelles clés sans redémarrer", () => {
  it("une source suit le service reconstruit et garde ses méthodes facultatives", async () => {
    let current = fakeSource("jooble", true);
    const first = current;
    const live = liveSource(() => current);
    expect(live.name).toBe("jooble");
    expect(live.fetchAll).toBeUndefined();
    await live.searchAll!([]);
    current = fakeSource("jooble", true);
    await live.searchAll!([]);
    await live.search({ keywords: "x" });
    expect(first.calls).toEqual(["searchAll"]);
    expect(current.calls).toEqual(["searchAll", "search"]);
    expect(liveSource(() => fakeSource("adzuna", false)).searchAll).toBeUndefined();
  });

  it("le canal email devient configuré dès que la clé est ajoutée", () => {
    const off: Notifier = { channel: "email", isConfigured: () => false, sendAlerts: async () => {}, sendTest: async () => {} };
    const on: Notifier = { ...off, isConfigured: () => true };
    let current = off;
    const live = liveNotifier(() => current);
    expect(live.isConfigured()).toBe(false);
    current = on;
    expect(live.isConfigured()).toBe(true);
  });

  it("retire les espaces du mot de passe d'application Gmail", () => {
    expect(smtpFrom({ SMTP_HOST: " smtp.gmail.com ", SMTP_PORT: "465", SMTP_USER: "a@example.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" })).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      user: "a@example.com",
      password: "abcdefghijklmnop",
    });
  });
});

describe("bouton Tester", () => {
  const deps = { joobleQuota: () => memoryQuota() };

  it("demande d'abord les clés manquantes, sans appel", async () => {
    const r = await testService("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "PAR_x_123456" }, { ...deps, fetch: () => Promise.reject(new Error("aucun appel attendu")) });
    expect(r).toEqual({ ok: false, message: "Remplis et enregistre d'abord : Clé secrète." });
  });

  it("France Travail : identifiants refusés → message clair, sans la clé", async () => {
    const fetch = async () => json({ error: "invalid_client", error_description: "secret-tres-long-0123456789" }, 401);
    const r = await testService("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "PAR_x_123456", FRANCE_TRAVAIL_CLIENT_SECRET: "secret-tres-long-0123456789" }, { ...deps, fetch });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("refuse ces identifiants");
    expect(r.message).not.toContain("secret-tres-long");
  });

  it("France Travail : offres OK, La Bonne Boîte non ajoutée → prévient", async () => {
    const fetch = async (_url: string, init?: RequestInit) =>
      String(init?.body).includes("labonneboite") ? json({ error: "invalid_scope" }, 400) : json({ access_token: "t", expires_in: 1499 });
    const r = await testService("france-travail", { FRANCE_TRAVAIL_CLIENT_ID: "PAR_x_123456", FRANCE_TRAVAIL_CLIENT_SECRET: "s3cr3t-0123456789" }, { ...deps, fetch });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("La Bonne Boîte refusée");
  });

  it("Jooble : un appel réel, compté dans le quota", async () => {
    const quota = memoryQuota();
    const fetch = async () => json({ jobs: [{ id: 1, title: "Aide-soignant", link: "https://fr.jooble.org/desc/1234567890" }] });
    const r = await testService("jooble", { JOOBLE_API_KEY: "1a2b3c4d-5e6f" }, { joobleQuota: () => quota, fetch });
    expect(r).toEqual({ ok: true, message: "Jooble répond : 1 offre(s) trouvée(s). Appels utilisés : 1 sur 500." });
  });

  it("Email : mot de passe refusé → explique le mot de passe d'application", async () => {
    const values = { SMTP_HOST: "smtp.gmail.com", SMTP_USER: "camille.martin@example.com", SMTP_PASSWORD: "mauvais-mot-de-passe" };
    const verifySmtp = async () => {
      throw Object.assign(new Error("Invalid login"), { code: "EAUTH" });
    };
    const r = await testService("email", values, { ...deps, verifySmtp });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("mot de passe d'application");
    const ok = await testService("email", values, { ...deps, verifySmtp: async () => {} });
    expect(ok).toEqual({ ok: true, message: "Connexion réussie à smtp.gmail.com avec camille.martin@example.com. Les emails peuvent partir." });
  });

  it("PRIM : trajet test calculé, clé refusée", async () => {
    const good = await testService("prim", { PRIM_API_KEY: "cle-prim-0123456789" }, { ...deps, fetch: async () => json({ journeys: [{ duration: 1500 }] }) });
    expect(good).toEqual({ ok: true, message: "PRIM répond : trajet test dans Paris calculé (25 min)." });
    const bad = await testService("prim", { PRIM_API_KEY: "cle-prim-0123456789" }, { ...deps, fetch: async () => json({ message: "Invalid key" }, 401) });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("PRIM refuse la clé");
  });

  it("Adzuna : clé refusée", async () => {
    const r = await testService("adzuna", { ADZUNA_APP_ID: "1a2b3c4d", ADZUNA_APP_KEY: "0123456789abcdef" }, { ...deps, fetch: async () => json({}, 401) });
    expect(r).toEqual({ ok: false, message: "Adzuna refuse la clé : vérifie l'Application ID et l'Application key." });
  });
});
