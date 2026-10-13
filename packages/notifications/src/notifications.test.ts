import { EXAMPLE_PROFILE } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { createEmailNotifier } from "./email";
import { emailHtml, emailSubject, escapeHtml, pushPayload } from "./format";
import { type CandidateJob, type NotifyRepo, notifyCompletedJob, notifyNewMatches, notifyNotice } from "./notify";
import type { Channel, JobAlert, Notifier } from "./types";
import { createWebPushNotifier, type PushSubscriptionRecord } from "./webpush";

const ALERT: JobAlert = {
  kind: "apply",
  jobId: "j1",
  title: "Développeur Vue.js <script>",
  company: "Atelier",
  place: "Villeurbanne (69)",
  score: 91,
  contract: "CDI",
  salary: "40k–45k €",
  remote: "hybride",
  skills: ["Vue.js", "TypeScript"],
  missing: ["PostgreSQL"],
  url: "http://localhost:5173/offres/j1",
};

describe("format", () => {
  it("échappe le HTML venant des annonces", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    const html = emailHtml([ALERT]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Développeur Vue.js &lt;script&gt;");
  });

  it("sujet : une offre / plusieurs offres", () => {
    expect(emailSubject([ALERT])).toBe("🟢 91 % — Développeur Vue.js <script>");
    expect(emailSubject([ALERT, { ...ALERT, score: 80 }])).toBe("🟢 2 nouvelles offres compatibles (jusqu'à 91 %)");
  });

  it("annonce incomplète : sujet, score provisoire et bouton « Compléter »", () => {
    const complete = { ...ALERT, kind: "complete" as const };
    expect(emailSubject([complete])).toBe("📝 À compléter — 91 % provisoire — Développeur Vue.js <script>");
    expect(emailSubject([complete, { ...complete, score: 80 }])).toBe("📝 2 offres à compléter (jusqu'à 91 % provisoire)");
    expect(emailHtml([complete])).toContain("Compléter l'annonce");
    expect(JSON.parse(pushPayload(complete)).title).toBe("📝 À compléter · 91 % provisoire — Développeur Vue.js <script>");
  });

  it("notification navigateur", () => {
    const p = JSON.parse(pushPayload(ALERT));
    expect(p.title).toBe("91 % — Développeur Vue.js <script>");
    expect(p.body).toContain("CDI · 40k–45k € · hybride");
    expect(p.url).toBe(ALERT.url);
  });
});

