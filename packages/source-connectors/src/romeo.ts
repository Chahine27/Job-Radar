import { z } from "zod";
import { FT_DEFAULTS } from "./france-travail/source";
import { RateLimiter } from "./rate-limiter";
import { type FetchLike, SourceHttpError, SourceUnavailableError } from "./types";

/**
 * ROMEO v2 (France Travail) : rapproche un intitulé libre (« aide-soignante en EHPAD ») des métiers du ROME.
 * Accès libre (licence Etalab), mêmes identifiants que les offres ; droits « api_romeov2 ».
 * Adresse, droits et format vérifiés dans la documentation officielle (OpenAPI francetravail.io, 01/10/2026).
 */
export const ROMEO = {
  baseUrl: "https://api.francetravail.io/partenaire/romeo/v2",
  scope: "api_romeov2",
  /** Limite documentée : 20 intitulés par appel. */
  maxTitles: 20,
  minDelayMs: 600,
};

const PredictionSchema = z.array(
  z.looseObject({
    intitule: z.string().optional(),
    identifiant: z.string(),
    metiersRome: z
      .array(
        z.looseObject({
          codeRome: z.string(),
          libelleRome: z.string().optional(),
          libelleAppellation: z.string().optional(),
          scorePrediction: z.number(),
        }),
      )
      .default([]),
  }),
);

export type RomeoPrediction = { title: string; jobs: Array<{ code: string; label: string; score: number }> };

export class RomeoClient {
  private readonly fetch: FetchLike;
  private readonly limiter: RateLimiter;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly opts: {
      clientId: string | undefined;
      clientSecret: string | undefined;
      fetch?: FetchLike;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(ROMEO.minDelayMs, opts.now, opts.sleep);
  }

  isConfigured() {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  /** Vérifie les identifiants et le droit « ROMEO » (demande un jeton, sans prédiction). */
  async healthCheck(): Promise<void> {
    this.token = null;
    await this.getToken();
  }

  private async getToken(): Promise<string> {
    const now = this.opts.now?.() ?? Date.now();
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    if (!this.isConfigured()) throw new SourceUnavailableError("Identifiants France Travail absents");
    const res = await this.limiter.schedule(() =>
      this.fetch(FT_DEFAULTS.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.opts.clientId!,
          client_secret: this.opts.clientSecret!,
          scope: ROMEO.scope,
        }),
      }),
    );
    if (!res.ok) throw new SourceHttpError(`Authentification ROMEO refusée (HTTP ${res.status})`, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return this.token.value;
  }

  /** Métiers du ROME les plus probables pour chaque intitulé (3 au plus, du plus sûr au moins sûr). */
  async predict(titles: string[]): Promise<RomeoPrediction[]> {
    const list = titles.map((t) => t.trim()).filter(Boolean).slice(0, ROMEO.maxTitles);
    if (list.length === 0) return [];
    const token = await this.getToken();
    const body = JSON.stringify({
      appellations: list.map((intitule, i) => ({ intitule, identifiant: String(i) })),
      options: { nomAppelant: "job-radar", nbResultats: 3 },
    });
    const res = await this.limiter.schedule(() =>
      this.fetch(`${ROMEO.baseUrl}/predictionMetiers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body,
      }),
    );
    if (!res.ok) throw new SourceHttpError(`Prédiction ROMEO en erreur (HTTP ${res.status})`, res.status);
    const parsed = PredictionSchema.parse(await res.json());
    return list.map((title, i) => {
      const p = parsed.find((x) => x.identifiant === String(i));
      const jobs = (p?.metiersRome ?? [])
        .map((m) => ({ code: m.codeRome, label: m.libelleRome ?? m.libelleAppellation ?? m.codeRome, score: m.scorePrediction }))
        .sort((a, b) => b.score - a.score);
      return { title, jobs };
    });
  }
}
