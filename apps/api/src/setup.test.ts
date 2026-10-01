import { describe, expect, it } from "vitest";
import { cvFileToText } from "./cv-text";
import { renderLetterPdf } from "./letter-pdf";
import { experienceRange } from "./routes/setup";
import { createTestApp, login } from "./test-helpers";

const CV = [
  "Camille Martin",
  "12 rue des Lilas 69003 Lyon",
  "camille.martin@example.com",
  "Assistante comptable — 3 ans d'expérience",
  "Expériences : saisie comptable, rapprochements bancaires, déclarations de TVA, suivi des fournisseurs.",
  "Logiciels : Sage, Excel, EBP. Langues : anglais courant. Permis B.",
  "Formation : BTS Comptabilité et gestion.",
].join("\n");

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

async function newAccount() {
  const t = await createTestApp({ noUser: true });
  const res = await t.app.inject({ method: "POST", url: "/api/setup/account", payload: { email: "Camille@Example.com", password: "un-mot-de-passe-long" } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "jr_session");
  return { ...t, cookies: { jr_session: cookie!.value } };
}

describe("premier lancement", () => {
  it("sans compte : le site le dit, et la création ouvre la session", async () => {
    const { app, cookies } = await newAccount();
    const status = await app.inject({ method: "GET", url: "/api/setup/status", cookies });
    expect(status.json()).toEqual({ hasAccount: true, needsSetup: true });
    const me = await app.inject({ method: "GET", url: "/api/profile", cookies });
    expect(me.statusCode).toBe(200);
    expect(me.json().profile.setupDone).toBe(false);
    expect(me.json().profile.searches).toEqual([]);
  });

  it("statut public avant toute création", async () => {
    const { app } = await createTestApp({ noUser: true });
    const res = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(res.json()).toEqual({ hasAccount: false, needsSetup: false });
  });

  it("un seul compte par installation", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "POST", url: "/api/setup/account", payload: { email: "autre@example.com", password: "un-mot-de-passe-long" } });
    expect(res.statusCode).toBe(409);
  });

  it("mot de passe trop court refusé", async () => {
    const { app } = await createTestApp({ noUser: true });
    const res = await app.inject({ method: "POST", url: "/api/setup/account", payload: { email: "a@example.com", password: "court" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("12");
  });

  it("CV déposé → texte gardé → l'IA propose un profil → profil validé", async () => {
    const { app, cookies, aiCalls } = await newAccount();
    const noCv = await app.inject({ method: "POST", url: "/api/setup/read-cv", cookies });
    expect(noCv.statusCode).toBe(400);

    const up = await app.inject({ method: "POST", url: "/api/setup/cv-file", cookies, payload: { fileName: "cv.txt", data: b64(CV) } });
    expect(up.statusCode).toBe(200);
    expect(up.json().text).toContain("Sage");

    const read = await app.inject({ method: "POST", url: "/api/setup/read-cv", cookies });
    expect(read.statusCode).toBe(200);
    expect(read.json().proposal.searches).toContain("Comptable");
    expect(aiCalls.some((c) => c.title.startsWith("cv:"))).toBe(true);

    const fin = await app.inject({
      method: "POST",
      url: "/api/setup/finish",
      cookies,
      payload: {
        fullName: "Camille Martin",
        email: "camille.martin@example.com",
        phone: null,
        city: "Lyon",
        postalCode: "69003",
        department: "69",
        searches: ["Assistant comptable", "Comptable"],
        skills: ["Sage", "Excel", "EBP"],
        mastered: ["Sage"],
        yearsOfExperience: 3,
        contracts: ["CDI", "CDD"],
        salaryTarget: 26000,
      },
    });
    expect(fin.statusCode).toBe(200);
    const p = fin.json().profile;
    expect(p.setupDone).toBe(true);
    expect(p.searches).toEqual(["Assistant comptable", "Comptable"]);
    expect(p.locations[0].department).toBe("69");
    expect(p.experienceMax).toBe(5);
    expect(fin.json().home.label).toContain("Villeurbanne");

    const kit = await app.inject({ method: "GET", url: "/api/letter-kit", cookies });
    const k = kit.json().kit;
    expect(k.header).toContain("Camille Martin");
    expect(k.signature).toBe("Camille Martin");
    expect(k.mastered).toBe("Sage");
    expect(k.cvText).toContain("Sage");
    const status = await app.inject({ method: "GET", url: "/api/setup/status", cookies });
    expect(status.json().needsSetup).toBe(false);
  });

  it("refuse de finir sans métier recherché", async () => {
    const { app, cookies } = await newAccount();
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/finish",
      cookies,
      payload: { fullName: null, email: null, phone: null, city: null, postalCode: null, department: null, searches: [], skills: [], yearsOfExperience: null, contracts: ["CDI"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("routes protégées sans session", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "POST", url: "/api/setup/cv-file", payload: { fileName: "cv.txt", data: b64(CV) } });
    expect(res.statusCode).toBe(401);
  });

  it("le compte de test existant n'a pas besoin du premier lancement", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/setup/status", cookies });
    expect(res.json().needsSetup).toBe(false);
  });
});

describe("lecture du fichier CV", () => {
  it("lit un PDF", async () => {
    const pdf = await renderLetterPdf(CV, "CV");
    const text = await cvFileToText("CV Camille.PDF", pdf);
    expect(text).toContain("Sage");
    expect(text).toContain("Lyon");
  });
  it("refuse un CV vide ou scanné", async () => {
    await expect(cvFileToText("cv.txt", Buffer.from("trop court"))).rejects.toThrow(/scann/i);
  });
  it("refuse l'ancien format .doc", async () => {
    await expect(cvFileToText("cv.doc", Buffer.from(CV))).rejects.toThrow();
  });
});

describe("expérience", () => {
  it("de 0 à ses années + 2, au moins 2", () => {
    expect(experienceRange(null)).toEqual({ experienceMin: 0, experienceMax: 2 });
    expect(experienceRange(3)).toEqual({ experienceMin: 0, experienceMax: 5 });
  });
});
