import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import { formatEnvValue, updateEnvFile, updateEnvText } from "./env-file";

const SAMPLE = [
  "# Modèle de réglages",
  "DATABASE_URL=postgresql://jobradar:x@127.0.0.1:5433/jobradar",
  "",
  "# --- France Travail ---",
  "FRANCE_TRAVAIL_CLIENT_ID=",
  "FRANCE_TRAVAIL_CLIENT_SECRET=ancien",
  "# OLLAMA_URL=http://127.0.0.1:11434",
  "",
].join("\r\n");

describe("écriture du fichier .env", () => {
  it("met entre guillemets les valeurs avec espace, # ou =", () => {
    expect(formatEnvValue("abc123")).toBe("abc123");
    expect(formatEnvValue("abcd efgh")).toBe("'abcd efgh'");
    expect(formatEnvValue("a#b")).toBe("'a#b'");
    expect(formatEnvValue("a=b")).toBe("'a=b'");
    expect(formatEnvValue("l'appli")).toBe(`"l'appli"`);
    expect(() => formatEnvValue("a\nb")).toThrow();
  });

  it("chaque valeur est relue à l'identique", () => {
    const values = { A: "simple", B: "avec espace", C: "x#y=z", D: `Job Radar <camille.martin@example.com>`, E: `l'appli`, F: `"cité"`, G: "a$b\\c" };
    const parsed = parse(updateEnvText("", values));
    expect(parsed).toEqual(values);
  });

  it("garde les autres lignes et les commentaires, remplace les clés, ajoute les nouvelles", () => {
    const out = updateEnvText(SAMPLE, { FRANCE_TRAVAIL_CLIENT_ID: "PAR_test", FRANCE_TRAVAIL_CLIENT_SECRET: "", JOOBLE_API_KEY: "abcd-1234" });
    const lines = out.split("\r\n");
    expect(lines).toContain("# Modèle de réglages");
    expect(lines).toContain("# OLLAMA_URL=http://127.0.0.1:11434");
    expect(lines).toContain("DATABASE_URL=postgresql://jobradar:x@127.0.0.1:5433/jobradar");
    expect(lines).toContain("FRANCE_TRAVAIL_CLIENT_ID=PAR_test");
    expect(lines).toContain("FRANCE_TRAVAIL_CLIENT_SECRET=");
    expect(lines.indexOf("FRANCE_TRAVAIL_CLIENT_ID=PAR_test")).toBe(4);
    expect(lines.at(-2)).toBe("JOOBLE_API_KEY=abcd-1234");
    expect(out.includes("\n") && !/[^\r]\n/.test(out)).toBe(true); // fins de ligne Windows conservées
    expect(parse(out)).toMatchObject({ FRANCE_TRAVAIL_CLIENT_ID: "PAR_test", JOOBLE_API_KEY: "abcd-1234" });
  });

  it("fait une copie .env.bak avant d'écrire", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jr-env-"));
    const file = join(dir, ".env");
    await writeFile(file, SAMPLE, "utf8");
    await updateEnvFile(file, { ADZUNA_APP_ID: "1a2b3c4d" });
    expect(await readFile(`${file}.bak`, "utf8")).toBe(SAMPLE);
    expect(parse(await readFile(file, "utf8"))).toMatchObject({ ADZUNA_APP_ID: "1a2b3c4d", FRANCE_TRAVAIL_CLIENT_SECRET: "ancien" });
  });

  it("crée le fichier s'il n'existe pas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jr-env-"));
    const file = join(dir, ".env");
    await updateEnvFile(file, { PRIM_API_KEY: "cle-test-123" });
    expect(await readFile(file, "utf8")).toBe("PRIM_API_KEY=cle-test-123\n");
  });
});
