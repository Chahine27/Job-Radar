import { describe, expect, it } from "vitest";
import { SETTING_CARDS, anyJobSourceConfigured, initialDrafts, pendingChanges } from "./settings-guide";
import type { SettingsState } from "./types";

const email = SETTING_CARDS.find((c) => c.id === "email")!;
const state: SettingsState = {
  keys: {
    SMTP_HOST: { filled: false, secret: false, display: "" },
    SMTP_PORT: { filled: true, secret: false, display: "465" },
    SMTP_USER: { filled: true, secret: false, display: "camille.martin@example.com" },
    SMTP_PASSWORD: { filled: true, secret: true, display: "abcd••••••" },
    SMTP_FROM: { filled: false, secret: false, display: "" },
    NOTIFY_EMAIL_TO: { filled: false, secret: false, display: "" },
  },
  services: { "france-travail": { configured: false }, adzuna: { configured: false }, jooble: { configured: false }, email: { configured: true } },
};

describe("page Réglages", () => {
  it("chaque service a un lien officiel, des étapes et des champs", () => {
    expect(SETTING_CARDS.map((c) => c.id)).toEqual(["france-travail", "adzuna", "jooble", "email", "prim", "ai"]);
    for (const c of SETTING_CARDS) {
      expect(c.link.href).toMatch(/^https:\/\//);
      expect(c.steps.length).toBeGreaterThan(1);
      expect(c.fields.length).toBeGreaterThan(0);
    }
  });

  it("brouillon : valeurs visibles reprises, secrets jamais pré-remplis, valeur Gmail proposée", () => {
    expect(initialDrafts(email, state)).toEqual({
      SMTP_USER: "camille.martin@example.com",
      SMTP_PASSWORD: "",
      NOTIFY_EMAIL_TO: "",
      SMTP_FROM: "",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
    });
  });

  it("n'envoie que ce qui change ; un secret laissé vide reste inchangé", () => {
    const drafts = { ...initialDrafts(email, state), SMTP_USER: "  " };
    expect(pendingChanges(email, drafts, state)).toEqual({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "" });
    expect(pendingChanges(email, { ...drafts, SMTP_USER: "camille.martin@example.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" }, state)).toEqual({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PASSWORD: "abcd efgh ijkl mnop",
    });
  });

  it("bandeau des offres : affiché tant qu'aucune source d'offres n'a sa clé", () => {
    expect(anyJobSourceConfigured(state)).toBe(false);
    expect(anyJobSourceConfigured({ ...state, services: { ...state.services, jooble: { configured: true } } })).toBe(true);
  });
});
