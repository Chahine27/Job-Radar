import { distanceKm } from "@job-radar/routing";
import type { JobStatus, Profile } from "@job-radar/shared";
import { DEFAULT_RULES, hashProfile, scoreJob, scoringInputFromJob, type ScoreResult, type ScoringRules } from "@job-radar/scoring";
import { AI_SCORE_CAPS, type Adequation, analysisHash, isAbridged, readVerdict, toProfileInput } from "../ai-context";
import type { JobEdits, JobRow, Stores } from "../stores";

export { ABRIDGED_SOURCES, isAbridged } from "../ai-context";

/** Rubrique du flux : télétravail complet, lieu connu (dans ta zone ; hors zone = masquée), lieu non précisé. */
export type Zone = "local" | "remote" | "unknown";

export type JobFilters = {
  /** Une seule rubrique du flux ; absent = toutes. */
  zone?: Zone | undefined;
  minScore: number;
  /** "active" = tout sauf IGNORED / REJECTED / EXPIRED. */
  status: JobStatus | "active" | "all";
  includeHidden: boolean;
  q?: string | undefined;
  sort: "score" | "date";
  /** Seulement les offres trouvées par cette source (une offre vue sur 2 sources apparaît dans les 2). */
  source?: string | undefined;
};

export type JobSummary = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  department: string | null;
  zone: Zone;
  contractType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  remoteType: JobRow["remoteType"];
  publishedAt: Date | null;
  firstSeenAt: Date;
  status: JobStatus;
  sources: JobRow["sources"];
  score: Pick<ScoreResult, "final" | "breakdown" | "hidden" | "hiddenReason">;
  matchedSkills: string[];
  missingSkills: string[];
  preferredSkills: string[];
  /** La source ne donne qu'un extrait (Adzuna, Jooble) : score approximatif, pas vérifié par l'IA. */
  abridged: boolean;
  /** Avis de l'IA locale (analyse à jour) ; `before` = score avant correction quand l'IA l'a baissé. */
  ai: { adequation: Adequation; avis: string; before: number | null } | null;
};

export type JobDetail = JobSummary & {
  description: string;
  experienceText: string | null;
  address: string | null;
  travelMinutes: number | null;
  /** « transit » = transports en commun (PRIM), « car » = voiture (IGN). */
  travelMode: "transit" | "car" | null;
  reasons: string[];
  warnings: string[];
  rulesVersion: string;
  /** La source ne donne qu'un extrait (Adzuna, Jooble) et l'annonce complète n'a pas été collée. */
  abridged: boolean;
  /** Date où l'annonce complète a été collée. */
  fullTextAt: Date | null;
  /** Corrections saisies à la main (priment sur la source) et leur date. */
  userEditsAt: Date | null;
  userEdits: JobEdits | null;
  /** Comment le score final est obtenu (moyenne, puis plafonds). */
  scoreSteps: Array<{ label: string; value: number }>;
  /** Critère Technique calculé sur les compétences lues par l'IA. */
  aiSkills: boolean;
};


const INACTIVE: JobStatus[] = ["IGNORED", "REJECTED", "EXPIRED"];
/** Hors du flux « Actives » : les offres inactives et celles où tu as déjà postulé (page « Candidatures »). */
const OUT_OF_FEED: JobStatus[] = [...INACTIVE, "APPLIED"];
export const MANUAL_SOURCE = "manual";
const isManual = (j: { sources: Array<{ source: string }> }) => j.sources.some((s) => s.source === MANUAL_SOURCE);

type Verdict = { adequation: Adequation; avis: string; experience: number | null; required: string[]; bonus: string[] } | null;
const aiSkillsOf = (v: Verdict) => (v && v.required.length + v.bonus.length > 0 ? { required: v.required, bonus: v.bonus } : null);

/**
 * Quand l'IA a lu l'annonce (analyse à jour), c'est SON expérience demandée qui compte pour le score :
 * les règles se trompent sur les annonces ambiguës (« Exp. 1 à 7 ans » + « Exp. + 7 ans »).
 */
