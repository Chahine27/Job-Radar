import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, ProfileSchema, ScoringWeightsSchema } from "./profile";

describe("ProfileSchema", () => {
  it("accepte le profil par défaut", () => {
    expect(ProfileSchema.safeParse(DEFAULT_PROFILE).success).toBe(true);
  });

  it("refuse des poids dont la somme n'est pas 1", () => {
    const res = ScoringWeightsSchema.safeParse({
      ...DEFAULT_PROFILE.scoringWeights,
      technical: 0.5,
    });
    expect(res.success).toBe(false);
  });

  it("refuse experienceMin > experienceMax", () => {
    const res = ProfileSchema.safeParse({
      ...DEFAULT_PROFILE,
      experienceMin: 5,
      experienceMax: 2,
    });
    expect(res.success).toBe(false);
  });

  it("complète les compétences d'un ancien profil qui n'en avait pas", () => {
    const { skills: _ignored, ...old } = DEFAULT_PROFILE;
    const res = ProfileSchema.parse(old);
    expect(res.skills).toContain("Vue.js");
  });

  it("refuse un code département invalide", () => {
    const res = ProfileSchema.safeParse({
      ...DEFAULT_PROFILE,
      locations: [{ label: "X", department: "Oise" }],
    });
    expect(res.success).toBe(false);
  });
});
