import { type RomeJob, isRomeCode, romeLabel, searchRome } from "@job-radar/shared/rome";
import type { RomeoPrediction } from "@job-radar/source-connectors";

export type RomeSuggestDeps = {
  /** API ROMEO de France Travail (si les identifiants sont dans les Réglages). */
  romeo?: { isConfigured(): boolean; predict(titles: string[]): Promise<RomeoPrediction[]> };
  /** IA locale : choisit parmi des fiches de la liste officielle. */
  aiPick?: (searches: string[], candidates: RomeJob[]) => Promise<string[]>;
};

export type RomeSuggestion = {
  items: RomeJob[];
  /** D'où viennent les codes proposés. */
  source: "france-travail" | "ia" | "liste" | "aucune";
};

export const MAX_ROMES = 5;
/** Score ROMEO minimum pour garder une proposition (1 = IA de France Travail très sûre). */
const ROMEO_MIN_SCORE = 0.3;
/** Sans IA : seulement les intitulés presque identiques à une fiche officielle. */
const WORDS_MIN_SCORE = 0.9;

/** Prend le 1er choix de chaque intitulé, puis le 2e, etc. : chaque métier recherché est représenté. */
function interleave(lists: string[][], max: number): string[] {
  const out: string[] = [];
  for (let rank = 0; out.length < max && lists.some((l) => l.length > rank); rank++) {
    for (const l of lists) {
      const code = l[rank];
      if (code && !out.includes(code) && out.length < max) out.push(code);
    }
  }
  return out;
}

const toJobs = (codes: string[]): RomeJob[] => codes.filter(isRomeCode).map((code) => ({ code, label: romeLabel(code)! }));

/**
 * Codes ROME proposés pour les métiers recherchés. Jamais de code inventé : tout code renvoyé
 * existe dans la liste officielle. Ordre d'essai : ROMEO (France Travail), IA locale, recherche par mots.
 */
export async function suggestRomes(searches: string[], deps: RomeSuggestDeps, max = MAX_ROMES): Promise<RomeSuggestion> {
  const titles = [...new Set(searches.map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 10);
  if (titles.length === 0) return { items: [], source: "aucune" };

  if (deps.romeo?.isConfigured()) {
    try {
      const predictions = await deps.romeo.predict(titles);
      const lists = predictions.map((p) => p.jobs.filter((j) => j.score >= ROMEO_MIN_SCORE && isRomeCode(j.code)).map((j) => j.code));
      const codes = interleave(lists, max);
      if (codes.length) return { items: toJobs(codes), source: "france-travail" };
    } catch {
      // ROMEO indisponible : on passe à la suite (IA locale puis liste).
    }
  }

  const perTitle = titles.map((t) => searchRome(t, 6));
  const candidates = new Map<string, RomeJob>();
  for (const list of perTitle) for (const j of list) candidates.set(j.code, { code: j.code, label: j.label });

  if (deps.aiPick && candidates.size) {
    try {
      const picked = (await deps.aiPick(titles, [...candidates.values()])).filter((c) => candidates.has(c));
      if (picked.length) return { items: toJobs([...new Set(picked)].slice(0, max)), source: "ia" };
    } catch {
      // IA éteinte : recherche par mots seule.
    }
  }

  const codes = interleave(perTitle.map((l) => l.filter((j) => j.score >= WORDS_MIN_SCORE).map((j) => j.code)), max);
  return codes.length ? { items: toJobs(codes), source: "liste" } : { items: [], source: "aucune" };
}
