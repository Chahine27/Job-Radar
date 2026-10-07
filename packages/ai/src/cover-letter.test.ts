import { describe, expect, it } from "vitest";
import { assembleLetter, buildLetterPrompt, checkLetter, cleanDraft, cvEntities, findLetterIssues, spontaneousJobInput, strengthsAndGaps, writeCoverLetter } from "./cover-letter";
import { OllamaClient } from "./ollama";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

// Candidat et entreprises fictifs.
const KIT = {
  rules: "",
  mastered: "",
  closing: "",
  bannedWords: "",
  pdfFolder: "",
  pdfName: "",
  cvPdfPath: "",
  header: "Alex Martin\n75011 Paris\n06 00 00 00 00\nalex.martin@example.com",
  city: "Paris",
  signature: "Alex MARTIN",
  cvText:
    "Alex Martin — Développeur Full Stack. Licence professionnelle. 2 ans d'alternance chez Nordia : " +
    "interfaces Vue.js et TypeScript, API REST en Java Spring Boot, base PostgreSQL. Projet de fin d'études : " +
    "application .NET 8 avec Docker et Keycloak. Git, GitLab, CI/CD. ".repeat(2),
  letterExample:
    "Votre offre de Développeur Full Stack a retenu mon attention. Ce qui m'attire chez Alarmex, c'est la sécurité. " +
    "L'accompagnement par votre CTO me plaît. Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.",
};
const JOB = {
  title: "Développeur Vue.js / Java (H/F)",
  company: "Logistik",
  city: "Lyon",
  department: "69",
  contractType: "CDI",
  remoteType: "hybrid",
  salaryMin: null,
  salaryMax: null,
  description: "Logistik, éditeur de logiciels de transport, recrute un développeur Vue.js / Java Spring Boot. Kafka apprécié.",
};
const DRAFT = {
  objet: "Candidature au poste de Développeur Vue.js / Java (H/F)",
  paragraphes: [
    "Madame, Monsieur,",
    "1. Diplômé d'un Licence professionnelle, je candidate au poste de développeur Vue.js / Java chez Logistik.",
    "Chez Nordia, j'ai développé des interfaces en Vue.js et TypeScript et des API REST en Java Spring Boot.",
    "Votre activité dans le transport m'attire, et je souhaite découvrir Kafka.",
    "Je serais heureux d'échanger avec vous.",
    "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    "Alex MARTIN",
  ],
};

