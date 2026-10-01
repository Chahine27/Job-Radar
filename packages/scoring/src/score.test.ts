import { EXAMPLE_PROFILE, type Profile } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { ACCEPTABLE, LOW_SALARY, NOT_CDI, PERFECT, TOO_FAR, TOO_SENIOR } from "./fixtures";
import { DEFAULT_RULES } from "./rules";
import { scoreJob, type ScoringInput } from "./score";

const score = (input: ScoringInput, profile: Profile = EXAMPLE_PROFILE) => scoreJob(input, profile);

/**
 * Scores figés (README §32 : « le score ne doit pas changer sans modification explicite des règles »).
 * Si tu modifies les règles : change DEFAULT_RULES.version, puis mets à jour ces valeurs.
 */
describe(`scores figés — règles ${DEFAULT_RULES.version}`, () => {
  it.each([
    ["offre parfaite", PERFECT, 93],
    ["offre acceptable", ACCEPTABLE, 77],
    ["offre trop senior", TOO_SENIOR, 55],
    ["salaire faible", LOW_SALARY, 85],
    ["trop éloignée", TOO_FAR, 50],
    ["non-CDI", NOT_CDI, 40],
  ] as const)("%s → %i %%", (_name, input, expected) => {
    expect(score(input).final).toBe(expected);
  });

  it("version des règles attendue", () => {
    expect(DEFAULT_RULES.version).toBe("2026-10-01.1");
  });
});

describe("classement des 6 cas", () => {
  it("un salaire faible baisse le score sans le bloquer", () => {
    expect(score(LOW_SALARY).final).toBeLessThan(score(PERFECT).final);
    expect(score(LOW_SALARY).final).toBeGreaterThanOrEqual(EXAMPLE_PROFILE.minScoreForNotification);
  });

  it("les critères bloquants (expérience, lieu, contrat) passent sous l'acceptable et sous le seuil de notification", () => {
    const a = score(ACCEPTABLE).final;
    const threshold = EXAMPLE_PROFILE.minScoreForNotification;
    expect(score(PERFECT).final).toBeGreaterThan(a);
    expect(a).toBeGreaterThanOrEqual(threshold);
    for (const blocked of [TOO_SENIOR, TOO_FAR, NOT_CDI]) {
      expect(score(blocked).final).toBeLessThan(a);
      expect(score(blocked).final).toBeLessThan(threshold);
    }
  });
});

describe("explications", () => {
  it("offre parfaite : pourcentage, compétences présentes et mots-clés manquants", () => {
    const r = score(PERFECT);
    expect(r.breakdown.technical).toBe(80);
    expect(r.reasons).toContain("4/5 compétences de l'offre dans ton profil");
    expect(r.reasons).toContain("Tu as : TypeScript, Vue.js, Node.js, API REST");
    expect(r.reasons).toContain("CDI");
    expect(r.reasons).toContain("Salaire 40k–45k");
    expect(r.missingSkills).toEqual(["PostgreSQL"]);
    expect(r.warnings).toEqual([
      "Mots-clés absents de ton profil : PostgreSQL — à ajouter au CV si tu les maîtrises",
    ]);
    expect(r.preferredSkills).toEqual(["TypeScript", "Vue.js", "Node.js"]);
    expect(r.hidden).toBe(false);
  });

  it("non-CDI : masquée du flux principal mais gardée", () => {
    const r = score(NOT_CDI);
    expect(r.hidden).toBe(true);
    expect(r.hiddenReason).toBe("Contrat CDD hors profil");
  });

  it("indique le plafond appliqué", () => {
    expect(score(TOO_SENIOR).warnings[0]).toBe(
      "Score plafonné à 55 % : expérience au-dessus de ta cible (sinon 85 %)",
    );
  });
});

