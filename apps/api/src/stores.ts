import type { JobStatus, LetterKit, Profile, RemoteType } from "@job-radar/shared";

/**
 * Accès aux données dont l'API a besoin.
 * Interfaces séparées de Prisma → tests rapides sans base (voir test-helpers.ts).
 */

export type UserRecord = { id: string; email: string; passwordHash: string };

export type HomeLocation = { label: string; lat: number; lng: number };

export type ProfileRecord = {
  profile: Profile;
  home: HomeLocation | null;
  updatedAt: Date;
};

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Nombre de comptes : 0 = premier lancement (création du compte depuis le site). */
  count(): Promise<number>;
  create(email: string, passwordHash: string): Promise<UserRecord>;
}

/** Préférences d'affichage (filtres), rangées par page. */
export interface UiPrefsStore {
  get(userId: string): Promise<Record<string, Record<string, unknown>>>;
  set(userId: string, page: string, value: Record<string, unknown>): Promise<void>;
}

export interface SessionStore {
  create(input: { id: string; userId: string; expiresAt: Date }): Promise<void>;
  find(id: string): Promise<{ userId: string; expiresAt: Date } | null>;
  delete(id: string): Promise<void>;
}

export interface ProfileStore {
  get(userId: string): Promise<ProfileRecord | null>;
  save(userId: string, profile: Profile, home: HomeLocation | null | undefined): Promise<ProfileRecord>;
}

/** Offre telle que lue en base. Salaires = annuel brut en euros (convention de la normalisation). */
export type JobRow = {
  id: string;
  contentHash: string;
  title: string;
  company: string | null;
  description: string;
  contractType: string | null;
  experienceText: string | null;
  experienceMinYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  /** Adresse du lieu de travail, si connue (trajet calculé jusqu'à elle). */
  address: string | null;
  remoteType: RemoteType;
  technologies: string[];
  publishedAt: Date | null;
  firstSeenAt: Date;
  status: JobStatus;
  travelMinutes: number | null;
  /** Comment le trajet a été calculé : transports en commun (PRIM) ou voiture (IGN). */
  travelMode?: "transit" | "car" | null;
  sources: Array<{ source: string; url: string }>;
  /** Date où l'annonce complète a été collée (la description est alors l'annonce complète). */
  fullTextAt: Date | null;
};

export interface JobStore {
  list(): Promise<JobRow[]>;
  get(id: string): Promise<JobRow | null>;
  /** Change le statut et garde une trace dans l'historique. null si l'offre n'existe pas. */
  setStatus(id: string, status: JobStatus): Promise<JobRow | null>;
  /** Date de candidature de chaque offre (premier passage au statut « Postulé »). */
  appliedDates(): Promise<Map<string, Date>>;
  /** Offre ajoutée à la main (formulaire déjà validé). null si le formulaire est illisible. */
  addManual(input: unknown): Promise<ManualSaveResult | null>;
  removeManual(id: string): Promise<"deleted" | "unlinked" | "not_found" | "not_manual">;
  /** Annonce complète collée à la main (null = on revient à l'extrait de la source). null si l'offre n'existe pas. */
  setFullText(id: string, full: { text: string; experienceYears: number | null; info?: FullTextInfo | null } | null): Promise<JobRow | null>;
}

/** Infos lues par l'IA dans l'annonce complète : complètent ce que la source ne donne pas. */
export type FullTextInfo = {
  contractType?: string | null;
  remoteType?: RemoteType | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
};

export type ManualSaveResult = { jobId: string; duplicate: boolean; otherSources: string[] };

export type NotificationSettingsRecord = { emailEnabled: boolean; pushEnabled: boolean; emailTo: string | null };

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export type NotificationLogRow = {
  id: string;
  jobId: string;
  jobTitle: string | null;
  channel: string;
  status: string;
  error: string | null;
  createdAt: Date;
};

export interface NotificationStore {
  getSettings(): Promise<NotificationSettingsRecord>;
  saveSettings(s: NotificationSettingsRecord): Promise<NotificationSettingsRecord>;
  subscribe(userId: string, sub: PushSubscriptionInput): Promise<void>;
  unsubscribe(endpoint: string): Promise<void>;
  countSubscriptions(): Promise<number>;
  recent(limit: number): Promise<NotificationLogRow[]>;
}

export type SourceRow = {
  source: string;
  enabled: boolean;
  intervalMinutes: number;
  failures: number;
  lastSuccessAt: Date | null;
  nextRunAt: Date;
  lastStatus: string | null;
  lastError: string | null;
};

