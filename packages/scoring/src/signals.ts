import { extractSkills, normalizeText, type Skill } from "@job-radar/skills";

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

/**
 * Contrat lu dans la description, quand la source ne le donne pas : une ligne de contrat explicite
 * (« Type de contrat : Stage », « Contract: CDI », « Alternance / Apprentissage »), sinon un seul type cité dans tout le texte.
 * Ailleurs que sur une ligne de contrat, les mots ambigus (« mis en place », « lib », « apprentissage automatique ») ne comptent pas.
 */
export function contractFromText(text: string): ContractKind | null {
  const kindsIn = (value: string, label: boolean): Set<ContractKind> => {
    const found = new Set<ContractKind>();
    if (/\bcdi\b|contrat a duree indeterminee/.test(value)) found.add("CDI");
    if (/\bcdd\b|contrat a duree determinee/.test(value)) found.add("CDD");
    if ((label && /\b(mis|tti)\b/.test(value)) || /interim|travail temporaire/.test(value)) found.add("INTERIM");
    if (/alternance|contrat d'apprentissage|en apprentissage|professionnalisation/.test(value) || (label && /apprentissage/.test(value)))
      found.add("ALTERNANCE");
    if (/\bstage\b|stagiaire|internship/.test(value)) found.add("STAGE");
    if ((label && /\b(lib|liberal|tjm)\b/.test(value)) || /\b(freelance|free-lance|independant|portage salarial)\b/.test(value))
      found.add("FREELANCE");
    return found;
  };
  const lines = normalizeText(text)
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\s+[·•|]\s+/))
    .map((line) => line.replace(/^[\s*•·-]+|[\s.,;:!?]+$/g, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    const kinds = kindsIn(line, true);
    const isContractField = /^(type de contrat|contrat(?: de travail)?|employment type|contract(?: type)?)\s*[:=-]/.test(line);
    const isContractLabel =
      line.length <= 80 &&
      /^(?:cdi|cdd|mis|tti|interim|travail temporaire|alternance|apprentissage|professionnalisation|stage|stagiaire|internship|freelance|free-lance|independant|liberal|portage|tjm)(?:\s*(?:\/|,|ou|et)\s*(?:cdi|cdd|interim|alternance|apprentissage|stage|freelance|independant|portage))?$/.test(
        line,
      );
    if ((isContractField || isContractLabel) && kinds.size === 1) return [...kinds][0]!;
  }
  const kinds = kindsIn(normalizeText(text), false);
  return kinds.size === 1 ? [...kinds][0]! : null;
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

/**
 * Contrat d'une offre, la même règle partout (score, analyse IA, pastille affichée) :
 * un titre qui dit Stage / Alternance / Freelance l'emporte sur le champ de la source (souvent rempli par défaut) ;
 * sinon le champ de la source, puis le titre, puis la description. Pour CDD / CDI, la source reste prioritaire
 * (« CDI » + titre « (CDD possible) » = CDI).
 */
export function contractOfJob(job: { contractType: string | null; title: string; description: string }): ContractKind | null {
  const fromTitle = contractFromTitle(job.title);
  if (fromTitle === "STAGE" || fromTitle === "ALTERNANCE" || fromTitle === "FREELANCE") return fromTitle;
  return normalizeContract(job.contractType) ?? fromTitle ?? contractFromText(job.description);
}

/** « 3 ans d'expérience minimum sur ces environnements », « 3 years of experience working with these technologies ». */
const PRODUCT_ANAPHORA =
  /^[^,]{0,30}?\b(sur|avec|dans|with|on|in|using)\s+(ces|cet|cette|ce|these|those|this|such)\s+(environnements?|solutions?|technologies?|technos?|outils|produits?|logiciels?|progiciels?|plateformes?|environments?|tools|products?|platforms?)\b/;

/**
 * Années d'expérience exigées sur des technos / produits précis : « 3 ans d'expérience sur Angular », ou
 * « … sur ces environnements » qui renvoie aux produits du titre et des deux phrases d'avant.
 * Renvoie les compétences visées (le score garde celles absentes du profil) et le nombre d'années, ou null.
 */
export function productExperienceRequired(title: string, description: string, extraSkills: Skill[] = []): { ids: string[]; years: number } | null {
  // Phrases : coupure après . ! ? ; suivi d'un espace (« Vue.js » reste entier) ou à la ligne.
  const sentences = description.split(/(?<=[.!?;])\s+|\n+/).map(normalizeText);
  const ids = new Set<string>();
  let years = 0;
  sentences.forEach((s, i) => {
    if (!/experience/.test(s) || /un plus|apprecie|idealement|serait un atout|bonus|nice to have/.test(s)) return;
    const m = s.match(/(\d{1,2})\s*\+?\s*(?:ans?|annees?|years?)\b/);
    const n = Number(m?.[1]);
    if (!m || n < 1 || n > 15) return;
    const tail = s.slice((m.index ?? 0) + m[0].length);
    // ponytail: texte sans majuscules, donc les alias sensibles à la casse (« Vue ») ne sont pas vus ici.
    const found = extractSkills(tail.slice(0, 80), extraSkills);
    if (PRODUCT_ANAPHORA.test(tail)) found.push(...extractSkills([title, sentences[i - 1] ?? "", sentences[i - 2] ?? ""].join("\n"), extraSkills));
    if (!found.length) return;
    found.forEach((id) => ids.add(id));
    years = Math.max(years, n);
  });
  return ids.size ? { ids: [...ids], years } : null;
}

/** « un plus », « apprécié », « nice to have » : ce qui suit n'est pas exigé. */
const OPTIONAL = /un plus|apprecie|idealement|serait un atout|bonus|nice to have|strongly preferred|would be a plus/;

/**
 * L'annonce coupée en deux : ce qui est exigé, et ce qui est présenté comme un plus (phrases « … un plus », et rubriques
 * « Un plus / Nice to have » jusqu'au titre de rubrique suivant : ligne courte, sans puce ni point final).
 */
export function splitRequired(description: string): { required: string; optional: string } {
  let section = false;
  const required: string[] = [];
  const optional: string[] = [];
  // Par phrase : une annonce en un seul paragraphe ne devient pas « un plus » en entier pour un mot « apprécié ».
  for (const line of description.split(/\n+|(?<=[.!?;])\s+/)) {
    const t = normalizeText(line).trim();
    const heading = t.length > 0 && t.length <= 60 && !/^[•·*-]/.test(t) && !/[.,;]$/.test(t); // « Un plus : » est un titre
    if (heading) section = OPTIONAL.test(t);
    (section || OPTIONAL.test(t) ? optional : required).push(line);
  }
  return { required: required.join("\n"), optional: optional.join("\n") };
}

/** Anglais courant ou bilingue exigé, ou candidature en anglais. Les lignes « un plus » ne comptent pas. */
export function fluentEnglishRequired(description: string): boolean {
  const t = normalizeText(splitRequired(description).required);
  return /\b(fluent|fluency in|bilingual|native)\s+(in\s+)?english\b|\benglish\b[^.\n]{0,20}\b(fluent|fluency|bilingual|courant|native)\b|\banglais\s+(courant|bilingue|fluide|professionnel courant|parfait|natif)\b|\bbilingue\s+(en\s+)?anglais\b|\bapply in english\b|\bcandidat(ure|ez|er) en anglais\b/.test(
    t,
  );
}
