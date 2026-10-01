import { departmentFromPostalCode, departmentFromText } from "@job-radar/shared";
import { z } from "zod";
import type { OllamaClient } from "./ollama";

/**
 * Premier lancement : l'IA locale lit le CV et propose un profil (n'importe quel métier).
 * La personne relit et corrige tout avant d'enregistrer : rien n'est utilisé sans sa validation.
 */
export const CvReadingSchema = z.object({
  nom_complet: z.string().trim().max(120).nullable(),
  email: z.string().trim().max(200).nullable(),
  telephone: z.string().trim().max(40).nullable(),
  ville: z.string().trim().max(120).nullable(),
  code_postal: z.string().trim().max(10).nullable(),
  metier: z.string().trim().max(120).nullable(),
  intitules_recherche: z.array(z.string().trim().min(2).max(80)).max(8),
  competences: z.array(z.string().trim().min(1).max(60)).max(40),
  annees_experience: z.number().min(0).max(50).nullable(),
  contrats: z.array(z.enum(["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"])).max(6),
});
export type CvReading = z.infer<typeof CvReadingSchema>;

const CV_JSON_SCHEMA = {
  type: "object",
  properties: {
    nom_complet: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    telephone: { type: ["string", "null"] },
    ville: { type: ["string", "null"] },
    code_postal: { type: ["string", "null"] },
    metier: { type: ["string", "null"] },
    intitules_recherche: { type: "array", items: { type: "string" } },
    competences: { type: "array", items: { type: "string" } },
    annees_experience: { type: ["number", "null"] },
    contrats: { type: "array", items: { type: "string", enum: ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"] } },
  },
  required: ["nom_complet", "email", "telephone", "ville", "code_postal", "metier", "intitules_recherche", "competences", "annees_experience", "contrats"],
} as const;

const MAX_CV = 12_000;

export const CV_SYSTEM_PROMPT = `Tu lis un CV en français et tu en tires un profil de recherche d'emploi, pour N'IMPORTE QUEL métier.
Tu réponds UNIQUEMENT avec le JSON demandé. N'invente RIEN : une information absente du CV vaut null (ou une liste vide).

- nom_complet, email, telephone : recopiés tels qu'écrits dans le CV.
- ville, code_postal : l'adresse du candidat (pas celle d'un employeur).
- metier : le métier principal visé ou exercé, en quelques mots (ex. « Assistant comptable », « Aide-soignante », « Chargé de clientèle »).
- intitules_recherche : 3 à 6 intitulés de poste à taper dans un moteur de recherche d'offres pour CE candidat, du plus proche au plus large
  (ex. pour une assistante comptable : « Assistant comptable », « Comptable », « Aide comptable », « Gestionnaire paie »).
  Pas d'intitulé de niveau supérieur à son expérience (pas de « Responsable » pour un débutant).
- competences : les compétences, savoir-faire et outils ÉCRITS dans le CV (logiciels, techniques, gestes métier, langues, permis),
  en noms courts (« Sage », « Paie », « Soins d'hygiène », « Excel », « Anglais », « Permis B ») ; pas de qualités (« rigoureux »).
- annees_experience : total des années d'expérience PROFESSIONNELLE dans ce métier (emplois, alternance, stages longs), arrondi ; null si impossible à dire.
- contrats : les types de contrat recherchés si le CV le dit ; sinon une liste vide.`;

export type CvProfileProposal = {
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

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
/** Garde seulement ce qui est vraiment écrit dans le CV (l'IA peut se tromper ou inventer). */
const appearsIn = (value: string, cv: string) => norm(cv).includes(norm(value).trim());

export function toProposal(r: CvReading, cvText: string): CvProfileProposal {
  const email = r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) && appearsIn(r.email, cvText) ? r.email.toLowerCase() : null;
  const digits = (s: string) => s.replace(/\D/g, "");
  const phone = r.telephone && digits(r.telephone).length >= 9 && digits(cvText).includes(digits(r.telephone)) ? r.telephone : null;
  const postalCode = r.code_postal && /^\d{5}$/.test(r.code_postal) && cvText.includes(r.code_postal) ? r.code_postal : null;
  const city = r.ville && appearsIn(r.ville, cvText) ? r.ville : null;
  // Sans doublon (majuscules / accents ignorés), en gardant la première écriture.
  const uniq = (xs: string[]) => {
    const seen = new Map<string, string>();
    for (const x of xs) if (x.trim() && !seen.has(norm(x).trim())) seen.set(norm(x).trim(), x.trim());
    return [...seen.values()];
  };
  return {
    fullName: r.nom_complet && appearsIn(r.nom_complet, cvText) ? r.nom_complet : null,
    email,
    phone,
    city,
    postalCode,
    department: departmentFromPostalCode(postalCode) ?? departmentFromText(city),
    job: r.metier,
    searches: uniq(r.intitules_recherche).slice(0, 6),
    // Compétences : seulement celles écrites dans le CV.
    skills: uniq(r.competences.filter((c) => appearsIn(c, cvText))).slice(0, 30),
    yearsOfExperience: r.annees_experience === null ? null : Math.round(r.annees_experience),
    contracts: [...new Set(r.contrats)],
  };
}

export async function readCvWithAi(
  client: Pick<OllamaClient, "chatJson" | "model">,
  cvText: string,
): Promise<{ proposal: CvProfileProposal; model: string; durationMs: number }> {
  const started = Date.now();
  const text = cvText.slice(0, MAX_CV);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await client.chatJson(CV_SYSTEM_PROMPT, `CV :\n"""\n${text}\n"""`, CV_JSON_SCHEMA, { temperature: 0 });
    const parsed = CvReadingSchema.safeParse(raw);
    if (parsed.success) return { proposal: toProposal(parsed.data, text), model: client.model, durationMs: Date.now() - started };
    lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ");
  }
  throw new Error(`Réponse de l'IA hors format : ${lastError}`);
}
