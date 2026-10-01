// Mise à jour automatique de Job Radar, lancée par scripts/lancer.ps1 à chaque démarrage.
// Compare la version installée à la dernière « Release » publiée sur GitHub (ni brouillon ni préversion) ;
// si elle est plus récente : télécharge son ZIP et remplace les fichiers du programme.
// Ne touche JAMAIS à .env, data\ (la base), node_modules\ ni aux fichiers locaux.
// Node seul (aucun module à installer) : marche même avant « pnpm install ».
// API : GET https://api.github.com/repos/{owner}/{repo}/releases/latest (sans clé, 60 appels/heure par connexion).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION_FILE = ".update-version";
export const MANIFEST_FILE = ".update-manifest.json";

/** « v1.2.3 » / « 1.2 » → [1, 2, 3] ; null si ce n'est pas une version. */
export function parseVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** La version publiée est-elle STRICTEMENT plus récente (jamais de retour en arrière) ? */
export function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current) ?? [0, 0, 0];
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Fichiers de l'utilisateur ou générés sur son PC : jamais remplacés ni supprimés. */
export function isProtected(relPath) {
  const p = relPath.split(sep).join("/");
  const parts = p.split("/");
  if (parts.some((x) => x === "node_modules" || x === ".git" || x === "generated" || x === "dist" || x === "coverage")) return true;
  const top = parts[0];
  if (top === "data" || top === "Claude outputs") return true;
  if (parts.length === 1) {
    if (p === ".env.example") return false;
    if (p === ".env" || p.startsWith(".env.") || p === VERSION_FILE || p === MANIFEST_FILE || p === "CLAUDE.md") return true;
  }
  return p.endsWith(".log");
}

/** Tous les fichiers d'un dossier (chemins relatifs), sans les fichiers protégés. */
export function listFiles(root, dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full);
    if (isProtected(rel)) continue;
    if (statSync(full).isDirectory()) out.push(...listFiles(root, full));
    else out.push(rel.split(sep).join("/"));
  }
  return out;
}

/** Version installée : celle de la dernière mise à jour, sinon celle de package.json. */
export function installedVersion(root) {
  const f = join(root, VERSION_FILE);
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Dépôt GitHub d'où viennent les mises à jour (« propriétaire/nom »), écrit dans package.json. */
export function updateRepo(root) {
  try {
    const repo = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).jobRadar?.updateRepo;
    return typeof repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
  } catch {
    return null;
  }
}

/** Dernière Release publiée, ou null (aucune release, hors ligne, limite d'appels…). */
export async function latestRelease(repo, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "job-radar-updater" },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null; // aucune release publiée
  if (!res.ok) throw new Error(`GitHub répond HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body.tag_name !== "string" || typeof body.zipball_url !== "string") throw new Error("réponse GitHub illisible");
  return { tag: body.tag_name, zipUrl: body.zipball_url, name: typeof body.name === "string" ? body.name : body.tag_name, notes: typeof body.body === "string" ? body.body : "" };
}

/** Copie la nouvelle version par-dessus l'ancienne. Ne réécrit que les fichiers qui ont changé. */
export function applyRelease(root, srcDir) {
  const files = listFiles(srcDir);
  let changed = 0;
  // Les .cmd en dernier : Windows lit un .cmd pendant qu'il s'exécute.
  const ordered = [...files.filter((f) => !f.endsWith(".cmd")), ...files.filter((f) => f.endsWith(".cmd"))];
  for (const rel of ordered) {
    const from = join(srcDir, rel);
    const to = join(root, rel);
    if (existsSync(to) && readFileSync(to).equals(readFileSync(from))) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { force: true });
    changed++;
  }
  // Fichiers retirés de la nouvelle version : supprimés seulement s'ils venaient d'une mise à jour précédente.
  let removed = 0;
  const manifest = join(root, MANIFEST_FILE);
  if (existsSync(manifest)) {
    const keep = new Set(files);
    for (const rel of JSON.parse(readFileSync(manifest, "utf8"))) {
      if (typeof rel !== "string" || keep.has(rel) || isProtected(rel) || rel.includes("..")) continue;
      const p = join(root, rel);
      if (existsSync(p)) {
        unlinkSync(p);
        removed++;
      }
    }
  }
  writeFileSync(manifest, JSON.stringify(files));
  return { changed, removed };
}

/** Décompresse un ZIP avec l'outil intégré à Windows (PowerShell). */
function extractZip(zip, dest) {
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dest)} -Force`], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("décompression impossible");
}

/**
 * Vérifie et installe. Renvoie « updated », « up-to-date » ou « skipped ».
 * Ne bloque jamais le lancement : en cas de problème, on démarre la version actuelle.
 */
export async function runUpdate(root, deps = {}) {
  const log = deps.log ?? console.log;
  const fetchImpl = deps.fetch ?? fetch;
  if (existsSync(join(root, ".git"))) {
    log("Dossier géré avec git : pas de mise à jour automatique (utilise git pull).");
    return "skipped";
  }
  const repo = updateRepo(root);
  if (!repo) return "skipped";
  const current = installedVersion(root);
  let release;
  try {
    release = await latestRelease(repo, fetchImpl);
  } catch (err) {
    log(`Mise à jour non vérifiée (${err instanceof Error ? err.message : err}) : lancement de la version actuelle.`);
    return "skipped";
  }
  if (!release || !isNewer(release.tag, current)) {
    log(`Version à jour (${current}).`);
    return "up-to-date";
  }
  log(`Nouvelle version ${release.tag} (tu as ${current}) : téléchargement…`);
  const work = mkdtempSync(join(tmpdir(), "job-radar-update-"));
  try {
    const res = await fetchImpl(release.zipUrl, { headers: { "User-Agent": "job-radar-updater" }, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`téléchargement HTTP ${res.status}`);
    const zip = join(work, "release.zip");
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const out = join(work, "x");
    (deps.extract ?? extractZip)(zip, out);
    // Le ZIP de GitHub contient un seul dossier (« propriétaire-dépôt-xxxxxxx »).
    const dirs = readdirSync(out);
    const src = dirs.length === 1 && statSync(join(out, dirs[0])).isDirectory() ? join(out, dirs[0]) : out;
    if (!existsSync(join(src, "package.json"))) throw new Error("ZIP inattendu (pas de package.json)");
    const { changed, removed } = applyRelease(root, src);
    writeFileSync(join(root, VERSION_FILE), release.tag);
    log(`Mise à jour ${release.tag} installée (${changed} fichier(s) modifié(s)${removed ? `, ${removed} supprimé(s)` : ""}).`);
    if (release.notes.trim()) log(`Nouveautés :\n${release.notes.trim().slice(0, 1500)}`);
    return "updated";
  } catch (err) {
    log(`Mise à jour impossible (${err instanceof Error ? err.message : err}) : lancement de la version actuelle.`);
    return "skipped";
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Lancé directement : node scripts/update.mjs → code 10 si une mise à jour a été installée.
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = await runUpdate(root);
  process.exitCode = result === "updated" ? 10 : 0;
}
