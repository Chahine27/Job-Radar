import { DEFAULT_PROFILE, EMPTY_LETTER_KIT, departmentName, type Profile } from "@job-radar/shared";
import { isRomeCode } from "@job-radar/shared/rome";
import { hash } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_TTL_MS, newSessionToken, requireAuth, sessionIdFromToken } from "../auth";
import { CvFileError, cvFileToText } from "../cv-text";
import type { Stores } from "../stores";
import type { Geocoder } from "./profile";

const AccountBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(12, "12 caractères minimum").max(512),
});
const CvFileBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  /** Contenu du fichier en base64 (8 Mo max). */
  data: z.string().max(11_200_000),
});
const FinishBody = z.object({
  fullName: z.string().trim().max(120).nullable(),
  email: z.string().trim().max(200).nullable(),
  phone: z.string().trim().max(40).nullable(),
  city: z.string().trim().max(120).nullable(),
  postalCode: z.string().trim().regex(/^\d{5}$/).nullable(),
  department: z.string().regex(/^(\d{2}|2A|2B|\d{3})$/).nullable(),
  searches: z.array(z.string().trim().min(2).max(80)).min(1, "Au moins un métier à rechercher").max(10),
  skills: z.array(z.string().trim().min(1).max(60)).max(60),
  mastered: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  yearsOfExperience: z.number().int().min(0).max(50).nullable(),
  contracts: z.array(z.string().min(1)).min(1).max(6),
  salaryTarget: z.number().int().min(8_000).max(500_000).nullable().default(null),
  /** Codes métier pour les candidatures spontanées (La Bonne Boîte) : seulement des codes de la liste officielle. */
  romes: z
    .array(z.string().trim().toUpperCase())
    .max(5, "5 codes métier au maximum")
    .default([])
    .refine((codes) => codes.every(isRomeCode), "Code métier inconnu : choisis-le dans la liste proposée."),
});

/** Années d'expérience → offres acceptables (de 0 à « ses années + 2 », au moins 2 ans). */
export function experienceRange(years: number | null): { experienceMin: number; experienceMax: number } {
  return { experienceMin: 0, experienceMax: Math.max(2, (years ?? 0) + 2) };
}

/**
 * Premier lancement : création du compte depuis le site (aucun compte n'existe encore),
 * CV déposé (PDF / Word / texte) puis profil proposé par l'IA, relu et validé par la personne.
 */
export async function setupRoutes(app: FastifyInstance, opts: { stores: Stores; secureCookie: boolean; geocoder?: Geocoder }) {
  const { stores } = opts;

  /** Public : y a-t-il déjà un compte ? Connecté : le premier lancement est-il terminé ? */
  app.get("/api/setup/status", async (request) => {
    const hasAccount = (await stores.users.count()) > 0;
    if (!request.userId) return { hasAccount, needsSetup: false };
    const rec = await stores.profiles.get(request.userId);
    return { hasAccount, needsSetup: !rec || rec.profile.setupDone === false };
  });

  app.post("/api/setup/account", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    // Un seul compte par installation : la création n'est possible qu'au tout premier lancement.
    if ((await stores.users.count()) > 0) return reply.code(409).send({ error: "ACCOUNT_EXISTS", message: "Un compte existe déjà : connecte-toi." });
    const body = AccountBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "INVALID_ACCOUNT", message: body.error.issues[0]?.message ?? "Email ou mot de passe invalide." });
    }
    const user = await stores.users.create(body.data.email, await hash(body.data.password));
    await stores.profiles.save(user.id, structuredClone(DEFAULT_PROFILE), null);
    await stores.letterKits.save(user.id, { ...EMPTY_LETTER_KIT });
    // Les alertes par email partent vers l'adresse du compte (modifiable dans « Profil »).
    const notif = await stores.notifications.getSettings();
    if (!notif.emailTo) await stores.notifications.saveSettings({ ...notif, emailTo: user.email });

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await stores.sessions.create({ id: sessionIdFromToken(token), userId: user.id, expiresAt });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: opts.secureCookie, path: "/", expires: expiresAt });
    return { user: { email: user.email } };
  });

  /** Fichier du CV → texte, gardé dans « CV & lettre » (sert ensuite à l'IA et aux lettres). */
  app.post("/api/setup/cv-file", { preHandler: requireAuth, bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const body = CvFileBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_FILE", message: "Fichier manquant ou trop gros (8 Mo maximum)." });
    let text: string;
    try {
      text = await cvFileToText(body.data.fileName, Buffer.from(body.data.data, "base64"));
    } catch (err) {
      const message = err instanceof CvFileError ? err.message : "Impossible de lire ce fichier : enregistre-le à nouveau en PDF puis réessaie.";
      return reply.code(400).send({ error: "CV_UNREADABLE", message });
    }
    const kit = (await stores.letterKits.get(request.userId!)) ?? EMPTY_LETTER_KIT;
    await stores.letterKits.save(request.userId!, { ...kit, cvText: text });
    return { text, chars: text.length };
  });

  /** Profil validé par la personne : recherches, compétences, expérience, zone, en-tête des lettres. Fin du premier lancement. */
  app.post("/api/setup/finish", { preHandler: requireAuth }, async (request, reply) => {
    const body = FinishBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "INVALID_PROFILE", message: body.error.issues[0]?.message ?? "Profil incomplet." });
    }
    const d = body.data;
    const current = (await stores.profiles.get(request.userId!))?.profile ?? DEFAULT_PROFILE;
    const label = d.department ? (departmentName(d.department) ?? d.city ?? d.department) : null;
    const profile: Profile = {
      ...current,
      skills: d.skills,
      searches: d.searches,
      contracts: d.contracts,
      ...experienceRange(d.yearsOfExperience),
      salaryTarget: d.salaryTarget,
      salaryMinimum: d.salaryTarget ? Math.round(d.salaryTarget * 0.9) : null,
      locations: d.department && label ? [{ label, department: d.department }] : current.locations,
      // Les premières compétences servent à départager deux offres de même score.
      preferredTechs: d.skills.slice(0, 8).map((name, i) => ({ name, weight: Math.max(0.5, 1 - i * 0.07) })),
      setupDone: true,
    };
    // Point de départ des trajets : la ville du CV (modifiable ensuite dans « Profil »).
    let home = undefined as { label: string; lat: number; lng: number } | undefined;
    const place = [d.postalCode, d.city].filter(Boolean).join(" ");
    if (place && opts.geocoder) {
      const found = await opts.geocoder(place).catch(() => []);
      if (found[0]) home = { label: found[0].label, lat: found[0].lat, lng: found[0].lng };
    }
    // Candidatures spontanées : les codes métier validés, autour de la ville du CV.
    profile.spontaneous = {
      ...current.spontaneous,
      romes: [...new Set(d.romes)],
      ...(home ? { place: { ...home }, departments: [] } : {}),
    };
    const saved = await stores.profiles.save(request.userId!, profile, home);
    const kit = (await stores.letterKits.get(request.userId!)) ?? EMPTY_LETTER_KIT;
    const header = [d.fullName, [d.postalCode, d.city].filter(Boolean).join(" "), d.phone, d.email].filter((x) => !!x && x.trim()).join("\n");
    await stores.letterKits.save(request.userId!, {
      ...kit,
      header: kit.header || header,
      city: kit.city || d.city || "",
      signature: kit.signature || d.fullName || "",
      mastered: kit.mastered || d.mastered.join(", "),
    });
    return { profile: saved.profile, home: saved.home };
  });
}