describe("lettre de motivation (IA locale)", () => {
  it("consigne : CV, lettre exemple marquée « style uniquement », annonce", () => {
    const p = buildLetterPrompt(JOB, KIT);
    expect(p).toContain("CV DU CANDIDAT");
    expect(p).toContain("Nordia");
    expect(p).toContain("pour le style uniquement");
    expect(p).toContain("Entreprise : Logistik");
    expect(buildLetterPrompt(JOB, { ...KIT, letterExample: "" })).toContain('"""\naucune\n"""');
  });

  it("nettoyage : retire « Madame, Monsieur », la politesse, la signature, les numéros et « H/F »", () => {
    const d = cleanDraft(DRAFT, KIT.signature);
    expect(d.objet).toBe("Candidature au poste de Développeur Vue.js / Java");
    expect(d.paragraphes).toHaveLength(4);
    expect(d.paragraphes[0]).toMatch(/^Diplômé/);
  });

  it("lettre complète : en-tête, lieu et date (heure de Paris), objet, politesse, signature", () => {
    const text = assembleLetter(KIT, cleanDraft(DRAFT, KIT.signature), new Date("2026-09-29T23:30:00Z"));
    expect(text.startsWith("Alex Martin\n75011 Paris")).toBe(true);
    expect(text).toContain("À Paris, le 30/09/2026");
    expect(text).toContain("Objet : Candidature au poste de Développeur Vue.js / Java\n\nMadame, Monsieur,\n\nDiplômé");
    expect(text.endsWith("salutations distinguées.\n\nAlex MARTIN")).toBe(true);
    expect(text.match(/Madame, Monsieur,\n/g)).toHaveLength(1);
  });

  it("relecture : techno absente du CV et nom venant de la lettre exemple sont signalés", () => {
    const letter = "Je maîtrise Kafka. Ce qui m'attire chez Alarmex, c'est votre CTO. J'ai utilisé Vue.js et Docker.";
    const w = checkLetter(letter, KIT, JOB.description);
    expect(w.some((x) => x.includes("Kafka") && x.includes("pas dans ton CV"))).toBe(true);
    expect(w.some((x) => x.includes("« Alarmex » vient de ta lettre exemple"))).toBe(true);
    expect(w.some((x) => x.includes("« CTO »"))).toBe(true);
    expect(w.some((x) => x.includes("Vue") || x.includes("Docker"))).toBe(false);
    expect(checkLetter("Chez Nordia, j'ai utilisé Vue.js.", KIT, JOB.description)).toEqual([]);
  });

  it("appel à Ollama : température plus haute pour écrire, lettre assemblée", async () => {
    let body: any;
    const client = new OllamaClient({
      fetch: async (_u, init) => {
        body = JSON.parse(String(init?.body));
        return json({ message: { content: JSON.stringify(DRAFT) } });
      },
    });
    const { content, model } = await writeCoverLetter(client, JOB, KIT, new Date("2026-09-29T10:00:00Z"));
    expect(body.options.temperature).toBe(0.5);
    expect(body.format.required).toEqual(["correspondances", "objet", "paragraphes"]);
    expect(model).toBe("gemma4:e4b");
    expect(content).toContain("À Paris, le 29/09/2026");
    expect(content).toContain("Chez Nordia");
  });

  it("réponse hors format : redemandée une fois, puis erreur claire", async () => {
    let calls = 0;
    const client = new OllamaClient({ fetch: async () => (calls++, json({ message: { content: '{"objet":"x"}' } })) });
    await expect(writeCoverLetter(client, JOB, KIT)).rejects.toThrow(/hors format/);
    expect(calls).toBe(2);
  });
});

describe("relecture : CV mis en page", () => {
  it("« CI / CD » dans le CV compte comme CI/CD (pas de fausse alerte)", () => {
    const kit = { ...KIT, cvText: `${KIT.cvText} DevOps : Git · Docker · CI / CD`, letterExample: "" };
    expect(checkLetter("J'ai appliqué les principes de CI/CD.", kit, JOB.description)).toEqual([]);
  });
});

describe("en-tête recopié d'une ancienne lettre", () => {
  it("son « Objet » et sa date sont retirés (un seul objet, celui de cette offre)", () => {
    const kit = { ...KIT, header: "Alex Martin\n\n75011 Paris\nObjet : Candidature au poste de Développeur Full Stack\nÀ Paris, le 28/09/2026" };
    const text = assembleLetter(kit, cleanDraft(DRAFT, KIT.signature), new Date("2026-09-29T10:00:00Z"));
    expect(text.startsWith("Alex Martin\n75011 Paris\n\nÀ Paris, le 29/09/2026")).toBe(true);
    expect(text.match(/Objet :/g)).toHaveLength(1);
  });
});

describe("relecture : titre du poste", () => {
  it("une techno qui n'apparaît que dans le titre recopié n'est pas signalée", () => {
    const letter = "Objet : Candidature au poste de Développeur Vue.js / Java Kafka\n\nJe candidate au poste de Développeur Vue.js / Java Kafka.";
    expect(checkLetter(letter, { ...KIT, letterExample: "" }, JOB.description, "Développeur Vue.js / Java Kafka (H/F)")).toEqual([]);
    const w = checkLetter(`${letter} Je maîtrise Kafka.`, { ...KIT, letterExample: "" }, JOB.description, "Développeur Vue.js / Java Kafka (H/F)");
    expect(w.some((x) => x.includes("« Kafka » n'est pas dans ton CV"))).toBe(true);
  });
});