describe("email", () => {
  it("non configuré sans identifiants SMTP", () => {
    expect(createEmailNotifier({ to: async () => "a@b.c" }).isConfigured()).toBe(false);
  });

  it("envoie un seul email récapitulatif", async () => {
    const sent: Array<{ to: string; subject: string }> = [];
    const n = createEmailNotifier(
      { host: "smtp.example.com", user: "moi@example.com", password: "x", to: async () => "moi@example.com" },
      async (msg) => void sent.push(msg),
    );
    await n.sendAlerts([ALERT, { ...ALERT, jobId: "j2" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("moi@example.com");
  });

  it("erreur claire sans destinataire", async () => {
    const n = createEmailNotifier({ host: "h", user: "u", password: "p", to: async () => null }, async () => {});
    await expect(n.sendTest()).rejects.toThrow(/destination/);
  });
});

describe("web push", () => {
  const sub = (endpoint: string): PushSubscriptionRecord => ({ endpoint, keys: { p256dh: "k", auth: "a" } });

  it("oublie les abonnements expirés (410)", async () => {
    const subs = [sub("https://push/ok"), sub("https://push/expire")];
    const removed: string[] = [];
    const sent: string[] = [];
    const n = createWebPushNotifier(
      {
        publicKey: "pub",
        privateKey: "priv",
        subscriptions: { list: async () => subs, remove: async (e) => void removed.push(e) },
      },
      async (s) => {
        if (s.endpoint.endsWith("expire")) throw Object.assign(new Error("gone"), { statusCode: 410 });
        sent.push(s.endpoint);
      },
    );
    await n.sendAlerts([ALERT]);
    expect(sent).toEqual(["https://push/ok"]);
    expect(removed).toEqual(["https://push/expire"]);
  });

  it("au-delà de 3 offres : 3 notifications + 1 récapitulatif", async () => {
    const payloads: string[] = [];
    const n = createWebPushNotifier(
      { publicKey: "pub", privateKey: "priv", subscriptions: { list: async () => [sub("https://p")], remove: async () => {} } },
      async (_s, p) => void payloads.push(p),
    );
    await n.sendAlerts([1, 2, 3, 4, 5].map((i) => ({ ...ALERT, jobId: `j${i}` })));
    expect(payloads).toHaveLength(4);
    expect(JSON.parse(payloads[3]!).title).toBe("+ 2 autre(s) offre(s) compatible(s)");
  });

  it("erreur claire si aucun navigateur abonné", async () => {
    const n = createWebPushNotifier({ publicKey: "p", privateKey: "q", subscriptions: { list: async () => [], remove: async () => {} } }, async () => {});
    await expect(n.sendTest()).rejects.toThrow(/Aucun navigateur/);
  });
});

function job(id: string, extra: Partial<CandidateJob> = {}): CandidateJob {
  return {
    id,
    title: "Développeur Vue.js",
    company: "Atelier",
    city: "Villeurbanne",
    description: "Vue 3, TypeScript, Node.js",
    sources: [{ source: "france-travail" }],
    fullTextAt: null,
    latitude: null,
    longitude: null,
    technologies: [],
    contractType: "CDI",
    experienceMinYrs: 2,
    salaryMin: 40000,
    salaryMax: 45000,
    department: "69",
    remoteType: "hybrid",
    travelMinutes: null,
    ...extra,
  };
}

function memoryRepo(jobs: CandidateJob[], settings = { emailEnabled: true, pushEnabled: true }) {
  const rows = new Map<string, string>();
  const notified: string[] = [];
  const repo: NotifyRepo = {
    settings: async () => settings,
    candidates: async () => jobs.filter((j) => !notified.includes(j.id)),
    claim: async (jobId, channel, kind) => {
      const key = `${jobId}:${channel}:${kind}`;
      if (rows.has(key)) return false;
      rows.set(key, "pending");
      return true;
    },
    finish: async (jobId, channel, kind, status) => void rows.set(`${jobId}:${channel}:${kind}`, status),
    wasSent: async (jobId, kind) => [...rows].some(([key, status]) => key.startsWith(`${jobId}:`) && key.endsWith(`:${kind}`) && status === "sent"),
    markNotified: async (ids) => void notified.push(...ids),
  };
  return { repo, rows, notified };
}

function fakeNotifier(channel: Channel, fail = false) {
  const batches: JobAlert[][] = [];
  const n: Notifier & { batches: JobAlert[][] } = {
    channel,
    batches,
    isConfigured: () => true,
    sendAlerts: async (a) => {
      if (fail) throw new Error("SMTP refusé");
      batches.push(a);
    },
    sendTest: async () => {},
  };
  return n;
}

const DEVELOPER_PROFILE = {
  ...EXAMPLE_PROFILE,
  skills: ["Vue.js", "JavaScript", "TypeScript", "React", "Node.js", "Java", "Spring Boot", "API REST", "Docker"],
  experienceMin: 1,
  experienceMax: 3,
  salaryMinimum: 38000,
  preferredTechs: [{ name: "Vue.js", weight: 1 }, { name: "TypeScript", weight: 0.8 }],
  scoringWeights: { technical: 0.35, experience: 0.2, contract: 0.15, salary: 0.1, location: 0.1, transport: 0.1 },
};

const run = (repo: NotifyRepo, notifiers: Notifier[]) =>
  notifyNewMatches({ repo, notifiers, profile: DEVELOPER_PROFILE, since: new Date(0), appUrl: "http://localhost:5173" });

describe("notifyNewMatches", () => {
  it("n'annonce que les offres au-dessus du seuil, non masquées, meilleures d'abord", async () => {
    const { repo } = memoryRepo([
      job("bon"),
      job("excellent", { travelMinutes: 20 }),
      job("ruby", { title: "Développeur Ruby", description: "Ruby on Rails, Kubernetes" }),
      job("cdd", { contractType: "CDD" }),
    ]);
    const email = fakeNotifier("email");
    const res = await run(repo, [email]);
    expect(res.matched).toBe(2);
    expect(email.batches[0]!.map((a) => a.jobId)).toEqual(["excellent", "bon"]);
    expect(email.batches[0]![0]!.url).toBe("http://localhost:5173/offres/excellent");
  });

  it("jamais deux fois la même offre", async () => {
    const { repo } = memoryRepo([job("a")]);
    const email = fakeNotifier("email");
    await run(repo, [email]);
    await run(repo, [email]);
    expect(email.batches).toHaveLength(1);
  });

  it("respecte les canaux désactivés dans les réglages", async () => {
    const { repo, notified } = memoryRepo([job("a")], { emailEnabled: false, pushEnabled: true });
    const email = fakeNotifier("email");
    const push = fakeNotifier("webpush");
    const res = await run(repo, [email, push]);
    expect(email.batches).toHaveLength(0);
    expect(push.batches).toHaveLength(1);
    expect(res.sent).toEqual({ webpush: 1 });
    expect(notified).toEqual(["a"]);
  });

  it("aucun canal actif → rien n'est marqué comme notifié", async () => {
    const { repo, notified } = memoryRepo([job("a")], { emailEnabled: false, pushEnabled: false });
    await run(repo, [fakeNotifier("email")]);
    expect(notified).toEqual([]);
  });

  it("un canal en panne n'empêche pas l'autre et l'échec est tracé", async () => {
    const { repo, rows } = memoryRepo([job("a")]);
    const push = fakeNotifier("webpush");
    const res = await run(repo, [fakeNotifier("email", true), push]);
    expect(push.batches).toHaveLength(1);
    expect(rows.get("a:email:apply")).toBe("failed");
    expect(rows.get("a:webpush:apply")).toBe("sent");
    expect(res.errors[0]).toContain("SMTP refusé");
  });

  it("aucun navigateur abonné : canal sauté sans échec tracé, l'email part quand même", async () => {
    const { repo, rows } = memoryRepo([job("a")]);
    const email = fakeNotifier("email");
    const push = { ...fakeNotifier("webpush"), hasRecipients: async () => false };
    const res = await run(repo, [email, push]);
    expect(email.batches).toHaveLength(1);
    expect(push.batches).toHaveLength(0);
    expect(rows.has("a:webpush:apply")).toBe(false);
    expect(res.errors).toEqual([]);
  });
});

describe("annonces incomplètes : « à compléter » puis « à postuler »", () => {
  const extract = (id: string) => job(id, { description: "Vue 3, TypeScript, Node.js", sources: [{ source: "adzuna" }] });
  const completed = { final: 85, hidden: false, matchedSkills: ["Vue.js"], missingSkills: [] };
  const afterPaste = (repo: NotifyRepo, notifiers: Notifier[], score = completed, abridged = false) =>
    notifyCompletedJob({ repo, notifiers, profile: EXAMPLE_PROFILE, job: job("x"), score, abridged, appUrl: "http://localhost:5173" });

  it("bon score sur un extrait → mail « à compléter », jamais « à postuler »", async () => {
    const { repo, rows } = memoryRepo([extract("x"), job("complete")]);
    const email = fakeNotifier("email");
    await run(repo, [email]);
    expect(email.batches.map((b) => b.map((a) => [a.jobId, a.kind]))).toEqual([[["complete", "apply"]], [["x", "complete"]]]);
    expect(rows.get("x:email:apply")).toBeUndefined();
  });

  it("annonce collée et score toujours bon → « à postuler », une seule fois", async () => {
    const { repo } = memoryRepo([extract("x")]);
    const email = fakeNotifier("email");
    await run(repo, [email]);
    await afterPaste(repo, [email]);
    await afterPaste(repo, [email]);
    expect(email.batches.map((b) => b.map((a) => a.kind))).toEqual([["complete"], ["apply"]]);
    expect(email.batches[1]![0]!.score).toBe(85);
  });

  it("score qui chute après l'annonce complète → aucun mail « à postuler »", async () => {
    const { repo } = memoryRepo([extract("x")]);
    const email = fakeNotifier("email");
    await run(repo, [email]);
    await afterPaste(repo, [email], { ...completed, final: 40 });
    await afterPaste(repo, [email], { ...completed, hidden: true });
    expect(email.batches).toHaveLength(1);
  });

  it("annonce encore incomplète, ou jamais signalée « à compléter » → rien", async () => {
    const { repo } = memoryRepo([extract("x")]);
    const email = fakeNotifier("email");
    await afterPaste(repo, [email]);
    expect(email.batches).toHaveLength(0);
    await run(repo, [email]);
    await afterPaste(repo, [email], completed, true);
    expect(email.batches).toHaveLength(1);
  });
});

describe("rayon de recherche du profil", () => {
  it("une offre hors des départements mais dans le rayon est annoncée ; au-delà, non", async () => {
    const { repo } = memoryRepo([job("proche", { department: "13" }), job("loin", { department: "13" })]);
    const email = fakeNotifier("email");
    await notifyNewMatches({
      repo,
      notifiers: [email],
      profile: { ...DEVELOPER_PROFILE, searchRadiusKm: 30 },
      since: new Date(0),
      appUrl: "http://localhost:5173",
      distanceOf: (j) => (j.id === "proche" ? 12 : 80),
    });
    expect(email.batches.flat().map((a) => a.jobId)).toEqual(["proche"]);
  });
});

describe("information ponctuelle (lettre terminée)", () => {
  it("va au navigateur seulement, jamais par email", async () => {
    const notice = { title: "Lettre terminée", body: "Assistant comptable", url: "https://x.test/offres/1", tag: "letter-1" };
    const sent: string[] = [];
    const email = fakeNotifier("email");
    const push = { ...fakeNotifier("webpush"), sendNotice: async () => void sent.push("webpush") };
    await notifyNotice({ repo: { settings: async () => ({ emailEnabled: true, pushEnabled: true }) }, notifiers: [email, push], notice });
    expect(sent).toEqual(["webpush"]);
  });
});
