import { DEFAULT_PROFILE, type Profile } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { scoreJob, type ScoringInput } from "./score";

// Offre inventée : bonne technique (Java, Git) mais 3 ans exigés sur Angular ou Flutter, absents du profil.
const NORDIA: ScoringInput = {
  title: "Consultant Angular ou Flutter (H/F)",
  description: `Nordia recrute !

Dans le cadre de notre croissance, nous recrutons des consultants expérimentés sur Angular ou Flutter.

Vous justifiez de 3 ans d'expérience minimum sur ces environnements ? Rejoignez-nous !

• Réaliser les développements et paramétrages
• Gérer la configuration logicielle (Git, CI/CD)
• Solides bases techniques (Java)`,
  technologies: ["Java", "Git", "CI/CD"],
  contractType: null,
  experienceMinYears: 3,
  salaryMin: null,
  salaryMax: null,
  department: "75",
  remoteType: "unknown",
  travelMinutes: 18,
};

const ME: Profile = {
  ...DEFAULT_PROFILE,
  skills: ["Java", "Spring Boot", "SQL", "Docker", "Git", "CI/CD", "DevOps", "Tests unitaires"],
  contracts: ["CDD", "CDI"],
  experienceYears: 2.5,
  locations: [{ label: "Paris", department: "75" }],
};

describe("expérience exigée sur un outil absent du profil", () => {
  it("annonce Nordia : 40 % maximum, avec le point de vigilance", () => {
    const s = scoreJob(NORDIA, ME);
    expect(s.final).toBeLessThanOrEqual(40);
    expect(s.warnings).toContain("Expérience exigée sur un outil ou produit que tu n'as pas : Angular, Flutter (3 ans demandés)");
    expect(s.reasons.some((r) => r.includes("d'expérience demandé"))).toBe(false);
  });

  it("plafond réglable", () => {
    const s = scoreJob(NORDIA, { ...ME, productExperienceCap: 15 });
    expect(s.final).toBe(15);
    expect(s.capLabel).toBe("expérience exigée sur un outil ou produit que tu n'as pas");
  });

  it("bonne technique mais années exigées sur une techno absente : plafonnée à 40 %", () => {
    const job = { ...NORDIA, title: "Développeur Java", description: "Java, Spring Boot. 3 ans d'expérience minimum sur Angular." };
    const s = scoreJob(job, ME);
    expect(s.final).toBe(40);
    expect(s.capLabel).toBe("expérience exigée sur un outil ou produit que tu n'as pas");
  });

  it("produit dans le profil : pas de plafond", () => {
    expect(scoreJob(NORDIA, { ...ME, skills: [...ME.skills, "Angular", "Flutter"] }).capLabel).toBeNull();
  });

  it("années demandées au-delà de l'expérience réelle (mais dans la cible) : vigilance, pas de vert", () => {
    const job = { ...NORDIA, title: "Développeur Java", description: "3 ans d'expérience en développement." };
    const s = scoreJob(job, ME);
    expect(s.warnings).toContain("Demande 3 ans d'expérience (tu en as 2,5)");
    expect(s.reasons).not.toContain("3 an(s) d'expérience demandé(s)");
    // Le score ne bouge pas : il suit ta cible (1 à 3 ans).
    expect(s.final).toBe(scoreJob(job, { ...ME, experienceYears: null }).final);
    expect(scoreJob(job, { ...ME, experienceYears: null }).reasons).toContain("3 an(s) d'expérience demandé(s)");
  });
});