export interface SourceStore {
  list(): Promise<SourceRow[]>;
  update(source: string, data: { enabled: boolean; intervalMinutes: number }): Promise<SourceRow | null>;
}

export const LEAD_STATUSES = ["TO_CONTACT", "CONTACTED", "FOLLOWED_UP", "INTERVIEW", "NOT_INTERESTED", "IGNORED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadRow = {
  id: string;
  siret: string;
  name: string;
  officeName: string | null;
  naf: string | null;
  nafLabel: string | null;
  headcountMin: number | null;
  headcountMax: number | null;
  city: string | null;
  postcode: string | null;
  department: string | null;
  latitude: number | null;
  longitude: number | null;
  hiringPotential: number | null;
  isHighPotential: boolean;
  hasEmail: boolean;
  /** Email de contact collé à la main. */
  contactEmail: string | null;
  /** Adresse exacte (API Recherche d'entreprises). */
  address: string | null;
  addressCheckedAt: Date | null;
  status: LeadStatus;
  notes: string | null;
  contactedAt: Date | null;
  travelMinutes: number | null;
  travelOriginKey: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type LeadInput = Omit<LeadRow, "id" | "status" | "notes" | "contactEmail" | "address" | "addressCheckedAt" | "contactedAt" | "travelMinutes" | "travelOriginKey" | "firstSeenAt" | "lastSeenAt">;

export interface LeadStore {
  list(): Promise<LeadRow[]>;
  /** Ajoute ou met à jour (sans toucher au suivi : statut, notes). Renvoie le nombre de nouvelles entreprises. */
  upsertMany(leads: LeadInput[], now: Date): Promise<{ created: number; updated: number }>;
  update(id: string, data: { status?: LeadStatus; notes?: string | null; contactEmail?: string | null }): Promise<LeadRow | null>;
  get(id: string): Promise<LeadRow | null>;
  setTravel(id: string, minutes: number | null, originKey: string): Promise<void>;
  setAddress(id: string, address: string | null, at: Date): Promise<void>;
  lastRefreshAt(): Promise<Date | null>;
}

/** Analyse IA d'une offre, gardée en base (table JobAnalysis). */
export type StoredAnalysis = { inputHash: string; model: string; result: unknown; createdAt: Date };

export interface AnalysisStore {
  latest(jobId: string): Promise<StoredAnalysis | null>;
  /** Dernière analyse de chaque offre (pour corriger les scores de la liste). */
  latestAll(): Promise<Map<string, StoredAnalysis>>;
  save(jobId: string, a: { inputHash: string; model: string; result: unknown; lists: { required: string[]; bonus: string[]; risks: string[]; summary: string } }): Promise<StoredAnalysis>;
}

export interface LetterKitStore {
  get(userId: string): Promise<LetterKit | null>;
  save(userId: string, kit: LetterKit): Promise<LetterKit>;
}

export type StoredLetter = { inputHash: string; model: string; content: string; edited: boolean; createdAt: Date; updatedAt: Date };

export interface CoverLetterStore {
  get(jobId: string): Promise<StoredLetter | null>;
  /** Nouvelle lettre de l'IA (remplace l'ancienne). */
  save(jobId: string, l: { inputHash: string; model: string; content: string }): Promise<StoredLetter>;
  /** Modification à la main. null si pas de lettre pour cette offre. */
  edit(jobId: string, content: string): Promise<StoredLetter | null>;
}

/** Candidature spontanée préparée pour une entreprise. */
export type StoredApplication = {
  inputHash: string;
  model: string;
  letter: string;
  edited: boolean;
  sentAt: Date | null;
  sentTo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ApplicationStore {
  get(leadId: string): Promise<StoredApplication | null>;
  /** Nouvelle lettre de l'IA (remplace l'ancienne, garde la trace d'un envoi). */
  save(leadId: string, a: { inputHash: string; model: string; letter: string }): Promise<StoredApplication>;
  edit(leadId: string, letter: string): Promise<StoredApplication | null>;
  markSent(leadId: string, to: string, at: Date): Promise<void>;
}

export type Stores = {
  uiPrefs: UiPrefsStore;
  applications: ApplicationStore;
  analyses: AnalysisStore;
  letterKits: LetterKitStore;
  letters: CoverLetterStore;
  leads: LeadStore;
  sources: SourceStore;
  notifications: NotificationStore;
  users: UserStore;
  sessions: SessionStore;
  profiles: ProfileStore;
  jobs: JobStore;
};
