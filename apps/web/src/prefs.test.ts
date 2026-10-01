import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

const saved: Array<[string, unknown]> = [];
vi.mock("./api", () => ({
  api: {
    getPrefs: async () => ({ offres: { minScore: 60, source: "adzuna", inconnu: 1, includeHidden: "pas un booléen" } }),
    savePrefs: async (page: string, value: unknown) => void saved.push([page, value]),
  },
}));

describe("préférences de filtres", () => {
  it("reprend les filtres du serveur (seulement les réglages connus et du bon type), puis enregistre les changements", async () => {
    vi.useFakeTimers();
    const { usePrefs } = await import("./prefs");
    const f = usePrefs("offres", { minScore: 0, source: "", includeHidden: false });
    expect(f.minScore).toBe(0); // avant la réponse du serveur : valeurs par défaut
    await vi.runAllTimersAsync();
    await nextTick();
    expect({ ...f }).toEqual({ minScore: 60, source: "adzuna", includeHidden: false });
    expect(saved).toHaveLength(0); // rien à renvoyer : c'est ce que le serveur a déjà

    f.source = "france-travail";
    await nextTick();
    await vi.advanceTimersByTimeAsync(600);
    expect(saved).toEqual([["offres", { minScore: 60, source: "france-travail", includeHidden: false }]]);
    vi.useRealTimers();
  });
});