describe("relecture : cas Voltane (lettre envoyée sans relecture)", () => {
  it("« apprendre Python » alors que Python est dans le CV → signalé ; « Vu.js » corrigé", async () => {
    const kit = { ...KIT, cvText: `${KIT.cvText} Autres : Python`, letterExample: "" };
    const w = checkLetter("Je souhaite apprendre Python pour concevoir des applications.", kit, "Développeur Python/Vu.js");
    expect(w.some((x) => x.includes("apprendre « Python »"))).toBe(true);
    const client = new OllamaClient({
      fetch: async () => json({ message: { content: JSON.stringify({ ...DRAFT, objet: "Candidature au poste de Développeur Python/Vu.js" }) } }),
    });
    const { content } = await writeCoverLetter(client, JOB, KIT);
    expect(content).toContain("Développeur Python/Vue.js");
    expect(content).not.toContain("Vu.js");
  });
});

describe("pertinence (cas Voltane : paragraphe hors sujet)", () => {
  it("technos du CV absentes de l'annonce citées dans la lettre → signalées", () => {
    const kit = { ...KIT, cvText: "Vue.js, TypeScript, Java Spring Boot, React, .NET, Flutter, Docker, PostgreSQL. ".repeat(4), letterExample: "" };
    const job = "Développeur Web Python / Vue.js : API REST, SQL, Agile.";
    const w = checkLetter("Pour Agenda Santé, j'ai utilisé React et .NET 8 ; pour les salles, Flutter.", kit, job, "Développeur Python / Vu.js");
    expect(w.some((x) => x.includes(".NET") && x.includes("Flutter") && x.includes("absents de l'annonce"))).toBe(true);
    expect(checkLetter("J'ai migré un module Vue 2 vers Vue 3 en TypeScript.", kit, job + " TypeScript")).toEqual([]);
  });

  it("le plan (correspondances) est demandé AVANT la lettre, et n'apparaît pas dans la lettre", async () => {
    let body: any;
    const client = new OllamaClient({
      fetch: async (_u, init) => {
        body = JSON.parse(String(init?.body));
        return json({ message: { content: JSON.stringify({ correspondances: [{ exigence: "Vue.js", preuve: "migration Vue 2 → 3" }], ...DRAFT }) } });
      },
    });
    const { content } = await writeCoverLetter(client, JOB, KIT);
    expect(Object.keys(body.format.properties)[0]).toBe("correspondances");
    expect(body.messages[0].content).toMatch(/Pas de catalogue du CV/);
    expect(content).not.toContain("migration Vue 2 → 3");
  });
});

