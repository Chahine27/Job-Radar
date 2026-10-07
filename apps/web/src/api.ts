import type { JobEdits, SpontaneousApplicationState, AiReadResult, Application, AiStatus, AutoCheckStatus, LetterKit, LetterState, StoredAiAnalysis, JobTextAnalysis, ManualJobForm, CollectionStatus, Lead, LeadStatus, SpontaneousSettings, NotificationSettings, SourceItem, JobDetail, JobStatus, JobSummary, Profile, HomeLocation, ProfileRecord, CvProposal, SetupForm, SettingsState, RomeJob, RomeSuggestion } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public issues: Array<{ path: string; message: string }> = [],
  ) {
    super(code);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith("/auth/login")) onUnauthorized();
    const err = new ApiError(res.status, data.error ?? "ERREUR", data.issues ?? []);
    if (typeof data.message === "string") err.message = data.message;
    throw err;
  }
  return data as T;
}

export type JobQuery = {
  minScore?: number;
  status?: JobStatus | "active" | "all";
  includeHidden?: boolean;
  q?: string;
  sort?: "score" | "date";
  /** Une seule source (vide = toutes). */
  source?: string;
  /** Rubrique du flux : dans ta zone, télétravail complet, lieu non précisé (vide = tout). */
  zone?: "" | "local" | "remote" | "unknown";
  limit?: number;
  offset?: number;
};

