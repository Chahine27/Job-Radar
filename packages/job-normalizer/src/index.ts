export * from "./types";
export * from "./text";
export * from "./salary";
export * from "./france-travail";
export * from "./adzuna";
export * from "./html";
export * from "./contract";
export * from "./jooble";
export * from "./manual";
export * from "./manual-analyze";

import type { RawJob } from "@job-radar/source-connectors";
import { ADZUNA_SOURCE, FT_SOURCE, JOOBLE_SOURCE } from "@job-radar/source-connectors";
import { normalizeAdzuna } from "./adzuna";
import { normalizeFranceTravail } from "./france-travail";
import { normalizeJooble } from "./jooble";
import { MANUAL_SOURCE, normalizeManual } from "./manual";
import type { NormalizedJob } from "./types";

/** Aiguillage par source. Source inconnue → null (l'offre est ignorée et comptée). */
export function normalize(raw: RawJob): NormalizedJob | null {
  switch (raw.source) {
    case FT_SOURCE:
      return normalizeFranceTravail(raw);
    case ADZUNA_SOURCE:
      return normalizeAdzuna(raw);
    case JOOBLE_SOURCE:
      return normalizeJooble(raw);
    case MANUAL_SOURCE:
      return normalizeManual(raw);
    default:
      return null;
  }
}
export * from "./dedupe";
