import type { JobStatus, Profile, RemoteType } from "@job-radar/shared";

export type { JobStatus, Profile, RemoteType };

export type Breakdown = {
  technical: number;
  experience: number;
  contract: number;
  salary: number;
  location: number;
  transport: number;
};

/** Infos corrigées à la main : un champ absent garde la valeur de la source. */
export type JobEdits = Partial<{
  title: string;
  company: string;
  city: string;
  department: string;
  contractType: string;
  remoteType: RemoteType;
  salaryMin: number;
  salaryMax: number;
  experienceMinYrs: number;
}>;

export type JobSummary = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  department: string | null;
  zone: "local" | "remote" | "unknown";
  contractType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  remoteType: RemoteType;
  publishedAt: string | null;
  firstSeenAt: string;
  status: JobStatus;
  sources: Array<{ source: string; url: string }>;
  score: { final: number; breakdown: Breakdown; hidden: boolean; hiddenReason: string | null };
  matchedSkills: string[];
  missingSkills: string[];
  preferredSkills: string[];
  /** La source ne donne qu'un extrait (Adzuna, Jooble) : score approximatif, pas vérifié par l'IA. */
  abridged: boolean;
  /** Avis de l'IA locale ; `before` = score avant correction quand l'IA l'a baissé. */
  ai: { adequation: "forte" | "moyenne" | "faible"; avis: string; before: number | null } | null;
};

/** Vérification automatique des meilleures offres affichées. */
export type AutoCheckStatus = { enabled: boolean; threshold: number; pending: string[]; offline: boolean; message: string | null };

export type JobDetail = JobSummary & {
  description: string;
  experienceText: string | null;
  /** Adresse du lieu de travail (trajet calculé jusqu'à elle). */
  address: string | null;
  travelMinutes: number | null;
  /** « transit » = transports en commun (PRIM), « car » = voiture (IGN). */
  travelMode?: "transit" | "car" | null;
  reasons: string[];
  warnings: string[];
  rulesVersion: string;
  /** Pourquoi le trajet n'a pas pu être calculé (null si calculé ou sans objet). */
  travelIssue?: string | null;
  /** Date où l'annonce complète a été collée. */
  fullTextAt: string | null;
  /** Corrections saisies à la main (priment sur la source). */
  userEditsAt: string | null;
  userEdits: JobEdits | null;
  /** Comment le score final est obtenu (moyenne, puis plafonds). */
  scoreSteps: Array<{ label: string; value: number }>;
  /** Critère Technique calculé sur les compétences lues par l'IA. */
  aiSkills: boolean;
};

export type HomeLocation = { label: string; lat: number; lng: number };

export type ProfileRecord = { profile: Profile; home: HomeLocation | null; updatedAt: string };

export type SourceStatus = {
  source: string;
  enabled: boolean;
  intervalMinutes: number;
  failures: number;
  lastSuccessAt: string | null;
  nextRunAt: string;
  lastStatus: string | null;
  lastError: string | null;
};

export type CollectionStatus = {
  running: boolean;
  lastRun: {
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    fetched: number;
    created: number;
    duplicates: number;
  } | null;
  sources: SourceStatus[];
  newJobs: number;
};

export type NotificationSettings = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  emailTo: string | null;
  emailConfigured: boolean;
  pushConfigured: boolean;
  vapidPublicKey: string | null;
  subscriptions: number;
};

export type SourceItem = {
  source: string;
  label: string;
  /** Sources à quota limité (Jooble) : appels utilisés / limite. */
  quota?: { used: number; limit: number } | null;
  enabled: boolean;
  intervalMinutes: number;
  minIntervalMinutes: number;
  configured: boolean;
  failures: number;
  lastSuccessAt: string | null;
  nextRunAt: string;
  lastStatus: string | null;
  lastError: string | null;
  lastRunAt: string | null;
};


export type LeadStatus = "TO_CONTACT" | "CONTACTED" | "FOLLOWED_UP" | "INTERVIEW" | "NOT_INTERESTED" | "IGNORED";

export type Lead = {
  id: string;
  siret: string;
  name: string;
  officeName: string | null;
  nafLabel: string | null;
  headcountMin: number | null;
  headcountMax: number | null;
  city: string | null;
  postcode: string | null;
  department: string | null;
  hiringPotential: number | null;
  isHighPotential: boolean;
  hasEmail: boolean;
  contactEmail: string | null;
  /** Adresse exacte (API Recherche d'entreprises) ; null si inconnue ou pas encore cherchée. */
  address: string | null;
  addressCheckedAt: string | null;
  status: LeadStatus;
  notes: string | null;
  contactedAt: string | null;
  /** Distance à vol d'oiseau depuis le lieu de recherche (null en mode départements). */
  distanceKm: number | null;
  firstSeenAt: string;
};

