import { EXAMPLE_PROFILE } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { buildQueries } from "./collect";

describe("buildQueries", () => {
  it("chaque recherche × chaque zone", () => {
    const q = buildQueries(EXAMPLE_PROFILE, 7, 300);
    expect(q).toHaveLength(EXAMPLE_PROFILE.searches.length * EXAMPLE_PROFILE.locations.length);
    expect(q[0]).toEqual({ keywords: "Développeur Vue.js", department: "69", maxResults: 300, publishedSinceDays: 7 });
    expect(q[1]!.department).toBe("75");
  });
});
