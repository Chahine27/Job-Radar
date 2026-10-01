import { z } from "zod";
import { RateLimiter } from "./rate-limiter";
import type { FetchLike } from "./types";

/**
 * API Recherche d'entreprises (État, données SIRENE, licence ouverte, sans clé) : adresse exacte d'un établissement
 * à partir de son SIRET. La Bonne Boîte ne donne que la ville. Limite d'appels non publiée précisément : on reste
 * prudent (1 appel toutes les 200 ms) et on s'arrête à la première erreur (429…) pour réessayer plus tard.
 */
export const RECHERCHE_ENTREPRISES = { baseUrl: "https://recherche-entreprises.api.gouv.fr", minDelayMs: 200 };

const Etab = z.looseObject({ siret: z.string().nullish(), adresse: z.string().nullish() });
const SearchResponse = z.looseObject({
  results: z.array(z.looseObject({ siege: Etab.nullish(), matching_etablissements: z.array(Etab).nullish() })).default([]),
});

export class RechercheEntreprisesClient {
  private readonly fetch: FetchLike;
  private readonly limiter: RateLimiter;

  constructor(opts: { fetch?: FetchLike; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(RECHERCHE_ENTREPRISES.minDelayMs, opts.now, opts.sleep);
  }

  /** Adresse postale de l'établissement (« 34 AVENUE DE L'OPERA 75002 PARIS »), ou null si inconnue / non diffusible. */
  async address(siret: string): Promise<string | null> {
    const url = `${RECHERCHE_ENTREPRISES.baseUrl}/search?q=${encodeURIComponent(siret)}&page=1&per_page=1`;
    const res = await this.limiter.schedule(() => this.fetch(url, { headers: { Accept: "application/json" } }));
    if (!res.ok) throw new Error(`Recherche d'entreprises : HTTP ${res.status}`);
    const data = SearchResponse.safeParse(await res.json());
    if (!data.success) return null;
    for (const r of data.data.results) {
      const etab = [...(r.matching_etablissements ?? []), ...(r.siege ? [r.siege] : [])].find((e) => e.siret === siret);
      const adresse = etab?.adresse?.replace(/\s+/g, " ").trim();
      if (adresse && !/^\[ND\]/i.test(adresse)) return adresse;
    }
    return null;
  }
}
