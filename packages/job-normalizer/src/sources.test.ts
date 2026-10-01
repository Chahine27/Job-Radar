import type { RawJob } from "@job-radar/source-connectors";
import { describe, expect, it } from "vitest";
import { annualEuros, contractFromLabel, htmlToText, normalize } from "./index";

const raw = (source: string, sourceJobId: string, data: unknown): RawJob => ({ source, sourceJobId, data, collectedAt: new Date() });

describe("htmlToText", () => {
  it("retire les balises, garde les listes, décode les entités (même échappées)", () => {
    expect(htmlToText("<p>Stack :</p><ul><li>Vue&nbsp;3</li><li>Node</li></ul><script>x</script>")).toBe("Stack :\n\n• Vue 3\n• Node");
    expect(htmlToText("&lt;p&gt;Caf&eacute; &amp; code&lt;/p&gt;")).toBe("Café & code");
  });
});

describe("contrat et salaire des outils de recrutement", () => {
  it.each([
    ["Permanent", "CDI"],
    ["CDI", "CDI"],
    ["FullTime", null],
    ["Intern", "STAGE"],
    ["Contract", "CDD"],
    ["Apprenticeship", "ALTERNANCE"],
    ["permanent", "CDI"],
  ] as const)("%s → %s", (label, expected) => {
    expect(contractFromLabel(label)).toBe(expected);
  });

  it("salaire annuel en euros uniquement", () => {
    expect(annualEuros({ min: 45000, max: 55000, currency: "EUR", period: "year" })).toEqual({ min: 45000, max: 55000 });
    expect(annualEuros({ min: 3500, max: null, currency: "EUR", period: "month" })).toEqual({ min: 42000, max: 42000 });
    expect(annualEuros({ min: 60000, max: 70000, currency: "USD", period: "year" })).toBeNull();
    expect(annualEuros({ min: 30, max: 40, currency: "EUR", period: "hour" })).toBeNull();
  });
});

describe("normalize Adzuna", () => {
  const base = {
    id: "4567",
    title: "Développeur <strong>Vue.js</strong> H/F",
    description: "Stack Vue 3, TypeScript, télétravail 2 jours…",
    created: "2026-09-27T10:00:00Z",
    redirect_url: "https://www.adzuna.fr/land/ad/4567",
    company: { display_name: "Atelier Numérique" },
    location: { display_name: "Villeurbanne, Rhône", area: ["France", "Auvergne-Rhône-Alpes", "Rhône", "Villeurbanne"] },
    latitude: 45.76,
    longitude: 4.89,
    salary_min: 40000,
    salary_max: 45000,
    salary_is_predicted: "0",
    contract_type: "permanent",
  };

  it("convertit une offre", () => {
    const j = normalize(raw("adzuna", "4567", base))!;
    expect(j).toMatchObject({
      title: "Développeur Vue.js H/F",
      company: "Atelier Numérique",
      city: "Villeurbanne",
      department: "69",
      contractType: "CDI",
      salaryMin: 40000,
      salaryMax: 45000,
      remoteType: "hybrid",
      sourceUrl: "https://www.adzuna.fr/land/ad/4567",
      locationPrecision: "city_centroid",
    });
    expect(j.technologies).toEqual(["TypeScript", "Vue.js"]);
  });

  it("ignore le salaire estimé par Adzuna", () => {
    const j = normalize(raw("adzuna", "4567", { ...base, salary_is_predicted: "1" }))!;
    expect(j.salaryMin).toBeNull();
    expect(j.salaryMax).toBeNull();
  });
});
