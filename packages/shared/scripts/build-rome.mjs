// Fabrique src/rome-data.json à partir des fichiers officiels du ROME (France Travail, Licence Ouverte Etalab).
// 1. Télécharge « Toutes les données du ROME » au format CSV :
//    https://www.data.gouv.fr/datasets/repertoire-operationnel-des-metiers-et-des-emplois-rome
// 2. Décompresse le .zip dans un dossier.
// 3. node packages/shared/scripts/build-rome.mjs <dossier>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Usage : node build-rome.mjs <dossier des CSV du ROME>");

/** Lecture CSV simple : champs entre guillemets, "" pour un guillemet. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (c !== "\r") field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...data] = rows;
  return data.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const file = (prefix) => {
  const name = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".csv"));
  if (!name) throw new Error(`Fichier ${prefix}*.csv introuvable dans ${dir}`);
  return parseCsv(readFileSync(join(dir, name), "utf8"));
};

const version = readFileSync(join(dir, "version.txt"), "utf8").match(/Titre\/commentaire : (.+)/)?.[1]?.trim() ?? "ROME 4.0";
const codes = {};
for (const r of file("unix_referentiel_code_rome_v")) codes[r.code_rome] = [r.libelle_rome, r.code_rome_parent || r.code_rome];
const appellations = file("unix_referentiel_appellation_v")
  .filter((a) => a.peu_usite !== "O" && codes[a.code_rome])
  .map((a) => [a.libelle_appellation_court || a.libelle_appellation_long, a.code_rome]);

writeFileSync(new URL("../src/rome-data.json", import.meta.url), `${JSON.stringify({ version, codes, appellations })}\n`);
console.log(`${version} : ${Object.keys(codes).length} codes, ${appellations.length} appellations`);
