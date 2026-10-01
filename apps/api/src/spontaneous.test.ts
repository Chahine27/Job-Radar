import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultMail } from "./spontaneous-mail";
import { createTestApp, login } from "./test-helpers";

// Candidat fictif.
const KIT = {
  header: "Alex Martin\n75011 Paris\n06 00 00 00 00\nalex.martin@example.com",
  city: "Paris",
  signature: "Alex MARTIN",
  cvText: "Développeur Full Stack. Alternance chez Nordia : Vue.js, TypeScript, Java Spring Boot, PostgreSQL. ".repeat(4),
  letterExample: "",
};

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  await req("POST", "/api/leads/refresh");
  const lead = (await req("GET", "/api/leads?status=all")).json().items.find((l: { name: string }) => l.name === "ALPHA LOGICIELS");
  return { ...t, req, lead };
}

describe("candidature spontanée", () => {
  it("message et objet écrits par le code, avec le téléphone de l'en-tête", () => {
    const m = defaultMail(KIT, "ALPHA LOGICIELS", "Développeur full stack");
    expect(m.subject).toBe("Candidature spontanée – Développeur full stack – Alex MARTIN");
    expect(m.message).toContain("pour un poste de développeur full stack chez ALPHA LOGICIELS.");
    expect(m.message).toContain("Vous trouverez ci-joint mon CV et ma lettre de motivation.");
    expect(m.message.trim().endsWith("Alex MARTIN\n06 00 00 00 00")).toBe(true);
  });

  it("email de contact : enregistré, vérifié", async () => {
    const { req, lead } = await setup();
    expect((await req("PATCH", `/api/leads/${lead.id}`, { contactEmail: "pas-un-email" })).statusCode).toBe(400);
    const ok = await req("PATCH", `/api/leads/${lead.id}`, { contactEmail: " RH@Alpha.fr " });
    expect(ok.json().contactEmail).toBe("rh@alpha.fr");
  });

  it("lettre écrite en mode « spontanée », puis envoi seulement quand tout est prêt ; lettre PDF + CV joints ; entreprise « Contactée »", async () => {
    const { req, lead, aiCalls, sentMails } = await setup();
    await req("PUT", "/api/letter-kit", KIT);

    const first = (await req("GET", `/api/leads/${lead.id}/application`)).json();
    expect(first).toMatchObject({ application: null, kitReady: true, cvPdf: { found: false }, mail: { configured: true } });

    const written = (await req("POST", `/api/leads/${lead.id}/application/letter`, { title: "Développeur Vue.js" })).json();
    expect(aiCalls.at(-1)?.title).toBe("lettre:Développeur Vue.js");
    expect(written.application.letter).toContain("Candidature spontanée – Développeur Vue.js");

    const mail = { to: "rh@alpha.fr", subject: "Candidature spontanée", message: "Madame, Monsieur, voici ma candidature.", letter: written.application.letter };
    const noCv = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(noCv.statusCode).toBe(400);
    expect(noCv.json().error).toBe("CV_PDF_MISSING");
    expect(sentMails).toHaveLength(0);

    const dir = await mkdtemp(join(tmpdir(), "jr-cv-"));
    const cv = join(dir, "CV_Alex_Martin.pdf");
    await writeFile(cv, "%PDF-1.4 faux CV");
    await req("PUT", "/api/letter-kit", { ...KIT, cvPdfPath: `"${cv}"` });

    const sent = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(sent.statusCode).toBe(200);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ fromName: "Alex MARTIN", to: "rh@alpha.fr", subject: "Candidature spontanée" });
    expect(sentMails[0]!.attachments.map((a) => a.filename)).toEqual(["Lettre_de_motivation.pdf", "CV_Alex_Martin.pdf"]);
    expect(sentMails[0]!.attachments[0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sent.json().application).toMatchObject({ sentTo: "rh@alpha.fr" });
    expect(sent.json().lead).toMatchObject({ status: "CONTACTED", contactEmail: "rh@alpha.fr" });

    // Pas de double envoi par erreur : il faut le demander explicitement.
    const again = await req("POST", `/api/leads/${lead.id}/application/send`, mail);
    expect(again.statusCode).toBe(409);
    expect((await req("POST", `/api/leads/${lead.id}/application/send`, { ...mail, force: true })).statusCode).toBe(200);
    expect(sentMails).toHaveLength(2);
  });
});
