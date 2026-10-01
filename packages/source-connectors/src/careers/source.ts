import { RateLimiter } from "../rate-limiter";
import type { FetchLike, JobSource, RawJob, SearchParams, SourceHealth } from "../types";
import { ATS_FETCHERS, type AtsPosting, type CompanyTarget } from "./ats";

export const CAREERS_SOURCE = "company-careers";

/** Les sources d'entreprise peuvent publier n'importe quel type de poste. On n'impose plus un filtre strictement technique. */
const JOB_TITLE = /[A-Za-zÀ-ÖØ-öø-ÿ]/;

export function isTechTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t.length < 2 || t.length > 200 || !JOB_TITLE.test(t)) return false;
  return true;
}

/**
 * Sites carrières des entreprises choisies (Greenhouse, Lever, Ashby, Recruitee).
 * 1 appel par entreprise et par collecte, espacés d'une seconde.
 */
export class CompanyCareersSource implements JobSource {
  readonly name = CAREERS_SOURCE;
  private readonly fetch: FetchLike;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly opts: {
      companies: () => Promise<CompanyTarget[]>;
      fetch?: FetchLike;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(1000, opts.now, opts.sleep);
  }

  async search(_params: SearchParams): Promise<RawJob[]> {
    return (await this.fetchAll()).jobs;
  }

  async fetchAll(): Promise<{ jobs: RawJob[]; errors: string[] }> {
    const companies = (await this.opts.companies()).filter((c) => c.enabled);
    const jobs: RawJob[] = [];
    const errors: string[] = [];
    for (const c of companies) {
      try {
        const postings = await this.limiter.schedule(() => ATS_FETCHERS[c.ats](this.fetch, c));
        const collectedAt = new Date(this.opts.now?.() ?? Date.now());
        for (const p of postings.filter((p) => p.title && isTechTitle(p.title))) {
          jobs.push({ source: CAREERS_SOURCE, sourceJobId: `${p.ats}:${p.boardKey}:${p.id}`, data: p satisfies AtsPosting, collectedAt });
        }
      } catch (err) {
        errors.push(`${c.name} (${c.ats}) : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { jobs, errors };
  }

  async healthCheck(): Promise<SourceHealth> {
    const companies = (await this.opts.companies()).filter((c) => c.enabled);
    if (companies.length === 0) return { status: "SOURCE_UNAVAILABLE", message: "Aucune entreprise ajoutée (page Sources)" };
    return { status: "OK" };
  }
}
