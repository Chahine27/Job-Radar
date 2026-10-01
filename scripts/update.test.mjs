import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANIFEST_FILE, VERSION_FILE, applyRelease, installedVersion, isNewer, isProtected, parseVersion, runUpdate } from "./update.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "jr-upd-"));
function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}
const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PKG = (version) => JSON.stringify({ name: "job-radar", version, jobRadar: { updateRepo: "exemple/job-radar" } });

describe("versions", () => {
  it("lit « v1.2.3 », « 1.2 »… et refuse le reste", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2")).toEqual([1, 2, 0]);
    expect(parseVersion("beta")).toBeNull();
  });

  it("met à jour seulement vers une version plus récente (jamais en arrière)", () => {
    expect(isNewer("v1.0.1", "1.0.0")).toBe(true);
    expect(isNewer("v1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("v0.9.0", "1.0.0")).toBe(false);
    expect(isNewer("nightly", "1.0.0")).toBe(false);
  });
});

describe("fichiers protégés", () => {
  it("ne touche jamais aux données et réglages de l'utilisateur", () => {
    for (const p of [".env", ".env.bak", "data/postgres.log", "data/base/x", "node_modules/a/b.js", "apps/api/node_modules/x", ".git/HEAD", "packages/db/src/generated/client.ts", VERSION_FILE, "CLAUDE.md", "erreur.log"]) {
      expect(isProtected(p)).toBe(true);
    }
    for (const p of [".env.example", "package.json", "apps/api/src/server.ts", "scripts/lancer.ps1", "Lancer Job Radar.cmd", "docs/data.md"]) {
      expect(isProtected(p)).toBe(false);
    }
  });
});

describe("installation d'une version", () => {
  it("remplace les fichiers du programme, garde .env et data, supprime ce qui a disparu (d'après la mise à jour précédente)", () => {
    const root = tmp();
    write(root, { ".env": "CLE=secrete", "data/base": "ma base", "package.json": PKG("1.0.0"), "apps/old.ts": "ancien", "apps/same.ts": "pareil" });
    writeFileSync(join(root, MANIFEST_FILE), JSON.stringify(["apps/old.ts", "apps/same.ts", "package.json", "../hors.txt"]));
    const src = tmp();
    write(src, { ".env": "NE PAS COPIER", "data/base": "NE PAS COPIER", "package.json": PKG("1.1.0"), "apps/same.ts": "pareil", "apps/new/file.ts": "nouveau" });

    expect(applyRelease(root, src)).toEqual({ changed: 2, removed: 1 });
    expect(read(root, ".env")).toBe("CLE=secrete");
    expect(read(root, "data/base")).toBe("ma base");
    expect(read(root, "apps/new/file.ts")).toBe("nouveau");
    expect(existsSync(join(root, "apps/old.ts"))).toBe(false);
    expect(JSON.parse(read(root, MANIFEST_FILE)).sort()).toEqual(["apps/new/file.ts", "apps/same.ts", "package.json"]);
  });

  it("première mise à jour (pas de liste précédente) : ne supprime rien", () => {
    const root = tmp();
    write(root, { "package.json": PKG("1.0.0"), "apps/perso.ts": "à garder" });
    const src = tmp();
    write(src, { "package.json": PKG("1.1.0") });
    expect(applyRelease(root, src).removed).toBe(0);
    expect(existsSync(join(root, "apps/perso.ts"))).toBe(true);
  });

  it("version installée : celle de la dernière mise à jour, sinon package.json", () => {
    const root = tmp();
    write(root, { "package.json": PKG("1.0.0") });
    expect(installedVersion(root)).toBe("1.0.0");
    writeFileSync(join(root, VERSION_FILE), "v1.2.0\n");
    expect(installedVersion(root)).toBe("v1.2.0");
  });
});

describe("au lancement", () => {
  const release = (tag) => json({ tag_name: tag, name: tag, body: "- Nouveautés", zipball_url: "https://api.github.com/repos/exemple/job-radar/zipball/" + tag });
  // Faux ZIP : la « décompression » crée le dossier unique que met GitHub.
  const fakeExtract = (files) => (_zip, out) => write(join(out, "exemple-job-radar-abc123"), files);

  it("nouvelle version publiée → téléchargée, installée, version notée", async () => {
    const root = tmp();
    write(root, { "package.json": PKG("1.0.0"), ".env": "CLE=x" });
    const urls = [];
    const fetch = async (url) => (urls.push(url), url.endsWith("/releases/latest") ? release("v1.1.0") : new Response("zip"));
    const logs = [];
    const r = await runUpdate(root, { fetch, extract: fakeExtract({ "package.json": PKG("1.1.0"), "apps/a.ts": "a" }), log: (m) => logs.push(m) });
    expect(r).toBe("updated");
    expect(urls[0]).toBe("https://api.github.com/repos/exemple/job-radar/releases/latest");
    expect(read(root, VERSION_FILE)).toBe("v1.1.0");
    expect(read(root, "apps/a.ts")).toBe("a");
    expect(read(root, ".env")).toBe("CLE=x");
    expect(logs.join("\n")).toContain("Nouveautés");
  });

  it("déjà à jour, aucune release, ou hors ligne → on lance sans rien changer", async () => {
    const root = tmp();
    write(root, { "package.json": PKG("1.1.0") });
    expect(await runUpdate(root, { fetch: async () => release("v1.1.0"), log: () => {} })).toBe("up-to-date");
    expect(await runUpdate(root, { fetch: async () => json({ message: "Not Found" }, 404), log: () => {} })).toBe("up-to-date");
    expect(await runUpdate(root, { fetch: async () => Promise.reject(new Error("hors ligne")), log: () => {} })).toBe("skipped");
    expect(await runUpdate(root, { fetch: async () => json({}, 403), log: () => {} })).toBe("skipped");
    expect(existsSync(join(root, VERSION_FILE))).toBe(false);
  });

  it("ZIP inattendu → rien n'est remplacé", async () => {
    const root = tmp();
    write(root, { "package.json": PKG("1.0.0") });
    const fetch = async (url) => (url.endsWith("/releases/latest") ? release("v2.0.0") : new Response("zip"));
    const r = await runUpdate(root, { fetch, extract: fakeExtract({ "autre.txt": "x" }), log: () => {} });
    expect(r).toBe("skipped");
    expect(read(root, "package.json")).toBe(PKG("1.0.0"));
  });

  it("dossier géré avec git (développeur) → pas de mise à jour automatique", async () => {
    const root = tmp();
    write(root, { "package.json": PKG("1.0.0"), ".git/HEAD": "ref" });
    const fetch = async () => {
      throw new Error("ne doit pas appeler GitHub");
    };
    expect(await runUpdate(root, { fetch, log: () => {} })).toBe("skipped");
  });
});
