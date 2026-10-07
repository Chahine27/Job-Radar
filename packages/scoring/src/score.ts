import { neighborDepartments, type Profile, type RemoteType } from "@job-radar/shared";
import { extractSkills, getSkill, resolveSkill } from "@job-radar/skills";
import { DEFAULT_RULES, type ScoringRules } from "./rules";
import { salaryOfJob } from "./salary";
import { contractOfJob, detectSeniority, normalizeContract, type Seniority } from "./signals";

/** Ce dont le score a besoin. Les champs inconnus sont `null` — jamais devinés. */
export type ScoringInput = {
  title: string;
  description: string;
  /** Compétences déjà listées par la source, en plus du texte. */
  technologies?: string[];
  contractType: string | null;
  experienceMinYears: number | null;
  /** Si absent, déduit du titre. */
  seniority?: Seniority | null;
  /** Salaire annuel brut en euros. */
  salaryMin: number | null;
  salaryMax: number | null;
  department: string | null;
  remoteType: RemoteType;
  /** Durée porte-à-porte estimée, en minutes. null = non calculé. */
  travelMinutes: number | null;
  /** Distance à vol d'oiseau entre le point de départ et l'offre, en km. null/absent = inconnue. */
  distanceKm?: number | null;
  /**
   * Compétences lues par l'IA (analyse à jour) : exigées et « un plus ». Si présentes, le critère Technique
   * est calculé sur elles (les « plus » comptent moitié) au lieu des mots-clés trouvés dans le texte.
   */
  aiSkills?: { required: string[]; bonus: string[] } | null;
};

export type Breakdown = {
  technical: number;
  experience: number;
  contract: number;
  salary: number;
  location: number;
  transport: number;
};

export type ScoreResult = {
  final: number;
  breakdown: Breakdown;
  /** Pourquoi ça correspond. */
  reasons: string[];
  /** Points de vigilance. */
  warnings: string[];
  /** Compétences de l'offre que tu as. */
  matchedSkills: string[];
  /** Mots-clés de l'offre absents de ton profil (pistes pour le CV / la lettre). */
  missingSkills: string[];
  /** Tes compétences préférées présentes : servent à départager deux offres de même score. */
  preferredSkills: string[];
  /** Offre gardée en base mais masquée du flux principal. */
  hidden: boolean;
  hiddenReason: string | null;
  rulesVersion: string;
  /** Moyenne pondérée des critères, avant les plafonds. */
  weighted: number;
  /** Plafond appliqué (critère bloquant), sinon null. */
  capLabel: string | null;
};

type Part = { score: number; reasons: string[]; warnings: string[] };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const k = (n: number) => `${Math.round(n / 1000)}k`;

// ───────── Technique ─────────
// Pourcentage des compétences de l'offre que tu maîtrises (outils compris).