export type SpontaneousSettings = Profile["spontaneous"];

/** Candidature spontanée préparée pour une entreprise (lettre IA + email). */
export type SpontaneousApplicationState = {
  lead: Lead;
  title: string;
  application: {
    letter: string;
    model: string;
    edited: boolean;
    sentAt: string | null;
    sentTo: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  upToDate: boolean;
  kitReady: boolean;
  warnings: string[];
  mail: { configured: boolean; from: string | null };
  cvPdf: { path: string; found: boolean };
  letterPdfName: string;
  defaults: { subject: string; message: string };
  sentAt?: string;
};

/** Formulaire « Ajouter une offre » (champs vides = non envoyés). */
export type ManualJobForm = {
  url?: string;
  title: string;
  company?: string;
  location?: string;
  address?: string;
  contractType?: "CDI" | "CDD" | "INTERIM" | "ALTERNANCE" | "STAGE" | "FREELANCE" | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  remoteType?: RemoteType;
  experienceYears?: number | null;
  description: string;
};

/** Annonce lue par l'IA locale : champs rangés + texte nettoyé. */
export type AiReadResult = { fields: Omit<JobTextAnalysis, "text"> & { address: string | null }; text: string; model: string; durationMs: number };

/** Ce que l'appli a lu dans une annonce collée (sans IA). null = pas trouvé avec certitude. */
export type JobTextAnalysis = {
  text: string;
  title: string | null;
  company: string | null;
  location: string | null;
  contractType: ManualJobForm["contractType"];
  remoteType: RemoteType;
  salaryMin: number | null;
  salaryMax: number | null;
  experienceYears: number | null;
  skills: string[];
};

/** Analyse d'une offre par l'IA locale (Ollama). */
export type AiAnalysis = {
  resume: string;
  missions: string[];
  competences_obligatoires: string[];
  competences_bonus: string[];
  niveau: "junior" | "confirme" | "senior" | "inconnu";
  experience_min_ans: number | null;
  employeur: "direct" | "cabinet_ou_client" | "esn_ou_cabinet" | "inconnu";
  points_attention: string[];
  adequation: "forte" | "moyenne" | "faible";
  avis: string;
};
export type StoredAiAnalysis = { inputHash: string; model: string; result: AiAnalysis; createdAt: string };
export type AiStatus = { available: boolean; model: string | null; installed?: boolean; message?: string };

/** CV, lettre exemple et en-tête des lettres de motivation (privé). */
export type LetterKit = {
  header: string;
  city: string;
  signature: string;
  cvText: string;
  letterExample: string;
  rules: string;
  mastered: string;
  closing: string;
  bannedWords: string;
  pdfFolder: string;
  pdfName: string;
  cvPdfPath: string;
};
export type StoredLetter = { inputHash: string; model: string; content: string; edited: boolean; createdAt: string; updatedAt: string };
export type LetterState = { letter: StoredLetter | null; upToDate: boolean; kitReady: boolean; warnings: string[]; cached?: boolean; durationMs?: number };

/** Offre où tu as postulé (page « Candidatures »). */
export type Application = JobSummary & { appliedAt: string | null };

/** Profil proposé par l'IA après lecture du CV (premier lancement). */
export type CvProposal = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  job: string | null;
  searches: string[];
  skills: string[];
  yearsOfExperience: number | null;
  contracts: string[];
};

/** Profil relu et validé par la personne. */
export type SetupForm = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  searches: string[];
  skills: string[];
  mastered: string[];
  yearsOfExperience: number | null;
  contracts: string[];
  salaryTarget: number | null;
  /** Codes métier ROME (candidatures spontanées), 5 au plus. */
  romes: string[];
};

/** Métier de la liste officielle ROME (France Travail). */
export type RomeJob = { code: string; label: string };
export type RomeSuggestion = { items: RomeJob[]; source: "france-travail" | "ia" | "liste" | "aucune" };

/** Page « Réglages » : état des clés (jamais une clé secrète en entier). */
export type SettingKeyState = { filled: boolean; secret: boolean; display: string };
export type SettingsState = {
  keys: Record<string, SettingKeyState>;
  services: Record<string, { configured: boolean }>;
};
