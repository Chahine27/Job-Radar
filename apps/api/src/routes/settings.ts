import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { TestResult } from "../live";
import {
  REQUIRED_KEYS,
  SETTING_KEYS,
  SETTING_SERVICES,
  type SettingKey,
  type SettingService,
  isSecretKey,
  isSettingKey,
  isSettingService,
  maskSecret,
  validateSetting,
} from "../settings-keys";

/** Lecture / écriture des clés de .env et tests des services (branché dans server.ts). */
export type SettingsService = {
  /** Valeurs actuelles (celles utilisées par l'appli). */
  values(): Partial<Record<SettingKey, string | undefined>>;
  /** Écrit les valeurs dans .env (valeur vide = clé effacée) et les applique tout de suite. */
  save(updates: Partial<Record<SettingKey, string>>): Promise<void>;
  test(service: SettingService): Promise<TestResult>;
};

export async function settingsRoutes(app: FastifyInstance, opts: { settings: SettingsService }) {
  app.addHook("preHandler", requireAuth);

  function state() {
    const values = opts.settings.values();
    const keys = Object.fromEntries(
      SETTING_KEYS.map((k) => {
        const value = values[k]?.trim() ?? "";
        // Jamais une clé secrète en entier vers le navigateur.
        return [k, { filled: value !== "", secret: isSecretKey(k), display: value === "" ? "" : isSecretKey(k) ? maskSecret(value) : value }];
      }),
    );
    const services = Object.fromEntries(
      (Object.keys(SETTING_SERVICES) as SettingService[]).map((s) => [s, { configured: REQUIRED_KEYS[s].every((k) => values[k]?.trim()) }]),
    );
    return { keys, services };
  }

  app.get("/api/settings/keys", async () => state());

  app.put("/api/settings/keys", async (request, reply) => {
    const body = z.record(z.string(), z.string().max(500)).safeParse(request.body);
    if (!body.success || Object.keys(body.data).length === 0) return reply.code(400).send({ error: "INVALID_BODY" });
    const updates: Partial<Record<SettingKey, string>> = {};
    const issues: Array<{ path: string; message: string }> = [];
    for (const [key, raw] of Object.entries(body.data)) {
      if (!isSettingKey(key)) {
        issues.push({ path: key, message: "réglage inconnu" });
        continue;
      }
      const problem = validateSetting(key, raw);
      if (problem) issues.push({ path: key, message: problem });
      else updates[key] = raw.trim();
    }
    if (issues.length) {
      const unknown = issues.some((i) => i.message === "réglage inconnu");
      return reply.code(400).send({
        error: unknown ? "UNKNOWN_KEY" : "INVALID_VALUE",
        message: issues.map((i) => `${i.path} : ${i.message}`).join(" ; "),
        issues,
      });
    }
    await opts.settings.save(updates);
    return state();
  });

  app.post(
    "/api/settings/test/:service",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { service } = request.params as { service: string };
      if (!isSettingService(service)) return reply.code(404).send({ error: "UNKNOWN_SERVICE" });
      return opts.settings.test(service);
    },
  );
}