function scoreTechnical(input: ScoringInput, profile: Profile, rules: ScoringRules) {
  const owned = profile.skills.map(resolveSkill);
  const preferred = profile.preferredTechs.map((p) => resolveSkill(p.name));
  const customSkills = [...owned, ...preferred].filter((s) => s.id.startsWith("custom:"));
  const text = [input.title, input.description, ...(input.technologies ?? [])].join("\n");
  const found = extractSkills(text, customSkills);

  const label = (id: string) =>
    getSkill(id)?.label ?? customSkills.find((s) => s.id === id)?.label ?? id;
  const ownedIds = new Set(owned.map((s) => s.id));
  const preferredIds = new Set(preferred.map((s) => s.id));

  // Compétences lues par l'IA : exigées (poids 1) et « un plus » (poids ½).
  const ai = input.aiSkills;
  if (ai && ai.required.length + ai.bonus.length > 0) {
    const idsOf = (labels: string[]) => [
      ...new Set(
        labels.flatMap((l) => {
          const ex = extractSkills(l, customSkills);
          return ex.length ? ex : [resolveSkill(l).id];
        }),
      ),
    ];
    const req = idsOf(ai.required);
    const bonus = idsOf(ai.bonus).filter((id) => !req.includes(id));
    const aiLabel = (id: string) => {
      const known = getSkill(id)?.label ?? customSkills.find((c) => c.id === id)?.label;
      if (known) return known;
      return [...ai.required, ...ai.bonus].find((l) => resolveSkill(l).id === id) ?? id;
    };
    const reqOk = req.filter((id) => ownedIds.has(id));
    const bonusOk = bonus.filter((id) => ownedIds.has(id));
    const total = req.length + bonus.length / 2;
    const part: Part = { score: clamp((100 * (reqOk.length + bonusOk.length / 2)) / total), reasons: [], warnings: [] };
    if (req.length) part.reasons.push(`${reqOk.length}/${req.length} compétences exigées dans ton profil (lu par l'IA)`);
    if (bonus.length) part.reasons.push(`${bonusOk.length}/${bonus.length} « plus » dans ton profil`);
    const matchedAi = [...reqOk, ...bonusOk].map(aiLabel);
    const missingAi = [...req, ...bonus].filter((id) => !ownedIds.has(id)).map(aiLabel);
    if (matchedAi.length) part.reasons.push(`Tu as : ${matchedAi.join(", ")}`);
    const missingReq = req.filter((id) => !ownedIds.has(id)).map(aiLabel);
    if (missingReq.length) {
      part.warnings.push(`Compétences exigées absentes de ton profil : ${missingReq.join(", ")} — à ajouter au CV si tu les maîtrises`);
    }
    const allIds = [...req, ...bonus];
    return {
      part,
      matched: matchedAi,
      missing: missingAi,
      preferredFound: allIds.filter((id) => preferredIds.has(id)).map(aiLabel),
    };
  }

  const matched = found.filter((id) => ownedIds.has(id)).map(label);
  const missing = found.filter((id) => !ownedIds.has(id)).map(label);
  const preferredFound = found.filter((id) => preferredIds.has(id)).map(label);

  const part: Part = { score: rules.neutral, reasons: [], warnings: [] };
  if (found.length === 0) {
    part.score = rules.neutral;
    part.warnings.push("Aucune compétence reconnue dans l'annonce");
  } else {
    part.score = clamp((100 * matched.length) / found.length);
    part.reasons.push(`${matched.length}/${found.length} compétences de l'offre dans ton profil`);
  }
  if (matched.length) part.reasons.push(`Tu as : ${matched.join(", ")}`);
  if (missing.length) {
    part.warnings.push(
      `Mots-clés absents de ton profil : ${missing.join(", ")} — à ajouter au CV si tu les maîtrises`,
    );
  }
  return { part, matched, missing, preferredFound };
}

// ───────── Expérience ─────────

function scoreExperience(input: ScoringInput, profile: Profile, rules: ScoringRules): Part {
  const seniority = input.seniority !== undefined ? input.seniority : detectSeniority(input.title);
  const years = input.experienceMinYears;
  const { experienceMin: min, experienceMax: max } = profile;
  const part: Part = { score: rules.neutral, reasons: [], warnings: [] };

  let byYears: number | null = null;
  if (years !== null) {
    if (years < max) byYears = 100;
    else if (years === max) byYears = 85;
    else if (years === max + 1) byYears = 65;
    else if (years <= max + 4) byYears = 35;
    else byYears = 10;

    if (years <= max) part.reasons.push(years === 0 ? "Débutant accepté" : `${years} an(s) d'expérience demandé(s)`);
    else part.warnings.push(`Demande ${years} ans d'expérience (ta cible : ${min} à ${max})`);
  }

  let bySeniority: number | null = null;
  if (seniority === "junior") bySeniority = 100;
  else if (seniority === "senior") bySeniority = 30;
  else if (seniority === "lead") bySeniority = 15;
  else if (seniority === "intern") bySeniority = 20;

  if (seniority === "junior" && byYears === null) part.reasons.push("Poste junior");
  if (seniority === "senior") part.warnings.push("Poste indiqué senior / confirmé");
  if (seniority === "lead") part.warnings.push("Poste de lead / direction");
  if (seniority === "intern") part.warnings.push("Annonce de stage");

  const known = [byYears, bySeniority].filter((n): n is number => n !== null);
  if (known.length === 0) {
    part.warnings.push("Expérience demandée non précisée");
  } else {
    part.score = Math.min(...known); // l'exigence la plus stricte l'emporte
  }
  return part;
}

// ───────── Contrat ─────────

const contractOf = (input: ScoringInput) => contractOfJob(input);

