import { normalizeText } from "@job-radar/skills";

/** Petits extracteurs de texte, réutilisés par la normalisation (étape 7). Ne devinent jamais : inconnu → null. */

export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead";

export type ContractKind = "CDI" | "CDD" | "INTERIM" | "ALTERNANCE" | "STAGE" | "FREELANCE";

/** Niveau lu dans le titre de l'annonce. */
export function detectSeniority(title: string): Seniority | null {
  // « futur lead », « évolution vers lead », « à terme lead » : une perspective, pas le poste actuel.
  const t = normalizeText(title).replace(
    /\b(futur(e|s)?|evolution( possible)? vers( un poste de| un role de| le role de| du)?|evolutif vers|a terme|potentiel(le)?|pouvant evoluer vers|avec evolution)\s+(en\s+)?(tech\s*lead|lead( dev(eloppeur)?)?|manager|architecte)\b/g,
    " ",
  );
  if (/\b(stage|stagiaire|intern(ship)?)\b/.test(t)) return "intern";
  if (/\b(lead|tech ?lead|principal|staff|head of|director|directeur|directrice)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?|confirme|expert|experimente)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|debutant|jeune diplome)\b/.test(t)) return "junior";
  return null;
}

/**
 * Années d'expérience demandées.
 * Gère : « 3 ans d'expérience », « 3 à 5 ans », « 3-5 ans », « minimum 2 ans », « 5+ ans », « 3 An(s) ».
 * Plusieurs mentions → on garde l'exigence la plus élevée (prudent).
 */
export function parseExperienceYears(text: string): { min: number; max: number | null } | null {
  const t = normalizeText(text);
  if (/debutant(e)? accepte/.test(t)) return { min: 0, max: null };
  const re =
    /(?:minimum\s+|au moins\s+|min\.?\s+)?(\d{1,2})\s*(?:\+|\s*(?:a|-|–)\s*(\d{1,2}))?\s*(?:an\(s\)|(?:ans?|annees?|years?)\b)/g;
  let best: { min: number; max: number | null } | null = null;
  for (const m of t.matchAll(re)) {
    const start = m.index ?? 0;
    const context = t.slice(Math.max(0, start - 60), start + m[0].length + 40);
    if (!/(experience|exp\b|minimum|au moins|exige|requis|souhaite|dans un poste|similaire|years)/.test(context)) continue;
    // « Disposant d'une expérience de plus de 20 ans en la matière » : l'ancienneté de l'ENTREPRISE, pas le poste.
    const before = t.slice(Math.max(0, start - 45), start);
    const after = t.slice(start + m[0].length, start + m[0].length + 25);
    if (/disposant d'une|forte? d'une|riche d'une|depuis|fondee|creee/.test(before) || /en la matiere|d'existence|d'histoire/.test(after)) continue;
    // « Matthieu, notre CTO qui a plus de 12 ans d'expérience » : l'expérience d'une personne de l'équipe, pas celle demandée.
    if (/\bqui (a|ont|possede|possedent|cumule|cumulent|compte|comptent)\b|\b(notre|nos|son|sa|leur|leurs|votre) (cto|ceo|fondateur|fondatrice|directeur|directrice|manager|associes?|equipes?|experts?|consultants?|formateurs?|coachs?)\b/.test(before)) continue;
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : null;
    if (min > 30) continue;
    if (!best || min > best.min) best = { min, max };
  }
  return best;
}

/** Type de contrat, à partir d'un libellé libre ou d'un code France Travail (CDI, CDD, MIS, LIB...). */
export function normalizeContract(value: string | null | undefined): ContractKind | null {
  if (!value) return null;
  const v = normalizeText(value).trim();
  if (/^cdi\b|contrat a duree indeterminee/.test(v)) return "CDI";
  if (/^cdd\b|contrat a duree determinee/.test(v)) return "CDD";
  if (/^(mis|tti)\b|interim|travail temporaire/.test(v)) return "INTERIM";
  if (/alternance|apprentissage|professionnalisation/.test(v)) return "ALTERNANCE";
  if (/^stage\b|stage$|internship/.test(v)) return "STAGE";
  if (/^lib\b|freelance|independant|liberal|portage/.test(v)) return "FREELANCE";
  return null;
}

/** Télétravail lu dans le texte. Rien trouvé → "unknown" (pas "sur site" : on ne devine pas). */
export function detectRemote(text: string): "remote" | "hybrid" | "onsite" | "unknown" {
  const t = normalizeText(text);
  if (/(100\s*%|full|totalement|entierement|complet)\s*(en\s*)?(teletravail|remote)|teletravail\s*(a\s*)?(100\s*%|complet|total)|full[\s-]?remote/.test(t)) {
    return "remote";
  }
  if (/teletravail|hybride|remote|travail a distance/.test(t)) {
    if (/(pas de|sans|aucun)\s+teletravail|teletravail\s+(non\s+)?(impossible|non autorise)/.test(t)) return "onsite";
    return "hybrid";
  }
  if (/100\s*%\s*(sur site|presentiel)|pas de teletravail/.test(t)) return "onsite";
  return "unknown";
}

/**
 * Contrat écrit dans le titre, quand la source ne le donne pas (fréquent chez Adzuna) :
 * « Développeur React - Freelance », « Stage développeur », « CDD 6 mois ».
 */
export function contractFromTitle(title: string): ContractKind | null {
  const t = normalizeText(title);
  if (/\b(freelance|free-lance|independant|portage salarial|\btjm\b)|\[mission\]/.test(t)) return "FREELANCE";
  if (/\b(alternance|alternant(e)?|apprenti(e|ssage)?|contrat pro)\b/.test(t)) return "ALTERNANCE";
  if (/\b(stage|stagiaire|internship|intern)\b/.test(t)) return "STAGE";
  if (/\b(interim|interimaire)\b/.test(t)) return "INTERIM";
  if (/\bcdd\b/.test(t)) return "CDD";
  if (/\bcdi\b/.test(t)) return "CDI";
  return null;
}
