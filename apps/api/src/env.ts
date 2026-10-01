import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

/** Fichier .env à la racine du projet (modifié aussi par la page « Réglages »). */
export const ENV_PATH = path.resolve(import.meta.dirname, "../../../.env");

config({ path: ENV_PATH, quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL manquant dans .env"),
  APP_URL: z.url().default("http://localhost:5173"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CRON_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const res = EnvSchema.safeParse(source);
  if (!res.success) {
    const details = res.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${details}`);
  }
  return res.data;
}
