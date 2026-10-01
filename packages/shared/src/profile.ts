import { z } from "zod";

/** Poids du score final (README §4). Doivent faire 1 au total. */
export const ScoringWeightsSchema = z
  .object({
    technical: z.number().min(0).max(1),
    experience: z.number().min(0).max(1),
    contract: z.number().min(0).max(1),
    salary: z.number().min(0).max(1),
    location: z.number().min(0).max(1),
    transport: z.number().min(0).max(1),
  })
  .refine(
    (w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-6,
    { message: "La somme des poids doit être égale à 1" },
  );
export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const LocationTargetSchema = z.object({
  label: z.string().min(1),
  /** Code département, ex. "60" pour l'Oise. */
  department: z.string().regex(/^(\d{2}|2A|2B|\d{3})$/),
});

export const PreferredTechSchema = z.object({
  name: z.string().min(1),
  /** Importance relative, 0 à 1. */
  weight: z.number().min(0).max(1),
});

/** Compétences maîtrisées par défaut (README §2). Modifiable depuis l'interface. */
export const DEFAULT_SKILLS = [
  "Vue.js",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "Java",
  "Spring Boot",
  "API REST",
  "C#",
  ".NET",
  "Python",
  "C",
  "C++",
  "SQL",
  "HTML",
  "CSS",
  "Docker",
  "Git",
  "GitLab",
  "CI/CD",
];

export const ProfileSchema = z
  .object({
    /** Ce que tu maîtrises : sert au pourcentage technique. */
    skills: z.array(z.string().trim().min(1)).min(1).default(DEFAULT_SKILLS),
    contracts: z.array(z.string().min(1)).min(1),
    experienceMin: z.number().int().min(0),
    experienceMax: z.number().int().min(0),
    salaryTarget: z.number().int().positive().nullable(),
    salaryMinimum: z.number().int().positive().nullable(),
    locations: z.array(LocationTargetSchema).min(1),
    /** Ce que tu préfères : sert aux recherches et à départager deux offres de même score. */
    preferredTechs: z.array(PreferredTechSchema).min(1),
    searches: z.array(z.string().min(2)).min(1),
    scoringWeights: ScoringWeightsSchema,
    /** Candidatures spontanées (La Bonne Boîte) : métiers ROME et rayon autour du point de départ. */
    spontaneous: z
      .object({
        romes: z.array(z.string().regex(/^[A-N]\d{4}$/, "Code ROME invalide (ex. M1805)")).min(1).max(5),
        distanceKm: z.number().int().min(5).max(100),
        /** Zone propre aux candidatures spontanées (indépendante du point de départ des offres). */
        place: z
          .object({ label: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
          .nullable()
          .default(null),
        departments: z.array(z.string().regex(/^(\d{2}|2A|2B|\d{3})$/, "Code département invalide (ex. 60)")).max(10).default([]),
      })
      .default({ romes: ["M1805"], distanceKm: 30, place: null, departments: [] }),
    minScoreForAnalysis: z.number().int().min(0).max(100),
    minScoreForNotification: z.number().int().min(0).max(100),
  })
  .refine((p) => p.experienceMin <= p.experienceMax, {
    message: "experienceMin doit être ≤ experienceMax",
    path: ["experienceMin"],
  });
export type Profile = z.infer<typeof ProfileSchema>;

/** Profil par défaut tiré du README (§2, §3, §17). Modifiable ensuite depuis l'interface. */
export const DEFAULT_PROFILE: Profile = {
  skills: DEFAULT_SKILLS,
  contracts: ["CDI"],
  experienceMin: 1,
  experienceMax: 3,
  salaryTarget: 40000,
  salaryMinimum: 38000,
  locations: [
    { label: "Oise", department: "60" },
    { label: "Paris", department: "75" },
  ],
  preferredTechs: [
    { name: "Vue.js", weight: 1 },
    { name: "Java", weight: 0.9 },
    { name: "Spring Boot", weight: 0.9 },
    { name: "React", weight: 0.8 },
    { name: "TypeScript", weight: 0.8 },
    { name: "Node.js", weight: 0.7 },
    { name: ".NET", weight: 0.6 },
    { name: "C#", weight: 0.6 },
    { name: "JavaScript", weight: 0.6 },
  ],
  searches: [
    "Développeur Vue.js",
    "Développeur Java Spring",
    "Développeur React TypeScript",
    "Développeur Node.js",
    "Développeur Full Stack",
    "Développeur .NET",
  ],
  scoringWeights: {
    technical: 0.35,
    experience: 0.2,
    contract: 0.15,
    salary: 0.1,
    location: 0.1,
    transport: 0.1,
  },
  spontaneous: { romes: ["M1805"], distanceKm: 30, place: null, departments: [] },
  minScoreForAnalysis: 55,
  minScoreForNotification: 70,
};
