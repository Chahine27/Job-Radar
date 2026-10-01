import { describe, expect, it } from "vitest";
import { maskSecret, validateSetting } from "./settings-keys";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("réglages : clés des services", () => {
  it("connexion obligatoire", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/settings/keys" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/api/settings/keys", payload: { JOOBLE_API_KEY: "abcd-1234-efgh" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/settings/test/jooble" })).statusCode).toBe(401);
  });

  it("indique les clés remplies, sans jamais renvoyer une clé secrète en entier", async () => {
    const { req } = await setup();
    const res = await req("GET", "/api/settings/keys");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys.FRANCE_TRAVAIL_CLIENT_ID).toEqual({ filled: true, secret: true, display: "PAR_••••••" });
    expect(res.body).not.toContain("PAR_app_test_0123456789abcdef");
    expect(body.keys.SMTP_HOST).toEqual({ filled: true, secret: false, display: "smtp.example.com" });
    expect(body.keys.JOOBLE_API_KEY).toEqual({ filled: false, secret: true, display: "" });
    expect(body.services["france-travail"].configured).toBe(false);
    expect(body.services.jooble.configured).toBe(false);
  });

  it("enregistre les clés autorisées, et une valeur vide efface la clé", async () => {
    const { req, settingsValues } = await setup();
    const res = await req("PUT", "/api/settings/keys", { JOOBLE_API_KEY: " 1a2b3c4d-5e6f-7a8b ", SMTP_HOST: "" });
    expect(res.statusCode).toBe(200);
    expect(settingsValues.JOOBLE_API_KEY).toBe("1a2b3c4d-5e6f-7a8b");
    expect(settingsValues.SMTP_HOST).toBeUndefined();
    expect(res.json().services.jooble.configured).toBe(true);
    expect(res.json().keys.JOOBLE_API_KEY.display).toBe("1a2b••••••");
  });

  it("refuse une clé hors liste (rien n'est écrit)", async () => {
    const { req, settingsValues } = await setup();
    const res = await req("PUT", "/api/settings/keys", { DATABASE_URL: "postgresql://x", JOOBLE_API_KEY: "1a2b3c4d-5e6f" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("UNKNOWN_KEY");
    expect(settingsValues.DATABASE_URL).toBeUndefined();
    expect(settingsValues.JOOBLE_API_KEY).toBeUndefined();
  });

  it("refuse un format invalide, avec un message clair", async () => {
    const { req } = await setup();
    const res = await req("PUT", "/api/settings/keys", { SMTP_PORT: "abc", NOTIFY_EMAIL_TO: "pas-un-email" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_VALUE");
    expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(["SMTP_PORT", "NOTIFY_EMAIL_TO"]);
    expect((await req("PUT", "/api/settings/keys", {})).statusCode).toBe(400);
  });

  it("teste un service connu, refuse un service inconnu", async () => {
    const { req, settingsTests } = await setup();
    const res = await req("POST", "/api/settings/test/adzuna");
    expect(res.json()).toEqual({ ok: true, message: "adzuna répond" });
    expect(settingsTests).toEqual(["adzuna"]);
    expect((await req("POST", "/api/settings/test/inconnu")).statusCode).toBe(404);
  });
});

describe("réglages : contrôle des valeurs", () => {
  it("accepte des valeurs au bon format", () => {
    expect(validateSetting("SMTP_HOST", "smtp.gmail.com")).toBeNull();
    expect(validateSetting("SMTP_PORT", "465")).toBeNull();
    expect(validateSetting("SMTP_USER", "camille.martin@example.com")).toBeNull();
    expect(validateSetting("SMTP_PASSWORD", "abcd efgh ijkl mnop")).toBeNull();
    expect(validateSetting("SMTP_FROM", "Job Radar <camille.martin@example.com>")).toBeNull();
    expect(validateSetting("ADZUNA_APP_ID", "1a2b3c4d")).toBeNull();
    expect(validateSetting("FRANCE_TRAVAIL_CLIENT_ID", "PAR_monappli_0123456789")).toBeNull();
    expect(validateSetting("JOOBLE_API_KEY", "")).toBeNull();
  });

  it("refuse les valeurs dangereuses ou mal formées", () => {
    expect(validateSetting("SMTP_PORT", "70000")).not.toBeNull();
    expect(validateSetting("SMTP_HOST", "smtp gmail com")).not.toBeNull();
    expect(validateSetting("ADZUNA_APP_KEY", "abc def ghi")).not.toBeNull();
    expect(validateSetting("SMTP_PASSWORD", "ligne1\nAUTRE=1")).toBe("une seule ligne attendue");
    expect(validateSetting("PRIM_API_KEY", "abcd••••••")).toContain("masquée");
    expect(validateSetting("SMTP_FROM", `l'"x"`)).not.toBeNull();
  });

  it("masque les secrets", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("abcd••••••");
    expect(maskSecret("court")).toBe("••••••");
  });
});
