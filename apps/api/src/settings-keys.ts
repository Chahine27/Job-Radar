import { z } from "zod";

/** Services réglables depuis la page « Réglages », avec les clés de .env qu'ils utilisent. */
export const SETTING_SERVICES = {
  "france-travail": ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"],
  adzuna: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  jooble: ["JOOBLE_API_KEY"],
  email: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "NOTIFY_EMAIL_TO"],
  prim: ["PRIM_API_KEY"],
} as const;

export type SettingService = keyof typeof SETTING_SERVICES;
export type SettingKey = (typeof SETTING_SERVICES)[SettingService][number];

export const SETTING_KEYS = Object.values(SETTING_SERVICES).flat() as SettingKey[];

/** Clés indispensables pour qu'un service marche (les autres sont facultatives). */
export const REQUIRED_KEYS: Record<SettingService, SettingKey[]> = {
  "france-travail": ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"],
  adzuna: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  jooble: ["JOOBLE_API_KEY"],
  email: ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"],
  prim: ["PRIM_API_KEY"],
};

/** Valeurs non secrètes : affichées en entier (serveur, port, adresses). Les autres sont masquées. */
const PUBLIC_KEYS = new Set<SettingKey>(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_FROM", "NOTIFY_EMAIL_TO"]);

export const isSecretKey = (key: SettingKey) => !PUBLIC_KEYS.has(key);

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}

export function isSettingService(s: string): s is SettingService {
  return Object.hasOwn(SETTING_SERVICES, s);
}

/** « abcd•••••• » : jamais la valeur entière. Une valeur courte est entièrement masquée. */
export function maskSecret(value: string): string {
  return value.length >= 12 ? `${value.slice(0, 4)}••••••` : "••••••";
}

const token = (label: string, re = /^[A-Za-z0-9_.:-]+$/) =>
  z.string().min(4, `${label} : trop court`).max(300, `${label} : trop long`).regex(re, `${label} : caractères non autorisés (ni espace ni guillemet)`);
const email = z.email("adresse email invalide");

/** Format attendu pour chaque clé (une valeur vide = effacer la clé). */
const RULES: Record<SettingKey, z.ZodType<string>> = {
  FRANCE_TRAVAIL_CLIENT_ID: token("Identifiant client"),
  FRANCE_TRAVAIL_CLIENT_SECRET: token("Clé secrète"),
  ADZUNA_APP_ID: token("Application ID", /^[A-Za-z0-9]+$/),
  ADZUNA_APP_KEY: token("Application key", /^[A-Za-z0-9]+$/),
  JOOBLE_API_KEY: z.string().regex(/^[A-Za-z0-9-]{8,100}$/, "Clé Jooble : lettres, chiffres et tirets seulement"),
  SMTP_HOST: z.string().max(253).regex(/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/, "serveur invalide (ex. smtp.gmail.com)"),
  SMTP_PORT: z.string().regex(/^\d{1,5}$/, "port invalide (ex. 587)").refine((v) => Number(v) >= 1 && Number(v) <= 65535, "port invalide (ex. 587)"),
  SMTP_USER: email,
  // Mot de passe d'application Gmail : souvent collé avec des espaces (« abcd efgh ijkl mnop »), retirés à l'usage.
  SMTP_PASSWORD: z.string().min(4, "mot de passe trop court").max(200, "mot de passe trop long"),
  SMTP_FROM: z.string().max(200, "trop long"),
  NOTIFY_EMAIL_TO: email,
  PRIM_API_KEY: token("Clé PRIM"),
};

/** Vérifie une valeur avant de l'écrire dans .env. Renvoie le message d'erreur, ou null si elle est bonne. */
export function validateSetting(key: SettingKey, raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (/[\r\n\0]/.test(value)) return "une seule ligne attendue";
  if (value.includes("••")) return "valeur masquée : recopie la vraie valeur";
  if (value.includes("'") && (value.includes('"') || value.includes("\\"))) return "guillemets non autorisés";
  const res = RULES[key].safeParse(value);
  return res.success ? null : (res.error.issues[0]?.message ?? "valeur invalide");
}
