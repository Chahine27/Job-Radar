import { describe, expect, it } from "vitest";
import { ANALYSIS_SYSTEM_PROMPT, analyzeJobWithAi, buildAnalysisPrompt } from "./job-analysis";
import { OllamaClient } from "./ollama";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const JOB = {
  title: "Développeur Java Full Stack (H/F)",
  company: "Open",
  city: "Levallois-Perret",
  department: "92",
  contractType: "CDI",
  remoteType: "hybrid",
  salaryMin: null,
  salaryMax: null,
  description: "Pour l'un de nos clients, nous recherchons un développeur Java / Angular. 5 ans minimum. Kubernetes apprécié.",
};
const PROFILE = { skills: ["Vue.js", "TypeScript"], experienceMin: 0, experienceMax: 3, contracts: ["CDI"], locations: ["Rhône (69)"] };
const GOOD = {
  resume: "Développeur Java / Angular en mission chez un client d'Open.",
  missions: ["Développer en Java", "Développer en Java", "Faire les interfaces Angular"],
  competences_obligatoires: ["Java", "Angular"],
  competences_bonus: ["Kubernetes", "java"],
  niveau: "confirme",
  experience_min_ans: 5,
  employeur: "cabinet_ou_client",
  points_attention: ["5 ans demandés", "Mission chez un client"],
  adequation: "faible",
  avis: "Stack Java/Angular éloignée de ton profil Vue.js, et 5 ans demandés.",
};

describe("IA locale (Ollama)", () => {
  it("consigne : profil + annonce, sans rien inventer", () => {
    const p = buildAnalysisPrompt(JOB, PROFILE);
    expect(p).toContain("Compétences : Vue.js, TypeScript");
    expect(p).toContain("Lieu : Levallois-Perret (92)");
    expect(p).toContain("Salaire : non indiqué");
    expect(p).toContain("Pour l'un de nos clients");
  });

  it("appel à Ollama : format JSON imposé, sans « réflexion », mémoire 8k ; réponse nettoyée", async () => {
    let body: any;
    const client = new OllamaClient({
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return json({ message: { content: "```json\n" + JSON.stringify(GOOD) + "\n```" } });
      },
    });
    const { result, model } = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(body).toMatchObject({ model: "gemma4:e4b", stream: false, think: false, options: { num_ctx: 12_288 } });
    expect(body.format.required).toContain("avis");
    expect(model).toBe("gemma4:e4b");
    expect(result.missions).toEqual(["Développer en Java", "Faire les interfaces Angular"]);
    expect(result.competences_bonus).toEqual(["Kubernetes"]); // « java » est déjà obligatoire
    expect(result.employeur).toBe("cabinet_ou_client");
  });

  it("cas réel : phrases retirées des compétences, poste trop expérimenté → adéquation faible", async () => {
    const answer = {
      ...GOOD,
      competences_obligatoires: ["Java", "Angular ou React", "5 ans de développement Java en backend", "Angular ou React en front end chez le client final"],
      competences_bonus: ["Kubernetes", "Docker"],
      adequation: "moyenne",
    };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(result.competences_obligatoires).toEqual(["Java", "Angular ou React"]);
    expect(result.adequation).toBe("faible"); // 5 ans demandés, profil jusqu'à 3 ans
  });

  it("extrait (Adzuna) + CV : signalés à l'IA ; niveau du titre prioritaire ; avertissement « incomplète » en tête", async () => {
    const p = buildAnalysisPrompt({ ...JOB, abridged: true }, { ...PROFILE, cv: "Alternance chez Nordia (banque)" });
    expect(p).toContain("EXTRAIT");
    expect(p).toContain("CV DU CANDIDAT");
    expect(p).toContain("Nordia");
    expect(buildAnalysisPrompt(JOB, PROFILE)).not.toMatch(/EXTRAIT|CV DU CANDIDAT/);

    const answer = { ...GOOD, niveau: "senior", points_attention: ["Secteur bancaire", "Annonce incomplète"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, { ...JOB, title: "Développeur junior Java / Angular F/H", abridged: true }, PROFILE);
    expect(result.niveau).toBe("junior");
    expect(result.points_attention[0]).toMatch(/^Annonce incomplète \(extrait\)/);
    expect(result.points_attention.filter((x) => /incompl/i.test(x))).toHaveLength(1);
  });

  it("consigne : tutoiement et « A ou B » en un seul élément", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("TUTOYANT");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("« A ou B »");
  });

  it("réponse hors format : redemandée une fois, puis erreur claire", async () => {
    let calls = 0;
    const client = new OllamaClient({ fetch: async () => (calls++, json({ message: { content: JSON.stringify({ resume: "x" }) } })) });
    await expect(analyzeJobWithAi(client, JOB, PROFILE)).rejects.toThrow(/hors format/);
    expect(calls).toBe(2);
  });

  it("Ollama éteint / modèle absent : messages simples", async () => {
    const off = new OllamaClient({ fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(off.chatJson("s", "u", {})).rejects.toThrow(/lance l'appli Ollama/);
    expect(await off.status()).toMatchObject({ available: false });

    const missing = new OllamaClient({ fetch: async () => json({ error: "model not found" }, 404) });
    await expect(missing.chatJson("s", "u", {})).rejects.toThrow(/ollama pull gemma4:e4b/);

    const noModel = new OllamaClient({ fetch: async () => json({ models: [{ name: "llama3:latest" }] }) });
    expect(await noModel.status()).toMatchObject({ available: true, installed: false });
    const ok = new OllamaClient({ fetch: async () => json({ models: [{ name: "gemma4:e4b", model: "gemma4:e4b" }] }) });
    expect(await ok.status()).toMatchObject({ available: true, installed: true });
  });
});

describe("points d'attention sur le contrat", () => {
  it("« Contrat CDD » retiré si le candidat accepte les CDD, gardé sinon", async () => {
    const answer = { ...GOOD, points_attention: ["Contrat CDD", "Le contrat est un CDD.", "Anglais professionnel exigé"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const withCdd = await analyzeJobWithAi(client, JOB, { ...PROFILE, contracts: ["CDI", "CDD"] });
    expect(withCdd.result.points_attention).toEqual(["Anglais professionnel exigé"]);
    const cdiOnly = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(cdiOnly.result.points_attention).toContain("Le contrat est un CDD.");
  });

  it.each([
    ["STAGE", "Assistant comptable — Stage", "Stage"],
    ["ALTERNANCE", "Assistant RH — Alternance", "Alternance"],
  ] as const)("le contrat %s compte dans l'adéquation et les points d'attention", async (contractType, title, label) => {
    const answer = { ...GOOD, experience_min_ans: null, adequation: "forte", points_attention: [] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const job = { ...JOB, title, contractType };
    const wanted = await analyzeJobWithAi(client, job, { ...PROFILE, contracts: [label] });
    expect(wanted.result.adequation).toBe("forte");
    const unwanted = await analyzeJobWithAi(client, job, PROFILE);
    expect(unwanted.result.adequation).toBe("faible");
    expect(unwanted.result.points_attention).toContain(`Contrat ${contractType} hors de tes critères (tu cherches : CDI)`);
  });

  it("contrat lu dans l'annonce quand la source ne le donne pas", () => {
    const job = { ...JOB, title: "Gestionnaire de paie", contractType: null, description: "Alternance / Apprentissage\nDurée du contrat : 12 mois" };
    expect(buildAnalysisPrompt(job, PROFILE)).toContain("Contrat : ALTERNANCE");
  });
});