function scoreContract(input: ScoringInput, profile: Profile, rules: ScoringRules): Part {
  const kind = contractOf(input);
  if (!kind) return { score: rules.neutral, reasons: [], warnings: ["Type de contrat non précisé"] };
  const wanted = profile.contracts.map((c) => normalizeContract(c) ?? c.toUpperCase());
  if (wanted.includes(kind)) return { score: 100, reasons: [kind], warnings: [] };
  return { score: 10, reasons: [], warnings: [`Contrat ${kind} (tu cherches : ${profile.contracts.join(", ")})`] };
}

// ───────── Salaire ─────────

function scoreSalary(job: ScoringInput, profile: Profile, rules: ScoringRules): Part {
  // Salaire de la source, sinon lu dans l'annonce (« Salaire : 2 200 € brut mensuel »).
  const input = { ...job, ...salaryOfJob(job) };
  const raw = input.salaryMax ?? input.salaryMin;
  // Moins de 8 000 €/an : ce n'est pas un salaire annuel (souvent un taux journalier de freelance) → inconnu.
  const ref = raw !== null && raw >= 8000 ? raw : null;
  if (ref === null) return { score: rules.unknownSalary, reasons: [], warnings: ["Salaire non communiqué"] };

  const label =
    input.salaryMin !== null && input.salaryMax !== null && input.salaryMin !== input.salaryMax
      ? `${k(input.salaryMin)}–${k(input.salaryMax)}`
      : k(ref);
  const target = profile.salaryTarget;
  const minimum = profile.salaryMinimum ?? target;
  if (target === null || minimum === null) return { score: rules.neutral, reasons: [`Salaire ${label}`], warnings: [] };

  if (ref >= target + 5000) return { score: 100, reasons: [`Salaire ${label}`], warnings: [] };
  if (ref >= target) return { score: 95, reasons: [`Salaire ${label}`], warnings: [] };
  if (ref >= minimum) return { score: 80, reasons: [`Salaire ${label}`], warnings: [] };
  if (ref >= minimum - 3000) return { score: 50, reasons: [], warnings: [`Salaire ${label}, sous ton minimum de ${k(minimum)}`] };
  return { score: 20, reasons: [], warnings: [`Salaire ${label}, nettement sous ton minimum de ${k(minimum)}`] };
}

// ───────── Localisation ─────────

function scoreLocation(input: ScoringInput, profile: Profile, rules: ScoringRules): Part {
  if (input.remoteType === "remote") return { score: 100, reasons: ["Télétravail complet"], warnings: [] };
  const dept = input.department;
  const km = input.distanceKm ?? null;
  if (!dept && km === null) return { score: 50, reasons: [], warnings: ["Lieu de travail non précisé"] };
  const target = dept ? profile.locations.find((l) => l.department === dept) : undefined;
  if (target) return { score: 100, reasons: [`Dans ta zone : ${target.label}`], warnings: [] };
  const radius = profile.searchRadiusKm;
  if (radius !== null && km !== null && km <= radius) {
    return { score: 80, reasons: [`À ${Math.round(km)} km de ton point de départ (rayon ${radius} km)`], warnings: [] };
  }
  // Sans rayon, un département voisin d'une zone du profil est « proche » ; avec un rayon, c'est lui qui décide.
  if (
    radius === null &&
    dept &&
    (rules.nearbyDepartments.includes(dept) || profile.locations.some((l) => neighborDepartments(l.department).includes(dept)))
  ) {
    return { score: 60, reasons: [], warnings: [`Département ${dept}, proche de ta zone`] };
  }
  const where = dept ? `Département ${dept}` : "Lieu";
  return { score: 15, reasons: [], warnings: [`${where}, hors de ta zone${km !== null ? ` (${Math.round(km)} km)` : ""}`] };
}

// ───────── Transport ─────────

function scoreTransport(input: ScoringInput, rules: ScoringRules): Part {
  if (input.remoteType === "remote") return { score: 100, reasons: [], warnings: [] };
  const m = input.travelMinutes;
  if (m === null) return { score: rules.neutral, reasons: [], warnings: ["Temps de trajet non calculé"] };
  const est = `Trajet estimé à ${m} min`;
  if (m <= 30) return { score: 100, reasons: [est], warnings: [] };
  if (m <= 45) return { score: 85, reasons: [est], warnings: [] };
  if (m <= 60) return { score: 65, reasons: [], warnings: [est] };
  if (m <= 75) return { score: 40, reasons: [], warnings: [`${est} (fatigant)`] };
  if (m <= 90) return { score: 20, reasons: [], warnings: [`${est} (très fatigant)`] };
  return { score: 5, reasons: [], warnings: [`${est} (trop long au quotidien)`] };
}

