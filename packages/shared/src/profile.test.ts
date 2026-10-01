import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, EXAMPLE_PROFILE, ProfileSchema, ScoringWeightsSchema } from "./profile";

describe("ProfileSchema", () => {
  it("accepte le profil par défaut", () => {
    expect(ProfileSchema.safeParse(EXAMPLE_PROFILE).success).toBe(true);
  });

  it("refuse des poids dont la somme n'est pas 1", () => {
    const res = ScoringWeightsSchema.safeParse({
      ...EXAMPLE_PROFILE.scoringWeights,
      technical: 0.5,
    });
    expect(res.success).toBe(false);
  });

  it("refuse experienceMin > experienceMax", () => {
    const res = ProfileSchema.safeParse({
      ...EXAMPLE_PROFILE,
      experienceMin: 5,
      experienceMax: 2,
    });
    expect(res.success).toBe(false);
  });

  it("ancien profil sans compétences ni « setupDone » : liste vide, premier lancement considéré comme fait", () => {
    const { skills: _ignored, setupDone: _s, ...old } = EXAMPLE_PROFILE;
    const res = ProfileSchema.parse(old);
    expect(res.skills).toEqual([]);
    expect(res.setupDone).toBe(true);
  });

  it("profil vierge d'un nouvel utilisateur : valide, aucune donnée personnelle, premier lancement à faire", () => {
    const p = ProfileSchema.parse(DEFAULT_PROFILE);
    expect(p.setupDone).toBe(false);
    expect([p.skills, p.searches, p.locations, p.preferredTechs, p.spontaneous.romes]).toEqual([[], [], [], [], []]);
    expect(p.salaryTarget).toBeNull();
  });

  it("refuse un code département invalide", () => {
    const res = ProfileSchema.safeParse({
      ...EXAMPLE_PROFILE,
      locations: [{ label: "X", department: "Rhône" }],
    });
    expect(res.success).toBe(false);
  });
});
