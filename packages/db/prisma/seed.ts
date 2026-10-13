/**
 * Remplit la base avec le minimum pour démarrer :
 *  - la configuration des sources et des notifications
 *  - (facultatif) un compte si SEED_USER_EMAIL / SEED_USER_PASSWORD sont remplis dans .env.
 *    Sinon, le compte se crée depuis le site au premier lancement (écran « Bienvenue »).
 * On peut le relancer sans risque : rien n'est dupliqué, un profil existant n'est pas écrasé.
 */
import path from "node:path";
import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { DEFAULT_PROFILE, ProfileSchema } from "@job-radar/shared";
import { createPrismaClient } from "../src/client";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase() || null;
const password = process.env.SEED_USER_PASSWORD ?? "";

if (email && password.length < 12) {
  throw new Error("SEED_USER_PASSWORD manquant ou trop court dans .env (12 caractères minimum)");
}

const prisma = createPrismaClient();

async function main() {
  if (email) {
    const profile = ProfileSchema.parse(DEFAULT_PROFILE);
    const passwordHash = await hash(password);
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash },
      create: { email, passwordHash },
    });
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: {}, // ne jamais écraser un profil modifié depuis l'interface
      create: { userId: user.id, data: profile },
    });
    console.log(`✔ Compte prêt : ${user.email}`);
  }

  const sources = [
    { source: "france-travail", intervalMinutes: 30, enabled: true },
    { source: "adzuna", intervalMinutes: 60, enabled: false },
    { source: "jooble", intervalMinutes: 1440, enabled: false },
  ];
  for (const s of sources) {
    await prisma.sourceState.upsert({ where: { source: s.source }, update: {}, create: s });
  }

  await prisma.notificationSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", emailTo: process.env.NOTIFY_EMAIL_TO?.trim() || email },
  });

  console.log(`✔ ${sources.length} sources et réglages de notification en place`);
  if (!email) console.log("→ Ton compte se crée sur le site au premier lancement.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