// ───────── Score final ─────────

export function scoreJob(input: ScoringInput, profile: Profile, rules: ScoringRules = DEFAULT_RULES): ScoreResult {
  const tech = scoreTechnical(input, profile, rules);
  const parts = {
    technical: tech.part,
    experience: scoreExperience(input, profile, rules),
    contract: scoreContract(input, profile, rules),
    salary: scoreSalary(input, profile, rules),
    location: scoreLocation(input, profile, rules),
    transport: scoreTransport(input, rules),
  };
  const w = profile.scoringWeights;
  const breakdown: Breakdown = {
    technical: parts.technical.score,
    experience: parts.experience.score,
    contract: parts.contract.score,
    salary: parts.salary.score,
    location: parts.location.score,
    transport: parts.transport.score,
  };
  const weighted = clamp(
    breakdown.technical * w.technical +
      breakdown.experience * w.experience +
      breakdown.contract * w.contract +
      breakdown.salary * w.salary +
      breakdown.location * w.location +
      breakdown.transport * w.transport,
  );

  // Critères bloquants : on garde le plafond le plus bas atteint.
  let final = weighted;
  let capLabel: string | null = null;
  for (const c of rules.caps) {
    if (breakdown[c.part] <= c.atOrBelow && c.cap < final) {
      final = c.cap;
      capLabel = c.label;
    }
  }

  // Les compétences tiennent le reste : une absence de données reste neutre, jamais bloquante.
  const skillsKnown = tech.matched.length + tech.missing.length > 0;
  if (rules.technicalMargin !== null && skillsKnown) {
    const cap = breakdown.technical + rules.technicalMargin;
    if (cap < final) {
      final = cap;
      capLabel = `compétences trop peu correspondantes (${breakdown.technical} %) : le score ne dépasse pas les compétences + ${rules.technicalMargin} points`;
    }
  }

  let hiddenReason: string | null = null;
  const kind = contractOf(input);
  const seniority = input.seniority !== undefined ? input.seniority : detectSeniority(input.title);
  if (rules.hideNonMatchingContract && kind && breakdown.contract < 100) {
    hiddenReason = `Contrat ${kind} hors profil`;
  } else if (rules.hideSenior && (seniority === "senior" || seniority === "lead")) {
    hiddenReason = seniority === "lead" ? "Poste de lead / direction" : "Poste senior / confirmé";
  } else if (
    rules.hideYearsOverMax !== null &&
    input.experienceMinYears !== null &&
    input.experienceMinYears > profile.experienceMax + rules.hideYearsOverMax
  ) {
    hiddenReason = `Demande ${input.experienceMinYears} ans d'expérience`;
  } else if (rules.hideOutOfZone && breakdown.location <= 15) {
    hiddenReason = input.department ? `Hors de ta zone (département ${input.department})` : "Hors de ta zone";
  }

  const all = Object.values(parts);
  const warnings = all.flatMap((p) => p.warnings);
  if (capLabel) warnings.unshift(`Score plafonné à ${final} % : ${capLabel} (sinon ${weighted} %)`);
  return {
    final,
    breakdown,
    reasons: all.flatMap((p) => p.reasons),
    warnings,
    matchedSkills: tech.matched,
    missingSkills: tech.missing,
    preferredSkills: tech.preferredFound,
    hidden: hiddenReason !== null,
    hiddenReason,
    rulesVersion: rules.version,
    weighted,
    capLabel,
  };
}

/** Champs d'une offre en base utiles au score (évite de dupliquer la conversion ailleurs). */
export type ScorableJob = {
  title: string;
  description: string;
  technologies: string[];
  contractType: string | null;
  experienceMinYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  department: string | null;
  remoteType: RemoteType;
  travelMinutes: number | null;
};

export function scoringInputFromJob(job: ScorableJob): ScoringInput {
  return {
    title: job.title,
    description: job.description,
    technologies: job.technologies,
    contractType: job.contractType,
    experienceMinYears: job.experienceMinYrs,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    department: job.department,
    remoteType: job.remoteType,
    travelMinutes: job.travelMinutes,
  };
}