export const api = {
  login: (email: string, password: string) =>
    request<{ user: { email: string } }>("POST", "/api/auth/login", { email, password }),
  stopApp: () => request<{ status: "stopping" }>("POST", "/api/system/stop"),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => request<{ user: { email: string } }>("GET", "/api/auth/me"),

  // Premier lancement : compte, CV, profil proposé par l'IA.
  setupStatus: () => request<{ hasAccount: boolean; needsSetup: boolean }>("GET", "/api/setup/status"),
  createAccount: (email: string, password: string) =>
    request<{ user: { email: string } }>("POST", "/api/setup/account", { email, password }),
  uploadCv: (fileName: string, data: string) =>
    request<{ text: string; chars: number }>("POST", "/api/setup/cv-file", { fileName, data }),
  readCv: () => request<{ proposal: CvProposal; model: string; durationMs: number }>("POST", "/api/setup/read-cv"),
  finishSetup: (body: SetupForm) => request<ProfileRecord>("POST", "/api/setup/finish", body),
  // Codes métier ROME : propositions (France Travail ou IA locale) et recherche dans la liste officielle.
  suggestRomes: (searches: string[]) => request<RomeSuggestion>("POST", "/api/rome/suggest", { searches }),
  searchRome: (q: string) => request<{ items: RomeJob[] }>("GET", `/api/rome/search?q=${encodeURIComponent(q)}`),

  // Réglages : clés des services (écrites dans .env par le serveur).
  settingsKeys: () => request<SettingsState>("GET", "/api/settings/keys"),
  saveSettingsKeys: (values: Record<string, string>) => request<SettingsState>("PUT", "/api/settings/keys", values),
  testSetting: (service: string) => request<{ ok: boolean; message: string }>("POST", `/api/settings/test/${encodeURIComponent(service)}`),

  getPrefs: () => request<Record<string, Record<string, unknown>>>("GET", "/api/prefs"),
  savePrefs: (page: string, value: Record<string, unknown>) => request<{ ok: true }>("PUT", `/api/prefs/${encodeURIComponent(page)}`, value),
  getProfile: () => request<ProfileRecord>("GET", "/api/profile"),
  saveProfile: (profile: Profile, home?: HomeLocation | null) =>
    request<ProfileRecord>("PUT", "/api/profile", home === undefined ? { profile } : { profile, home }),

  listJobs(query: JobQuery = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    return request<{ items: JobSummary[]; total: number; offset: number; limit: number }>("GET", `/api/jobs?${params}`);
  },
  getJob: (id: string) => request<JobDetail>("GET", `/api/jobs/${encodeURIComponent(id)}`),
  refresh: () => request<{ status: "started" | "already_running"; runId: string }>("POST", "/api/jobs/refresh"),
  collectionStatus: () => request<CollectionStatus>("GET", "/api/collection/status"),
  geocode: (q: string) =>
    request<{ items: Array<{ label: string; lat: number; lng: number; precision: string }> }>(
      "GET",
      `/api/geocode?q=${encodeURIComponent(q)}`,
    ),
  listLeads: (status: LeadStatus | "active" | "all", sort: "potential" | "distance", offset = 0, limit = 20, email: "any" | "hint" | "missing" | "set" = "any", q = "") =>
    request<{ items: Lead[]; total: number; lastRefreshAt: string | null; configured: boolean; addressesPending: boolean }>(
      "GET",
      `/api/leads?status=${status}&sort=${sort}&email=${email}&q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`,
    ),
  /** Signale la page ouverte et au premier plan : pas de notification pour une lettre terminée ici. */
  presence: (path: string) => request<void>("POST", "/api/presence", { path }),
  getLeadSettings: () => request<SpontaneousSettings>("GET", "/api/leads/settings"),
  saveLeadSettings: (s: SpontaneousSettings) => request<SpontaneousSettings>("PUT", "/api/leads/settings", s),
  refreshLeads: () =>
    request<{ found: number; created: number; updated: number; around: string }>("POST", "/api/leads/refresh"),
  updateLead: (id: string, data: { status?: LeadStatus; notes?: string | null; contactEmail?: string | null }) =>
    request<Lead>("PATCH", `/api/leads/${encodeURIComponent(id)}`, data),
  importLeadEmails: (items: Array<{ siret: string; email: string | null; source: string | null; site: string | null; contactUrl: string | null }>, overwrite: boolean) =>
    request<{ updated: number; notFound: number; unknown: number; invalid: number; kept: number; linksOnly: number; leads: Lead[] }>("POST", "/api/leads/emails", { items, overwrite }),
  getApplication: (id: string, title?: string) =>
    request<SpontaneousApplicationState>(
      "GET",
      `/api/leads/${encodeURIComponent(id)}/application${title ? `?title=${encodeURIComponent(title)}` : ""}`,
    ),
  writeApplicationLetter: (id: string, title: string) =>
    request<SpontaneousApplicationState>("POST", `/api/leads/${encodeURIComponent(id)}/application/letter`, { title }),
  editApplicationLetter: (id: string, content: string) =>
    request<SpontaneousApplicationState>("PUT", `/api/leads/${encodeURIComponent(id)}/application`, { content }),
  sendApplication: (id: string, data: { to: string; subject: string; message: string; letter: string; force?: boolean }) =>
    request<SpontaneousApplicationState>("POST", `/api/leads/${encodeURIComponent(id)}/application/send`, data),
  listSources: () => request<{ items: SourceItem[] }>("GET", "/api/sources"),
  refreshSource: (source: string) =>
    request<{ status: "started" | "already_running"; runId: string }>("POST", `/api/sources/${encodeURIComponent(source)}/refresh`),
  updateSource: (source: string, data: { enabled: boolean; intervalMinutes: number }) =>
    request<unknown>("PUT", `/api/sources/${encodeURIComponent(source)}`, data),
  getNotificationSettings: () => request<NotificationSettings>("GET", "/api/notifications/settings"),
  saveNotificationSettings: (s: Pick<NotificationSettings, "emailEnabled" | "pushEnabled" | "emailTo">) =>
    request<unknown>("PUT", "/api/notifications/settings", s),
  subscribePush: (sub: PushSubscriptionJSON) => request<{ ok: true }>("POST", "/api/notifications/subscribe", sub),
  unsubscribePush: (endpoint: string) => request<{ ok: true }>("POST", "/api/notifications/unsubscribe", { endpoint }),
  testNotification: (channel: "email" | "webpush") =>
    request<{ ok: true }>("POST", "/api/notifications/test", { channel }),
  aiReadJob: (text: string, hints?: { title?: string | null; company?: string | null }) =>
    request<AiReadResult>("POST", "/api/jobs/manual/ai-read", { text, hints: hints ?? null }),
  analyzeJobText: (text: string) => request<JobTextAnalysis>("POST", "/api/jobs/manual/analyze", { text }),
  listApplications: () => request<{ items: Application[] }>("GET", "/api/jobs/applications"),
  listManualJobs: () => request<{ items: JobSummary[] }>("GET", "/api/jobs/manual"),
  addManualJob: (form: ManualJobForm) =>
    request<{ job: JobDetail; duplicate: boolean; otherSources: string[] }>("POST", "/api/jobs/manual", form),
  removeManualJob: (id: string) =>
    request<{ result: "deleted" | "unlinked" }>("DELETE", `/api/jobs/manual/${encodeURIComponent(id)}`),
  autoCheck: (jobIds: string[]) => request<AutoCheckStatus>("POST", "/api/ai/auto", { jobIds }),
  autoCheckStatus: () => request<AutoCheckStatus>("GET", "/api/ai/auto"),
  /** Toutes les meilleures offres du flux pas encore vérifiées par l'IA (pas seulement celles affichées). */
  autoCheckFeed: (retry = false) => request<AutoCheckStatus & { queued: number }>("POST", "/api/ai/auto/feed", { retry }),
  aiStatus: () => request<AiStatus>("GET", "/api/ai/status"),
  getJobAnalysis: (id: string) =>
    request<{ analysis: StoredAiAnalysis | null; upToDate: boolean }>("GET", `/api/jobs/${encodeURIComponent(id)}/analysis`),
  analyzeJob: (id: string, force = false) =>
    request<{ analysis: StoredAiAnalysis; upToDate: boolean; cached: boolean; durationMs?: number }>(
      "POST",
      `/api/jobs/${encodeURIComponent(id)}/analysis${force ? "?force=true" : ""}`,
    ),
  getLetterKit: () => request<{ kit: LetterKit; ready: boolean }>("GET", "/api/letter-kit"),
  saveLetterKit: (kit: LetterKit) => request<{ kit: LetterKit; ready: boolean }>("PUT", "/api/letter-kit", kit),
  getLetter: (id: string) => request<LetterState>("GET", `/api/jobs/${encodeURIComponent(id)}/letter`),
  writeLetter: (id: string, force = false) =>
    request<LetterState>("POST", `/api/jobs/${encodeURIComponent(id)}/letter${force ? "?force=true" : ""}`),
  saveLetterPdf: (id: string, content: string) =>
    request<{ file: string }>("POST", `/api/jobs/${encodeURIComponent(id)}/letter/pdf`, { content }),
  editLetter: (id: string, content: string) =>
    request<LetterState>("PUT", `/api/jobs/${encodeURIComponent(id)}/letter`, { content }),
  findAbridged: (page: { url?: string; title?: string; company?: string }) =>
    request<{ job: { id: string; title: string; company: string | null; sources: string[] } | null }>("POST", "/api/jobs/find-abridged", page),
  editJob: (id: string, edits: JobEdits) => request<JobDetail>("PUT", `/api/jobs/${encodeURIComponent(id)}/edits`, edits),
  completeJob: (
    id: string,
    text: string,
    experienceYears?: number | null,
    info?: { contractType?: string | null; remoteType?: string | null; salaryMin?: number | null; salaryMax?: number | null } | null,
  ) =>
    request<JobDetail>("PUT", `/api/jobs/${encodeURIComponent(id)}/full-text`, {
      text,
      experienceYears: experienceYears ?? null,
      info: info ?? null,
    }),
  resetFullText: (id: string) => request<JobDetail>("DELETE", `/api/jobs/${encodeURIComponent(id)}/full-text`),
  setJobStatus: (id: string, status: JobStatus) =>
    request<JobDetail>("POST", `/api/jobs/${encodeURIComponent(id)}/status`, { status }),
};