const withAiExperience = (job: JobRow, v: Verdict): JobRow =>
  // Expérience corrigée à la main : elle prime sur celle lue par l'IA.
  v && v.experience !== null && job.userEdits?.experienceMinYrs === undefined && (v.experience !== job.experienceMinYrs || !job.experienceText)
    ? {
        ...job,
        experienceMinYrs: v.experience,
        experienceText: v.experience === 0 ? "débutant accepté (lu par l'IA)" : `${v.experience} an${v.experience > 1 ? "s" : ""} minimum (lu par l'IA)`,
      }
    : job;

/** « Développeur Java / Angular F/H » et « DEVELOPPEUR JAVA/ANGULAR (H/F) » → même clé. */
const sameKey = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\(?\b[hf]\s*\/\s*[hf]\b\)?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const zoneOf = (job: JobRow): Zone => (job.remoteType === "remote" ? "remote" : job.department || job.latitude !== null ? "local" : "unknown");

function toSummary(job: JobRow, s: ScoreResult, verdict: Verdict = null): JobSummary {
  const cap = verdict ? AI_SCORE_CAPS[verdict.adequation] : 100;
  const final = Math.min(s.final, cap);
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    city: job.city,
    department: job.department,
    zone: zoneOf(job),
    contractType: job.contractType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryText: job.salaryText,
    remoteType: job.remoteType,
    publishedAt: job.publishedAt,
    firstSeenAt: job.firstSeenAt,
    status: job.status,
    sources: job.sources,
    score: { final, breakdown: s.breakdown, hidden: s.hidden, hiddenReason: s.hiddenReason },
    matchedSkills: s.matchedSkills,
    missingSkills: s.missingSkills,
    preferredSkills: s.preferredSkills,
    ai: verdict ? { adequation: verdict.adequation, avis: verdict.avis, before: final < s.final ? s.final : null } : null,
    abridged: isAbridged(job),
  };
}

/**
 * Calcule les scores à la volée (fonction pure, rapide) avec un cache mémoire :
 * une offre n'est recalculée que si son contenu, le profil ou les règles changent.
 */
