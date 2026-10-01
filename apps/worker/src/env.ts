import path from "node:path";
import { config } from "dotenv";
import { AdzunaSource, FranceTravailSource, JoobleSource, type JoobleQuotaStore } from "@job-radar/source-connectors";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

export function franceTravailFromEnv() {
  return new FranceTravailSource({
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID?.trim(),
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim(),
  });
}

export function adzunaFromEnv() {
  return new AdzunaSource({ appId: process.env.ADZUNA_APP_ID?.trim(), appKey: process.env.ADZUNA_APP_KEY?.trim() });
}

export function joobleFromEnv(quota: JoobleQuotaStore) {
  return new JoobleSource({ apiKey: process.env.JOOBLE_API_KEY?.trim(), quota });
}
