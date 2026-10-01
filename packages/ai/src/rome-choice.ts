import { z } from "zod";
import type { OllamaClient } from "./ollama";

export const ROME_CHOICE_PROMPT = `Tu aides une personne à trouver les fiches métier officielles (codes ROME de France Travail) qui correspondent à sa recherche d'emploi.
On te donne les intitulés de poste qu'elle recherche et une liste de fiches métier possibles (code + libellé).
Choisis dans CETTE LISTE SEULEMENT les fiches qui correspondent vraiment à ce qu'elle recherche, de la plus proche à la moins proche.
Ignore les fiches d'un autre métier, même si un mot est en commun. Réponds UNIQUEMENT avec le JSON demandé.`;

/**
 * L'IA locale choisit parmi des fiches de la liste officielle (déjà trouvées par recherche de mots).
 * Le format de réponse n'autorise que ces codes : elle ne peut rien inventer.
 */
export async function pickRomeWithAi(
  client: Pick<OllamaClient, "chatJson">,
  searches: string[],
  candidates: Array<{ code: string; label: string }>,
  max = 5,
): Promise<string[]> {
  const allowed = [...new Set(candidates.map((c) => c.code))];
  if (allowed.length === 0) return [];
  const schema = {
    type: "object",
    properties: { codes: { type: "array", items: { type: "string", enum: allowed }, maxItems: max } },
    required: ["codes"],
  };
  const list = candidates.map((c) => `- ${c.code} : ${c.label}`).join("\n");
  const raw = await client.chatJson(
    ROME_CHOICE_PROMPT,
    `Intitulés recherchés : ${searches.join(" ; ")}\n\nFiches possibles :\n${list}\n\nChoisis au plus ${max} codes.`,
    schema,
    { temperature: 0 },
  );
  const parsed = z.object({ codes: z.array(z.string()) }).safeParse(raw);
  if (!parsed.success) throw new Error("Réponse de l'IA hors format.");
  return [...new Set(parsed.data.codes.filter((c) => allowed.includes(c)))].slice(0, max);
}
