import { describe, expect, it } from "vitest";
import { pickRomeWithAi } from "./rome-choice";

const CANDIDATES = [
  { code: "J1506", label: "Infirmier / Infirmière en soins généraux (IDE)" },
  { code: "J1505", label: "Infirmier / Infirmière de prévention" },
  { code: "J1507", label: "Puériculteur / Puéricultrice" },
];

describe("choix des codes métier par l'IA locale", () => {
  it("n'autorise que les codes de la liste dans le format de réponse", async () => {
    let schema: unknown;
    const client = {
      chatJson: async (_s: string, user: string, jsonSchema: object) => {
        schema = jsonSchema;
        expect(user).toContain("J1506 : Infirmier / Infirmière en soins généraux (IDE)");
        return { codes: ["J1506"] };
      },
    };
    expect(await pickRomeWithAi(client, ["Infirmière"], CANDIDATES)).toEqual(["J1506"]);
    expect(schema).toMatchObject({ properties: { codes: { items: { enum: ["J1506", "J1505", "J1507"] }, maxItems: 5 } } });
  });

  it("écarte un code inventé ou en double, et limite le nombre", async () => {
    const client = { chatJson: async () => ({ codes: ["Z9999", "J1505", "J1505", "J1506", "J1507"] }) };
    expect(await pickRomeWithAi(client, ["Infirmière"], CANDIDATES, 2)).toEqual(["J1505", "J1506"]);
  });

  it("aucune candidate : pas d'appel à l'IA", async () => {
    const client = {
      chatJson: async () => {
        throw new Error("ne doit pas être appelée");
      },
    };
    expect(await pickRomeWithAi(client, ["Infirmière"], [])).toEqual([]);
  });

  it("réponse hors format → erreur", async () => {
    await expect(pickRomeWithAi({ chatJson: async () => ({ autre: 1 }) }, ["X"], CANDIDATES)).rejects.toThrow("hors format");
  });
});
