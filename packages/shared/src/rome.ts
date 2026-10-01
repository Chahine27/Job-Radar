import data from "./rome-data.json" with { type: "json" };

/**
 * Liste officielle des métiers du ROME (France Travail, Licence Ouverte Etalab).
 * Fabriquée par scripts/build-rome.mjs. Côté serveur seulement (le fichier est gros).
 */
type RomeData = { version: string; codes: Record<string, [label: string, parent: string]>; appellations: Array<[label: string, code: string]> };
const ROME = data as unknown as RomeData;

export const ROME_VERSION = ROME.version;
export const ROME_CODE_RE = /^[A-N]\d{4}$/;

export type RomeJob = { code: string; label: string };

/** Le code existe-t-il dans la liste officielle ? */
export function isRomeCode(code: string): boolean {
  return ROME_CODE_RE.test(code) && Object.hasOwn(ROME.codes, code);
}

export function romeLabel(code: string): string | null {
  return isRomeCode(code) ? ROME.codes[code]![0] : null;
}

/** Codes à envoyer à La Bonne Boîte : chaque code et sa fiche « parente » (sans doublon). */
export function romeSearchCodes(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    if (!isRomeCode(c)) continue;
    out.add(c);
    out.add(ROME.codes[c]![1]);
  }
  return [...out];
}

const STOP = new Set(["de", "du", "des", "la", "le", "les", "en", "et", "au", "aux", "un", "une", "pour", "sur", "dans", "par", "avec", "d", "l"]);

/** Mots utiles d'un intitulé : minuscules, sans accent, sans petits mots (« Aide-soignante en EHPAD » → aide, soignante, ehpad). */
export function romeWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Deux mots « pareils » : même début (soignant / soignante, comptable / comptabilite). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

const INDEX = ROME.appellations.map(([label, code]) => ({ code, words: romeWords(label) }));
for (const [code, [label]] of Object.entries(ROME.codes)) INDEX.push({ code, words: romeWords(label) });

/**
 * Métiers de la liste officielle les plus proches d'un intitulé libre (recherche par mots, sans IA).
 * Rien n'est inventé : seuls des codes de la liste sont renvoyés, du plus proche au moins proche.
 */
export function searchRome(text: string, limit = 8): Array<RomeJob & { score: number }> {
  const q = text.trim().toUpperCase();
  if (isRomeCode(q)) return [{ code: q, label: romeLabel(q)!, score: 1 }];
  const words = romeWords(text);
  if (words.length === 0) return [];
  const best = new Map<string, number>();
  for (const entry of INDEX) {
    const hits = words.filter((w) => entry.words.some((e) => sameWord(w, e))).length;
    if (hits === 0) continue;
    // Part des mots cherchés trouvés, puis intitulé le plus court (le plus précis) à égalité.
    const score = hits / words.length - (entry.words.length - hits) * 0.01;
    if (score > (best.get(entry.code) ?? -1)) best.set(entry.code, score);
  }
  return [...best]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code, score]) => ({ code, label: romeLabel(code)!, score: Math.round(score * 100) / 100 }));
}