describe("relecture automatique (cas : Go / gRPC / NestJS)", () => {
  const kit = { ...KIT, cvText: "Java Spring Boot, API REST, Vue.js, TypeScript, React, Node JS, PostgreSQL, Docker, Microservices, Auth0 / JWT. ".repeat(3), letterExample: "" };
  const job = "Microservices en Go (Golang), gRPC / Protocol Buffers, NestJS, GraphQL, React / Next.js, PostgreSQL, Docker, Kubernetes.";

  it("repère « approfondir » une techno absente, « maîtrise », faux liens de cause, mots creux", () => {
    const bad = [
      "Bien que je maîtrise les principes de microservices, je souhaite approfondir ma connaissance de Go (Golang) et de gRPC.",
      "J'ai développé un serveur Spring Boot, ce qui m'a permis d'intégrer des API REST.",
      "Je suis rigoureux, comme en témoigne ma capacité à mettre en accessibilité des interfaces.",
      "Cette opportunité me motive.",
    ].join(" ");
    const issues = findLetterIssues(bad, kit, job);
    expect(issues.some((i) => i.startsWith("Pas de « maîtrise »"))).toBe(true);
    expect(issues.some((i) => /Go.*n'est pas dans le CV/.test(i))).toBe(true);
    expect(issues.some((i) => i.includes("ce qui m'a permis"))).toBe(true);
    expect(issues.some((i) => i.includes("comme en témoigne"))).toBe(true);
    expect(issues.some((i) => i.includes("opportunité"))).toBe(true);
    expect(findLetterIssues("J'ai développé des API REST en Java Spring Boot, en microservices, avec React et PostgreSQL. Je n'ai pas encore utilisé Go.", kit, job)).toEqual([]);
  });

  it("lettre fautive → corrigée une fois par l'IA avec la liste des problèmes ; la version corrigée est gardée", async () => {
    const bodies: any[] = [];
    const BAD = { correspondances: [], objet: "Candidature au poste de Développeur", paragraphes: ["Je maîtrise Java et je souhaite approfondir Go (Golang).", "Cette opportunité me motive.", "Je serais heureux d'échanger avec vous."] };
    const GOOD2 = { correspondances: [], objet: "Candidature au poste de Développeur", paragraphes: ["J'ai développé des API REST en Java Spring Boot chez Nordia.", "Je n'ai pas encore utilisé Go ; je compte m'y former.", "Je serais heureux d'échanger avec vous."] };
    const client = new OllamaClient({
      fetch: async (_u, init) => {
        const b = JSON.parse(String(init?.body));
        bodies.push(b);
        return json({ message: { content: JSON.stringify(bodies.length === 1 ? BAD : GOOD2) } });
      },
    });
    const { content } = await writeCoverLetter(client, { ...JOB, description: job }, kit);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages[1].content).toMatch(/PROBLÈMES À CORRIGER/);
    expect(bodies[1].messages[1].content).toMatch(/maîtrise/);
    expect(content).toContain("Je n'ai pas encore utilisé Go");
    expect(content).not.toContain("opportunité");
  });

  it("lettre correcte → un seul appel à l'IA", async () => {
    let calls = 0;
    const client = new OllamaClient({ fetch: async () => (calls++, json({ message: { content: JSON.stringify({ correspondances: [], ...DRAFT }) } })) });
    await writeCoverLetter(client, JOB, KIT);
    expect(calls).toBe(1);
  });
});

describe("atouts / manques et formulation humaine (cas n°2)", () => {
  const cv = [
    "Compétences : Java, Spring Boot, Vue.js, React, Node.js, PostgreSQL, Docker, JWT",
    "Codalia : plateforme de partage de code en React et Node.js, authentification JWT avec Auth0, base PostgreSQL, déploiement Docker Compose",
    "ACMEPAY : API REST en Java Spring Boot, microservices",
  ].join("\n");
  const job = "Microservices en Go (Golang), gRPC, Node.js, React, PostgreSQL, authentification OAuth2 / JWT, Docker, Kubernetes.";

  it("calcule les atouts (avec la ligne concrète du CV) et les manques, dans l'ordre de l'annonce", () => {
    const { strengths, gaps } = strengthsAndGaps(job, cv);
    const auth = strengths.find((x) => x.id === "auth");
    expect(auth?.proof).toMatch(/^Codalia/);
    expect(strengths.map((x) => x.id)).toEqual(expect.arrayContaining(["microservices", "react", "postgresql", "docker"]));
    expect(strengths[0]?.id).toBe("microservices");
    expect(gaps).toEqual(expect.arrayContaining(["Go", "gRPC"]));
    expect(gaps.join()).not.toMatch(/React|PostgreSQL/);
  });

  it("compare aussi les compétences personnalisées d'un métier non informatique", () => {
    const cv = "Assistante comptable : j'ai suivi la paie avec Sage et Excel.";
    const job = "Assistant comptable. Compétences demandées : paie, Sage et Excel.";
    const skills = ["Paie", "Sage", "Excel"];
    const { strengths, gaps } = strengthsAndGaps(job, cv, skills);
    expect(strengths.map((x) => x.skill)).toEqual(skills);
    expect(strengths[0]?.proof).toContain("paie");
    expect(gaps).toEqual([]);
    expect(findLetterIssues("Je maîtrise la paie avec Sage.", { ...KIT, cvText: cv, mastered: "Paie, Sage" }, job)).toEqual([]);
  });

  it("le prompt contient le tableau ATOUTS VÉRIFIÉS et MANQUES avant le CV", () => {
    const prompt = buildLetterPrompt({ ...JOB, description: job }, { ...KIT, cvText: cv });
    expect(prompt.indexOf("ATOUTS VÉRIFIÉS")).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf("MANQUES")).toBeLessThan(prompt.indexOf("CV DU CANDIDAT"));
    expect(prompt).toMatch(/JWT \/ OAuth ← CV : « Codalia/);
  });

  it("repère les « J'ai » en série, les clichés, la techno répétée et les atouts oubliés", () => {
    const bad = [
      "Cette offre correspond à mon parcours.",
      "J'ai des bases solides en Java.",
      "J'ai utilisé Docker Compose sur un projet.",
      "J'ai aussi utilisé Docker Compose pour un autre projet.",
      "Docker me sert tous les jours.",
      "Ces expériences m'ont exposé à des applications métier complexes et je serais intéressé par ce poste.",
    ].join(" ");
    const issues = findLetterIssues(bad, { ...KIT, cvText: cv }, "Java, Kotlin.");
    const all = issues.join("\n");
    expect(all).toMatch(/Trois phrases de suite commencent par « J'ai »/);
    expect(all).toMatch(/correspond à mon parcours/);
    expect(all).toMatch(/bases solides/);
    expect(all).toMatch(/Docker.*cité 3 fois/);
    const forgot = findLetterIssues("Chez ACMEPAY, j'ai conçu des API en microservices.", { ...KIT, cvText: cv }, job).join("\n");
    expect(forgot).toMatch(/absents de la lettre.*React/);
  });
});

describe("vérité projet ↔ techno, entreprise nommée, « j'ai » (cas n°3)", () => {
  const cv = [
    "09/2023 – 09/2025 : Développeur Frontend — Alternance · ACMEPAY",
    "- Développement d'interfaces web en Vue.js pour un logiciel de supervision bancaire",
    "03/2023 – 09/2023 : Développeur Backend — Alternance · ACMEPAY",
    "- Développement et maintenance d'un serveur backend Java Spring Boot",
    "- Tests des services via Postman et vérification des données en base PostgreSQL",
    "",
    "PROJETS",
    "- Codalia — Projet de fin d'études : réseau social de partage de code. React, Node JS, PostgreSQL, Auth0 / JWT.",
    "- Réservation de salles — Projet d'architecture logicielle : Java / Spring Boot, Flutter, Docker Compose.",
    "",
    "COMPÉTENCES",
    "- Architecture : API REST, Clean Architecture, Microservices",
  ].join("\n");
  const kit = { ...KIT, cvText: cv };
  const job = "Microservices, Java, React, PostgreSQL.";

  it("lit les projets et les entreprises du CV", () => {
    const e = cvEntities(cv);
    const acme = e.find((x) => x.name === "ACMEPAY");
    const parking = e.find((x) => x.name === "Réservation de salles");
    expect(e.filter((x) => x.name === "ACMEPAY")).toHaveLength(1);
    expect([...(acme?.skills ?? [])]).toEqual(expect.arrayContaining(["vue", "spring", "postgresql"]));
    expect(parking?.skills.has("microservices")).toBe(false);
    expect(parking?.skills.has("docker")).toBe(true);
  });

  it("repère « microservices … projet de réservation de salles » et une entreprise non nommée", () => {
    const issues = findLetterIssues("J'ai pratiqué les concepts de Microservices, comme lors du projet de réservation de salles. Sur Codalia, l'authentification reposait sur JWT et PostgreSQL.", kit, job);
    expect(issues[0]).toMatch(/Microservices n'est pas écrit pour Réservation de salles/);
    expect(issues.join("\n")).toMatch(/Nomme l'entreprise \(ACMEPAY\)/);
    expect(issues.join("\n")).not.toMatch(/pas écrit pour Codalia/);
  });

  it("compte les « j'ai » de toute la lettre et les nouvelles phrases creuses", () => {
    const body = "Chez ACMEPAY, j'ai fait A. Puis j'ai fait B. Ensuite j'ai fait C, et j'ai fait D. Enfin j'ai fait E et j'ai fait F. Ma démarche structurée, ce qui me permet d'avancer.";
    const all = findLetterIssues(body, kit, job).join("\n");
    expect(all).toMatch(/« J'ai » revient 6 fois/);
    expect(all).toMatch(/démarche structurée/);
    expect(all).toMatch(/ce qui me permet/);
  });
});

describe("pas de fausse alerte", () => {
  const cv = "09/2023 – 09/2025 : Développeur — Alternance · ACMEPAY\n- Interfaces en Vue.js, données en base PostgreSQL\n\n- Codalia — Projet : React, Node JS.\n- Agenda Santé — Projet : .NET 8, SQL Server.";
  const kit = { ...KIT, cvText: cv };
  it("deux faits dans une phrase, chacun à sa place ; manque avoué franchement", () => {
    const all = findLetterIssues("Chez ACMEPAY, j'ai développé des écrans en Vue.js et j'ai utilisé React sur Codalia. J'ai vérifié des données en base PostgreSQL et j'ai utilisé SQL sur Agenda Santé. Je n'ai pas encore utilisé Go (Golang) ; mes connaissances en Java m'aideront.", kit, "Vue.js, React, Go (Golang).").join("\n");
    expect(all).not.toMatch(/n'est pas écrit pour/);
    expect(all).not.toMatch(/Go.*n'est pas dans le CV/);
  });
});

describe("règles du candidat (cas Solvia)", () => {
  const cv = [
    "09/2023 – 09/2025 : Développeur Frontend — Alternance · ACMEPAY",
    "- Création de 6 écrans de gestion de la fraude en Vue.js, migration Vue 3 en TypeScript",
    "",
    "- Codalia — Projet : React, Node JS, PostgreSQL.",
    "- Agenda Santé — Projet : Flutter, Docker.",
  ].join("\n");
  const kit = {
    ...KIT,
    cvText: cv,
    rules: "Paragraphe 2 : toujours ACMEPAY. Seuls chiffres autorisés : deux ans et demi, 6 écrans.",
    mastered: "Vue.js, TypeScript, Java Spring Boot, API REST",
    closing: "Rigoureux, curieux et impliqué, je serais heureux d'échanger avec vous pour rejoindre {entreprise}.",
    bannedWords: "je candidate, De plus, Concernant",
  };
  const job = "Développeur Fullstack\nSolvia\nUne équipe qui construit des choses concrètes, avec un impact direct et mesurable sur le terrain. Stack : React / TypeScript, Tailwind, Node.js / Express, PostgreSQL, Redis, Flutter, Google Cloud.";

  it("le prompt contient les règles du candidat, ses technos maîtrisées et annonce la fin automatique", () => {
    const p = buildLetterPrompt({ ...JOB, company: "Solvia", description: job }, kit);
    expect(p.indexOf("RÈGLES DU CANDIDAT")).toBe(0);
    expect(p).toContain("toujours ACMEPAY");
    expect(p).toMatch(/CE QU'IL MAÎTRISE.*Vue\.js/);
    expect(p).toMatch(/N'écris PAS de conclusion/);
    expect(p).toMatch(/NE LES LISTE PAS/);
  });

  it("« maîtrise » accepté seulement pour les technos déclarées ; manques listés, mots interdits perso, chiffres inventés, phrase recopiée", () => {
    const issues = findLetterIssues(
      [
        "Je maîtrise Vue.js et TypeScript.",
        "Maîtriser la stack React et Node.js est au cœur de mon parcours.",
        "Je candidate car Solvia construit des outils avec un impact direct et mesurable sur le terrain.",
        "De plus, j'ai créé 12 écrans chez ACMEPAY.",
        "Je n'ai pas encore utilisé Tailwind, Express ou Redis.",
      ].join(" "),
      kit,
      job,
    ).join("\n");
    expect(issues).not.toMatch(/« Je maîtrise Vue\.js/);
    expect(issues).toMatch(/Pas de « maîtrise ».*Maîtriser la stack React/);
    const windev = findLetterIssues("Je souhaite approfondir ma maîtrise de l'environnement Windev en m'appuyant sur ma pratique de Java Spring Boot.", kit, job).join("\n");
    expect(windev).toMatch(/Pas de « maîtrise »/);
    expect(issues).toMatch(/Ne liste pas tes manques \((?=.*Tailwind)(?=.*Express)(?=.*Redis)/);
    expect(issues).toMatch(/Supprime « je candidate »/);
    expect(issues).toMatch(/Supprime « De plus »/);
    expect(issues).toMatch(/chiffre « 12 »/);
    expect(issues).not.toMatch(/chiffre « 6 »/);
    expect(issues).toMatch(/Phrase recopiée de l'annonce/);
  });

  it("la conclusion de l'IA est remplacée par le dernier paragraphe fixe, avec le nom de l'entreprise", async () => {
    const draft = { correspondances: [], objet: "Candidature au poste de Développeur Fullstack", paragraphes: ["Chez ACMEPAY, j'ai créé 6 écrans en Vue.js.", "Sur Codalia, j'ai travaillé avec React et Node JS, et PostgreSQL.", "Je serais ravi de vous rencontrer en entretien."] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(draft) } }) });
    const { content } = await writeCoverLetter(client, { ...JOB, company: "Solvia", description: job }, kit);
    expect(content).not.toContain("vous rencontrer en entretien");
    expect(content).toContain("impliqué, je serais heureux d'échanger avec vous pour rejoindre Solvia.");
    expect(content.indexOf("rejoindre Solvia")).toBeLessThan(content.indexOf("Je vous prie d'agréer"));
  });
});

describe("candidature spontanée (pas d'offre)", () => {
  const company = { name: "ALPHA LOGICIELS", sector: "Programmation informatique", city: "Vénissieux", department: "69", headcountMin: 10, headcountMax: 19 };
  const job = spontaneousJobInput(company, "Développeur full stack");

  it("décrit seulement ce qu'on sait de l'entreprise, et le prompt interdit « votre offre »", () => {
    expect(job.description).toContain("AUCUNE offre");
    expect(job.description).toContain("Secteur d'activité : Programmation informatique");
    expect(job.description).toContain("10 à 19 salariés");
    const p = buildLetterPrompt(job, KIT, { spontaneous: true });
    expect(p.startsWith("CANDIDATURE SPONTANÉE")).toBe(true);
    expect(p).toMatch(/N'invente RIEN sur l'entreprise/);
    expect(buildLetterPrompt(job, KIT)).not.toMatch(/CANDIDATURE SPONTANÉE \(priorité/);
  });

  it("« votre offre » signalé ; objet imposé « Candidature spontanée – … »", async () => {
    const issues = findLetterIssues("Votre offre a retenu mon attention.", KIT, job.description, { spontaneous: true }).join("\n");
    expect(issues).toMatch(/il n'y a pas d'offre/);
    const draft = { correspondances: [], objet: "Candidature au poste de Développeur", paragraphes: ["Chez Nordia, j'ai créé des écrans en Vue.js.", "Sur mon projet, j'ai utilisé Docker.", "Je serais heureux d'échanger avec vous."] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(draft) } }) });
    const { content } = await writeCoverLetter(client, job, KIT, new Date(), { spontaneous: true });
    expect(content).toContain("Objet : Candidature spontanée – Développeur full stack");
  });
});

describe("règles longues du candidat et style « j'ai »", () => {
  it("envoie des règles longues en entier à l'IA (la liste des faits n'est plus coupée)", () => {
    const rules = `${"STRUCTURE : intro imposée. ".repeat(200)}\nFAITS : écran de planning chez Nordia.`;
    expect(rules.length).toBeGreaterThan(5_000);
    expect(buildLetterPrompt(JOB, { ...KIT, rules }, {})).toContain("FAITS : écran de planning chez Nordia.");
  });

  it("accepte « approfondir X en m'appuyant sur Y » et les « j'ai » d'une lettre longue", () => {
    const job = "Développeur Java Spring Boot, Kafka, Vue.js.";
    const gap = "Je souhaite approfondir Kafka en m'appuyant sur ma pratique de Java Spring Boot.";
    expect(findLetterIssues(gap, KIT, job).join("\n")).not.toMatch(/Kafka n'est pas dans le CV/);
    expect(findLetterIssues("Je souhaite approfondir ma connaissance de Kafka.", KIT, job).join("\n")).toMatch(/Kafka n'est pas dans le CV/);
    const filler = "Le module servait aux équipes de suivi chaque jour et devait rester simple à lire pour tout le monde. ";
    const long = `Chez Nordia, j'ai développé des écrans Vue.js. ${filler}${filler}`.repeat(8);
    expect(findLetterIssues(long, KIT, job).join("\n")).not.toMatch(/« J'ai » revient/);
  });

  it("repère le tiret long et les adverbes répétés", () => {
    const all = findLetterIssues("Chez Nordia — en Vue.js — j'ai notamment créé un écran. J'ai notamment migré un module.", KIT, "Vue.js").join("\n");
    expect(all).toMatch(/tiret long/);
    expect(all).toMatch(/Supprime un « notamment »/);
  });
});
