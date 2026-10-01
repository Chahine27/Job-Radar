import { copyFile, readFile, rename, writeFile } from "node:fs/promises";

/**
 * Écrit une valeur pour .env : telle quelle si c'est simple, sinon entre guillemets
 * (espace, #, =, guillemet…). Guillemets simples = valeur lue sans aucune transformation.
 */
export function formatEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Valeur sur plusieurs lignes refusée");
  if (/^[^\s#="'`\\$]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !value.includes("\\")) return `"${value}"`;
  throw new Error("Valeur avec guillemets refusée");
}

const LINE_KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Remplace (ou ajoute) des lignes CLÉ=valeur dans le texte d'un .env, sans toucher aux autres lignes
 * ni aux commentaires. Valeur vide → « CLÉ= » (clé effacée, la ligne reste comme modèle).
 */
export function updateEnvText(text: string, updates: Record<string, string>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const done = new Set<string>();
  const out = lines.map((line) => {
    const key = line.match(LINE_KEY)?.[1];
    if (!key || !Object.hasOwn(updates, key)) return line;
    done.add(key);
    return `${key}=${formatEnvValue(updates[key]!)}`;
  });
  const missing = Object.keys(updates).filter((k) => !done.has(k));
  if (missing.length) {
    while (out.length && out[out.length - 1] === "") out.pop();
    if (out.length) out.push("");
    for (const k of missing) out.push(`${k}=${formatEnvValue(updates[k]!)}`);
    out.push("");
  }
  return out.join(eol);
}

/**
 * Met à jour le fichier .env : copie de sécurité « .env.bak » d'abord, puis écriture
 * dans un fichier temporaire renommé à la fin (jamais de .env à moitié écrit).
 */
export async function updateEnvFile(path: string, updates: Record<string, string>): Promise<void> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const next = updateEnvText(current, updates);
  if (current) await copyFile(path, `${path}.bak`);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, path);
}
