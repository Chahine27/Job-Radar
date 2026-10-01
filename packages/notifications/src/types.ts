export type Channel = "email" | "webpush";

/** Ce qu'on annonce pour une offre compatible. */
export type JobAlert = {
  jobId: string;
  title: string;
  company: string | null;
  place: string | null;
  score: number;
  contract: string | null;
  salary: string | null;
  remote: string | null;
  skills: string[];
  missing: string[];
  /** Lien vers la page détail dans Job Radar. */
  url: string;
};

export interface Notifier {
  readonly channel: Channel;
  /** false = identifiants absents du .env → canal ignoré sans erreur. */
  isConfigured(): boolean;
  sendAlerts(alerts: JobAlert[]): Promise<void>;
  sendTest(): Promise<void>;
}