export function createJobService(stores: Stores, rules: ScoringRules = DEFAULT_RULES, opts: { aiModel?: string } = {}) {
  const cache = new Map<string, ScoreResult>();
  // Point de départ de chaque profil chargé : le rayon de recherche en dépend (il n'est pas dans le hash du profil).
  const homes = new WeakMap<Profile, { lat: number; lng: number } | null>();

  function scoreOf(job: JobRow, profile: Profile, profileHash: string, v: Verdict = null): ScoreResult {
    const aiSkills = aiSkillsOf(v);
    const aiKey = aiSkills ? `${aiSkills.required.join("|")}#${aiSkills.bonus.join("|")}` : "-";
    const home = homes.get(profile) ?? null;
    const km = home && job.latitude !== null && job.longitude !== null ? distanceKm(home, { lat: job.latitude, lng: job.longitude }) : null;
    const key = `${job.id}:${job.contentHash}:${job.experienceMinYrs ?? "-"}:${job.travelMinutes ?? "-"}:${aiKey}:${profileHash}:${rules.version}:${km === null ? "-" : Math.round(km)}`;
    let s = cache.get(key);
    if (!s) {
      s = scoreJob({ ...scoringInputFromJob(job), aiSkills, distanceKm: km }, profile, rules);
      if (cache.size > 20_000) cache.clear();
      cache.set(key, s);
    }
    return s;
  }

  async function loadProfile(userId: string) {
    const rec = await stores.profiles.get(userId);
    if (!rec) throw Object.assign(new Error("Profil introuvable"), { statusCode: 404 });
    homes.set(rec.profile, rec.home);
    return { profile: rec.profile, hash: hashProfile(rec.profile) };
  }

  /**
   * Avis de l'IA pour chaque offre, seulement si l'analyse est à jour (même annonce, même profil, même CV,
   * même modèle) : une analyse dépassée ne corrige plus le score.
   */
  async function loadVerdicts(userId: string, profile: Profile): Promise<(job: JobRow) => Verdict> {
    const model = opts.aiModel;
    if (!model) return () => null;
    const [analyses, kit] = await Promise.all([stores.analyses.latestAll(), stores.letterKits.get(userId)]);
    if (analyses.size === 0) return () => null;
    const input = toProfileInput(profile, kit);
    return (job) => {
      const a = analyses.get(job.id);
      // Analyse faite sur un extrait : elle ne corrige pas le score (elle serait biaisée).
      if (!a || isAbridged(job) || a.inputHash !== analysisHash(job, input, model)) return null;
      return readVerdict(a.result);
    };
  }

  return {
    async list(userId: string, f: JobFilters): Promise<JobSummary[]> {
      const { profile, hash } = await loadProfile(userId);
      const verdictOf = await loadVerdicts(userId, profile);
      const q = f.q?.trim().toLowerCase();
      const items = (await stores.jobs.list())
        .filter((j) => (f.status === "all" ? true : f.status === "active" ? !OUT_OF_FEED.includes(j.status) : j.status === f.status))
        .filter((j) => !q || `${j.title} ${j.company ?? ""} ${j.city ?? ""}`.toLowerCase().includes(q))
        .filter((j) => !f.source || j.sources.some((s) => s.source === f.source))
        .map((j) => {
          const v = verdictOf(j);
          const jj = withAiExperience(j, v);
          return toSummary(jj, scoreOf(jj, profile, hash, v), v);
        })
        .filter((s) => !f.zone || s.zone === f.zone)
        .filter((s) => s.score.final >= f.minScore)
        // Une offre ajoutée à la main n'est jamais masquée : tu l'as choisie. Sauf hors de ta zone :
        // l'extension sert souvent à évaluer une offre sans vouloir la garder dans le flux.
        .filter((s) => f.includeHidden || !s.score.hidden || (isManual(s) && s.score.breakdown.location > 15));

      const date = (s: JobSummary) => (s.publishedAt ?? s.firstSeenAt).getTime();
      items.sort((a, b) =>
        f.sort === "date"
          ? date(b) - date(a)
          : b.score.final - a.score.final || b.preferredSkills.length - a.preferredSkills.length || date(b) - date(a),
      );
      return items;
    },

    /**
     * Candidatures : offres « Postulé », et celles refusées après une candidature, la plus récente d'abord.
     * `appliedAt` = date où tu as marqué l'offre comme postulée.
     */
    async listApplications(userId: string): Promise<Array<JobSummary & { appliedAt: Date | null }>> {
      const { profile, hash } = await loadProfile(userId);
      const verdictOf = await loadVerdicts(userId, profile);
      const applied = await stores.jobs.appliedDates();
      return (await stores.jobs.list())
        .filter((j) => j.status === "APPLIED" || (j.status === "REJECTED" && applied.has(j.id)))
        .map((j) => {
          const v = verdictOf(j);
          const jj = withAiExperience(j, v);
          return { ...toSummary(jj, scoreOf(jj, profile, hash, v), v), appliedAt: applied.get(j.id) ?? null };
        })
        .sort((a, b) => (b.appliedAt?.getTime() ?? 0) - (a.appliedAt?.getTime() ?? 0));
    },

    /** Offres ajoutées à la main, les plus récentes d'abord. */
    async listManual(userId: string): Promise<JobSummary[]> {
      const { profile, hash } = await loadProfile(userId);
      const verdictOf = await loadVerdicts(userId, profile);
      return (await stores.jobs.list())
        .filter(isManual)
        .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
        .map((j) => {
          const v = verdictOf(j);
          const jj = withAiExperience(j, v);
          return toSummary(jj, scoreOf(jj, profile, hash, v), v);
        });
    },

    async get(userId: string, id: string): Promise<JobDetail | null> {
      const job = await stores.jobs.get(id);
      if (!job) return null;
      const { profile, hash } = await loadProfile(userId);
      const verdict = (await loadVerdicts(userId, profile))(job);
      const scored = withAiExperience(job, verdict);
      const s = scoreOf(scored, profile, hash, verdict);
      const summary = toSummary(scored, s, verdict);
      // Détail du calcul : moyenne des critères, puis plafonds (règles, puis avis de l'IA).
      const scoreSteps: Array<{ label: string; value: number }> = [{ label: "Moyenne pondérée des critères", value: s.weighted }];
      if (s.capLabel) scoreSteps.push({ label: `Plafond : ${s.capLabel}`, value: s.final });
      if (summary.ai?.before != null) scoreSteps.push({ label: `Plafond IA : adéquation ${summary.ai.adequation}`, value: summary.score.final });
      const aiWarning =
        summary.ai?.before != null
          ? [`Score ramené de ${summary.ai.before} à ${summary.score.final} % par l'IA (adéquation ${summary.ai.adequation}) : ${summary.ai.avis}`]
          : [];
      return {
        ...summary,
        description: job.description,
        experienceText: scored.experienceText,
        address: job.address,
        travelMinutes: job.travelMinutes,
        travelMode: job.travelMode ?? null,
        reasons: s.reasons,
        warnings: [...aiWarning, ...s.warnings],
        rulesVersion: s.rulesVersion,
        abridged: isAbridged(job),
        fullTextAt: job.fullTextAt,
        userEditsAt: job.userEditsAt ?? null,
        userEdits: job.userEdits ?? null,
        scoreSteps,
        aiSkills: !!aiSkillsOf(verdict),
      };
    },

    /**
     * Offre déjà connue par un simple extrait (Adzuna, Jooble) qui correspond à la page envoyée par l'extension
     * ou collée à la main : même annonce Adzuna (numéro dans l'adresse), sinon même titre + même entreprise.
     */
    async findAbridged(page: { url?: string | undefined; title?: string | undefined; company?: string | undefined }): Promise<JobRow | null> {
      const candidates = (await stores.jobs.list()).filter(isAbridged);
      const adId = page.url?.match(/adzuna\.[a-z.]+\/(?:[^?#]*\/)?(?:details|ad)\/(\d{6,})/i)?.[1];
      if (adId) {
        const re = new RegExp(`/(?:details|ad)/${adId}(?:\\D|$)`);
        const hit = candidates.find((j) => j.sources.some((src) => src.source === "adzuna" && re.test(src.url)));
        if (hit) return hit;
      }
      if (!page.title || !page.company) return null;
      const t = sameKey(page.title);
      const c = sameKey(page.company);
      return candidates.find((j) => sameKey(j.title) === t && sameKey(j.company ?? "") === c) ?? null;
    },

    /**
     * Parmi les offres affichées, celles à faire vérifier par l'IA : score (avant correction) au-dessus du seuil,
     * pas masquée, et pas d'analyse à jour.
     */
    async autoCandidates(userId: string, ids: string[], threshold: number): Promise<string[]> {
      if (!opts.aiModel) return [];
      const { profile, hash } = await loadProfile(userId);
      const verdictOf = await loadVerdicts(userId, profile);
      const out: string[] = [];
      for (const id of ids) {
        const job = await stores.jobs.get(id);
        if (!job || OUT_OF_FEED.includes(job.status)) continue;
        const s = scoreOf(job, profile, hash);
        // Un extrait (Adzuna, Jooble) biaiserait l'IA : on attend l'annonce complète.
        if (isAbridged(job)) continue;
        if (s.final >= threshold && (!s.hidden || isManual(job)) && !verdictOf(job)) out.push(id);
      }
      return out;
    },

    async setStatus(userId: string, id: string, status: JobStatus): Promise<JobDetail | null> {
      const row = await stores.jobs.setStatus(id, status);
      return row ? this.get(userId, id) : null;
    },
  };
}

export type JobService = ReturnType<typeof createJobService>;
