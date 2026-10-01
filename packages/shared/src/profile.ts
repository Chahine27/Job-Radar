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
  /** Code département, ex. "69" pour le Rhône. */
  department: z.string().regex(/^(\d{2}|2A|2B|\d{3})$/),
});

export const PreferredTechSchema = z.object({
  name: z.string().min(1),
  /** Importance relative, 0 à 1. */
  weight: z.number().min(0).max(1),
});

/** Compétences d'un profil d'EXEMPLE généraliste : tests et démonstration seulement. */
export const EXAMPLE_SKILLS = [
  "Excel",
  "PowerPoint",
  "Sage",
  "Gestion de projet",
  "Relation client",
  "CRM",
  "Paie",
  "Comptabilité",
  "Rédaction de documents",
  "Organisation administrative",
  "Anglais",
  "Support client",
  "Logistique",
  "Qualité de service",
];

export const ProfileSchema = z
  .object({
    /** Ce que tu maîtrises : sert à comparer les compétences de l'offre. */
    skills: z.array(z.string().trim().min(1)).default([]),
    contracts: z.array(z.string().min(1)).min(1),
    experienceMin: z.number().int().min(0),
    experienceMax: z.number().int().min(0),
    salaryTarget: z.number().int().positive().nullable(),
    salaryMinimum: z.number().int().positive().nullable(),
    locations: z.array(LocationTargetSchema),
    /** Ce que tu préfères : sert aux recherches et à départager deux offres de même score. */
    preferredTechs: z.array(PreferredTechSchema),
    searches: z.array(z.string().min(2)),
    scoringWeights: ScoringWeightsSchema,
    /** Candidatures spontanées (La Bonne Boîte) : métiers ROME et rayon autour du point de départ. */
    spontaneous: z
      .object({
        romes: z.array(z.string().regex(/^[A-N]\d{4}$/, "Code ROME invalide (ex. K2112)")).max(5),
        distanceKm: z.number().int().min(5).max(100),
        /** Zone propre aux candidatures spontanées (indépendante du point de départ des offres). */
        place: z
          .object({ label: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
          .nullable()
          .default(null),
        departments: z.array(z.string().regex(/^(\d{2}|2A|2B|\d{3})$/, "Code département invalide (ex. 60)")).max(10).default([]),
      })
      .default({ romes: [], distanceKm: 30, place: null, departments: [] }),
    /** false tant que le premier lancement (compte, CV, profil validé) n'est pas terminé. */
    setupDone: z.boolean().default(true),
    minScoreForAnalysis: z.number().int().min(0).max(100),
    minScoreForNotification: z.number().int().min(0).max(100),
  })
  .refine((p) => p.experienceMin <= p.experienceMax, {
    message: "experienceMin doit être ≤ experienceMax",
    path: ["experienceMin"],
  });
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Profil d'EXEMPLE générique : sert aux tests et à la démonstration sans imposer un métier technique.
 * Un vrai utilisateur part du profil vierge DEFAULT_PROFILE, rempli au premier lancement à partir de son CV.
 */
export const EXAMPLE_PROFILE: Profile = {
  skills: EXAMPLE_SKILLS,
  contracts: ["CDI"],
  experienceMin: 1,
  experienceMax: 5,
  salaryTarget: 40000,
  salaryMinimum: 36000,
  locations: [
    { label: "Zone A", department: "69" },
    { label: "Paris", department: "75" },
  ],
  preferredTechs: [
    { name: "Excel", weight: 1 },
    { name: "CRM", weight: 0.9 },
    { name: "Gestion de projet", weight: 0.9 },
    { name: "Sage", weight: 0.8 },
    { name: "Paie", weight: 0.8 },
    { name: "Relation client", weight: 0.7 },
    { name: "Support client", weight: 0.7 },
    { name: "Organisation administrative", weight: 0.6 },
    { name: "Anglais", weight: 0.6 },
  ],
  searches: [
    "Gestionnaire administratif",
    "Chargé de clientèle",
    "Assistant comptable",
    "Support client",
    "Coordinateur logistique",
    "Commercial B2B",
  ],
  scoringWeights: {
    technical: 0.2,
    experience: 0.25,
    contract: 0.15,
    salary: 0.2,
    location: 0.1,
    transport: 0.1,
  },
  spontaneous: { romes: ["M1607"], distanceKm: 30, place: null, departments: [] },
  minScoreForAnalysis: 55,
  minScoreForNotification: 70,
  setupDone: true,
};

/** Profil vierge d'un nouvel utilisateur : rempli au premier lancement (CV lu par l'IA, puis validé). */
export const DEFAULT_PROFILE: Profile = {
  skills: [],
  contracts: ["CDI"],
  experienceMin: 0,
  experienceMax: 5,
  salaryTarget: null,
  salaryMinimum: null,
  locations: [],
  preferredTechs: [],
  searches: [],
  scoringWeights: EXAMPLE_PROFILE.scoringWeights,
  spontaneous: { romes: [], distanceKm: 30, place: null, departments: [] },
  minScoreForAnalysis: 55,
  minScoreForNotification: 70,
  setupDone: false,
};