describe("données absentes = neutre, jamais inventées", () => {
  it("salaire, trajet, contrat, expérience inconnus → note neutre + vigilance", () => {
    const r = score({
      ...PERFECT,
      salaryMin: null,
      salaryMax: null,
      travelMinutes: null,
      contractType: null,
      experienceMinYears: null,
      title: "Développeur Vue.js",
    });
    expect(r.breakdown.salary).toBe(DEFAULT_RULES.neutral);
    expect(r.breakdown.transport).toBe(DEFAULT_RULES.neutral);
    expect(r.breakdown.contract).toBe(DEFAULT_RULES.neutral);
    expect(r.breakdown.experience).toBe(DEFAULT_RULES.neutral);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        "Salaire non communiqué",
        "Temps de trajet non calculé",
        "Type de contrat non précisé",
        "Expérience demandée non précisée",
      ]),
    );
  });

  it("aucune techno détectée → note technique basse + vigilance", () => {
    const r = score({ ...PERFECT, title: "Développeur H/F", description: "Rejoignez une super équipe." });
    expect(r.breakdown.technical).toBe(DEFAULT_RULES.noSkillsTechnical);
    expect(r.warnings).toContain("Aucune techno détectée : poste peut-être hors informatique");
  });
});

describe("règles détaillées", () => {
  it("pourcentage = compétences possédées / compétences de l'offre", () => {
    const t = (description: string) => score({ ...PERFECT, title: "Développeur", description }).breakdown.technical;
    expect(t("Vue.js")).toBe(100);
    expect(t("Vue.js et Angular")).toBe(50);
    expect(t("Vue.js, Angular, Kubernetes")).toBe(33);
    expect(t("Ruby, Kubernetes")).toBe(0);
  });

  it("plus l'offre contient de tes compétences, plus le score monte", () => {
    const base = { ...PERFECT, title: "Développeur" };
    const few = score({ ...base, description: "Vue.js, Angular, Kubernetes, GraphQL" }).final;
    const more = score({ ...base, description: "Vue.js, TypeScript, Docker, GraphQL" }).final;
    expect(more).toBeGreaterThan(few);
  });

  it("stack hors profil : note technique 0, mots-clés listés, score plafonné à technique + 25", () => {
    const r = score({ ...PERFECT, title: "Développeur Ruby", description: "API en Ruby on Rails, Kubernetes." });
    expect(r.breakdown.technical).toBe(0);
    expect(r.missingSkills).toEqual(["Ruby", "Kubernetes"]);
    expect(r.final).toBe(25);
    expect(r.capLabel).toMatch(/technique trop faible/);
  });

  it("la technique tient le reste : tout à 100 % sauf la technique → jamais plus que technique + 25", () => {
    const tech = (description: string) => score({ ...PERFECT, title: "Développeur", description });
    const low = tech("Java, Angular, Kotlin, Kubernetes, Go (Golang), Ruby."); // 1 compétence sur 6
    expect(low.breakdown.technical).toBeLessThanOrEqual(40);
    expect(low.final).toBe(low.breakdown.technical + 25);
    expect(low.weighted).toBeGreaterThan(low.final);
    // Aucune techno détectée : technique inconnue, pas de plafond « technique ».
    expect(tech("Poste de développeur dans une équipe sympa.").capLabel ?? "").not.toMatch(/technique trop faible/);
  });

  it("télétravail complet → lieu et trajet au maximum", () => {
    const r = score({ ...TOO_FAR, remoteType: "remote" });
    expect(r.breakdown.location).toBe(100);
    expect(r.breakdown.transport).toBe(100);
  });

  it("trajet : paliers", () => {
    const t = (m: number) => score({ ...PERFECT, travelMinutes: m }).breakdown.transport;
    expect([t(25), t(45), t(60), t(75), t(90), t(120)]).toEqual([100, 85, 65, 40, 20, 5]);
  });

  it("expérience : paliers pour une cible de 1 à 3 ans", () => {
    const e = (y: number) =>
      score({ ...PERFECT, title: "Développeur", experienceMinYears: y }).breakdown.experience;
    expect([e(0), e(2), e(3), e(4), e(5), e(7), e(8)]).toEqual([100, 100, 85, 65, 35, 35, 10]);
  });

  it("un poste junior sans années indiquées est très compatible", () => {
    const r = score({ ...PERFECT, title: "Développeur Vue.js Junior", experienceMinYears: null });
    expect(r.breakdown.experience).toBe(100);
  });

  it("les poids du profil changent le résultat", () => {
    const profile: Profile = {
      ...EXAMPLE_PROFILE,
      scoringWeights: { technical: 1, experience: 0, contract: 0, salary: 0, location: 0, transport: 0 },
    };
    expect(score(ACCEPTABLE, profile).final).toBe(score(ACCEPTABLE).breakdown.technical);
  });

  it("une compétence ajoutée au profil est reconnue et fait monter le score", () => {
    const profile: Profile = { ...EXAMPLE_PROFILE, skills: [...EXAMPLE_PROFILE.skills, "Quasar"] };
    const r = score({ ...PERFECT, title: "Développeur Quasar", description: "Front Quasar." }, profile);
    expect(r.breakdown.technical).toBe(100);
  });

  it("« futur lead » n'est pas un poste de lead", () => {
    const r = score({ ...PERFECT, title: "Développeur Fullstack Node.js / React (futur lead) - CDI" });
    expect(r.breakdown.experience).toBe(100);
    expect(r.warnings.some((w) => w.startsWith("Score plafonné"))).toBe(false);
    expect(r.final).toBeGreaterThanOrEqual(90);
  });

  it("poste qui n'est pas du développement → plafonné, avec la raison", () => {
    const r = score({ ...PERFECT, title: "Chef de projet MOE Java / Spring Boot" });
    expect(r.final).toBe(DEFAULT_RULES.nonDevRoleCap);
    expect(r.warnings[0]).toMatch(/^Score plafonné à 35 % : pas un poste de développement \(chef de projet\)/);
    const foncier = score({ ...PERFECT, title: "Développeur Foncier 77 et 93", description: "Prospection de terrains." });
    expect(foncier.final).toBeLessThanOrEqual(35);
  });

  it("contrat lu dans le titre quand la source ne le donne pas", () => {
    const r = score({ ...PERFECT, contractType: null, title: "Développeur Vue.js - Freelance" });
    expect(r.hidden).toBe(true);
    expect(r.hiddenReason).toBe("Contrat FREELANCE hors profil");
    const cdi = score({ ...PERFECT, contractType: null, title: "Développeur Vue.js (CDI)" });
    expect(cdi.breakdown.contract).toBe(100);
    // « Freelance » dans le titre l'emporte sur le contrat de la source (Adzuna : « contract » → CDD).
    expect(score({ ...PERFECT, contractType: "CDD", title: "Développeur .NET/React.JS - Freelance" }).hiddenReason).toBe(
      "Contrat FREELANCE hors profil",
    );
    // Pour les autres mentions, le contrat de la source reste prioritaire.
    expect(score({ ...PERFECT, contractType: "CDI", title: "Développeur Vue.js (CDD possible)" }).breakdown.contract).toBe(100);
  });

  it("postes senior / confirmé / lead masqués du flux principal", () => {
    expect(score({ ...PERFECT, title: "Développeur Java Confirmé H/F" }).hiddenReason).toBe("Poste senior / confirmé");
    expect(score({ ...PERFECT, title: "Senior Frontend Engineer" }).hidden).toBe(true);
    expect(score({ ...PERFECT, title: "Tech Lead Vue.js" }).hiddenReason).toBe("Poste de lead / manager");
    expect(score({ ...PERFECT, title: "Développeur Vue.js (futur lead)" }).hidden).toBe(false);
  });

  it("un « salaire » sous 8 000 € (taux journalier) est ignoré", () => {
    const r = score({ ...PERFECT, salaryMin: 450, salaryMax: 550 });
    expect(r.breakdown.salary).toBe(DEFAULT_RULES.neutral);
    expect(r.warnings).toContain("Salaire non communiqué");
  });

  it("plus de 4 ans d'expérience demandés → masquée", () => {
    expect(score({ ...PERFECT, title: "Développeur", experienceMinYears: 4 }).hidden).toBe(false);
    expect(score({ ...PERFECT, title: "Développeur", experienceMinYears: 5 }).hiddenReason).toBe("Demande 5 ans d'expérience");
  });

  it("déterministe : même entrée → même résultat", () => {
    expect(score(ACCEPTABLE)).toEqual(score(ACCEPTABLE));
  });
});

describe("offres hors informatique (aucune techno + titre sans rapport)", () => {
  const offTopic: ScoringInput = {
    title: "Dessinateur (H/F)",
    description: "Mobilité pour des déplacements ponctuels sur chantier. Contrat : CDI. Perspectives d'évolution.",
    contractType: null,
    experienceMinYears: null,
    salaryMin: null,
    salaryMax: null,
    department: "69",
    remoteType: "unknown",
    travelMinutes: null,
  };

  it("« Dessinateur » dans ta zone : plafonné à 15 % et masqué", () => {
    const s = scoreJob(offTopic, EXAMPLE_PROFILE);
    expect(s.final).toBeLessThanOrEqual(DEFAULT_RULES.offTopicCap);
    expect(s.hidden).toBe(true);
    expect(s.hiddenReason).toBe("Pas un poste informatique");
    expect(s.warnings[0]).toMatch(/titre sans rapport avec l'informatique/);
  });

  it("titre de développeur avec un extrait trop court (aucune techno) : ni plafonné ni masqué", () => {
    const s = scoreJob({ ...offTopic, title: "Développeur web (H/F)" }, EXAMPLE_PROFILE);
    expect(s.hidden).toBe(false);
    expect(s.final).toBeGreaterThan(DEFAULT_RULES.offTopicCap);
  });

  it("une techno dans l'annonce suffit à ne pas être hors sujet", () => {
    const s = scoreJob({ ...offTopic, title: "Chargé d'études", description: "Vous utiliserez Python au quotidien." }, EXAMPLE_PROFILE);
    expect(s.hiddenReason).not.toBe("Pas un poste informatique");
  });
});

describe("critère Technique calculé sur les compétences lues par l'IA", () => {
  it("exigées = poids 1, « plus » = poids ½ ; libellés de l'IA reconnus (« Java 21 » = Java) ; détail cohérent", () => {
    const profile: Profile = { ...EXAMPLE_PROFILE, skills: ["Java", "Spring Boot", "Vue.js"] };
    const input = { ...PERFECT, aiSkills: { required: ["Java 21", "Spring Boot", "Kafka"], bonus: ["AWS", "Vue.js"] } };
    const s = scoreJob(input, profile);
    // (2 exigées + ½ × 1 plus) / (3 + ½ × 2) = 2,5 / 4 = 63 %
    expect(s.breakdown.technical).toBe(63);
    expect(s.matchedSkills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Vue.js"]));
    expect(s.missingSkills).toEqual(expect.arrayContaining(["Kafka", "AWS"]));
    expect(s.reasons.some((r) => r.includes("2/3 compétences exigées"))).toBe(true);
    expect(s.weighted).toBeGreaterThan(0);
  });

  it("sans liste de l'IA : calcul habituel sur le texte", () => {
    const s1 = scoreJob(PERFECT, EXAMPLE_PROFILE);
    const s2 = scoreJob({ ...PERFECT, aiSkills: { required: [], bonus: [] } }, EXAMPLE_PROFILE);
    expect(s2.breakdown.technical).toBe(s1.breakdown.technical);
  });
});
