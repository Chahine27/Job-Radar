/**
 * Offres de DÉMONSTRATION pour tester l'interface avant le vrai connecteur (étape 6).
 * Toutes marquées source « demo » et entreprise « [DÉMO] ».
 *   pnpm db:demo        → ajoute / met à jour les offres de démo
 *   pnpm db:demo:clear  → les supprime toutes
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import { createPrismaClient } from "../src/client";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

type Demo = {
  key: string;
  title: string;
  company: string;
  description: string;
  contractType: string;
  experienceText: string | null;
  experienceMinYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  city: string;
  postalCode: string;
  department: string;
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  travelMinutes: number | null;
  daysAgo: number;
};

const DEMOS: Demo[] = [
  {
    key: "gestion-commerciale-villeurbanne",
    title: "Chargé de clientèle B2B",
    company: "Atelier Numérique",
    description:
      "Vous accompagnez les clients sur leur suivi de commande, la relance commerciale et la qualité de service. " +
      "Rôle varié avec gestion des dossiers, relation client et coordination interne.\n\n" +
      "Profil : 2 ans d'expérience, poste plus orienté gestion et relation client avec télétravail 2 jours par semaine.",
    contractType: "CDI",
    experienceText: "2 ans",
    experienceMinYrs: 2,
    salaryMin: 40000,
    salaryMax: 45000,
    city: "Villeurbanne",
    postalCode: "69100",
    department: "69",
    remoteType: "hybrid",
    travelMinutes: 30,
    daysAgo: 0,
  },
  {
    key: "gestion-admin-paris",
    title: "Gestionnaire administratif",
    company: "Banque Horizon",
    description:
      "Pilotage des dossiers administratifs, suivi des pièces, coordination avec les services internes et gestion des demandes clients. " +
      "Bonne rigueur, sens du détail et capacité à gérer plusieurs sujets en parallèle.",
    contractType: "CDI",
    experienceText: "3 ans",
    experienceMinYrs: 3,
    salaryMin: null,
    salaryMax: null,
    city: "Paris 9e",
    postalCode: "75009",
    department: "75",
    remoteType: "onsite",
    travelMinutes: null,
    daysAgo: 1,
  },
  {
    key: "assistance-comptabilite-venissieux",
    title: "Assistant comptable",
    company: "LogiNord",
    description:
      "Saisie comptable, suivi des factures, relances fournisseurs et préparation de documents pour la comptabilité. Junior accepté.",
    contractType: "CDI",
    experienceText: "Débutant accepté",
    experienceMinYrs: 0,
    salaryMin: 36000,
    salaryMax: 39000,
    city: "Vénissieux",
    postalCode: "69200",
    department: "69",
    remoteType: "hybrid",
    travelMinutes: 25,
    daysAgo: 2,
  },
  {
    key: "support-rh-lyon",
    title: "Assistant RH",
    company: "Rhône Services",
    description: "Suivi administratif des dossiers RH, gestion des absences, préparation des documents et appui aux équipes. Sens du service et rigueur.",
    contractType: "CDI",
    experienceText: "1 an",
    experienceMinYrs: 1,
    salaryMin: 38000,
    salaryMax: 42000,
    city: "Lyon",
    postalCode: "69003",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 55,
    daysAgo: 3,
  },
  {
    key: "commercial-vente-paris",
    title: "Commercial terrain",
    company: "ScaleUp Paris",
    description: "Prospection, développement du portefeuille clients et suivi des ventes. 7 ans d'expérience minimum dans un environnement commercial B2B.",
    contractType: "CDI",
    experienceText: "7 ans",
    experienceMinYrs: 7,
    salaryMin: 55000,
    salaryMax: 65000,
    city: "Paris 2e",
    postalCode: "75002",
    department: "75",
    remoteType: "hybrid",
    travelMinutes: 40,
    daysAgo: 1,
  },
  {
    key: "logistique-bron",
    title: "Coordinateur logistique",
    company: "Mairie Numérique",
    description: "Organisation des livraisons, suivi des stocks et coordination avec les fournisseurs. Poste à temps plein, 1 an d'expérience souhaité.",
    contractType: "CDD",
    experienceText: "1 an",
    experienceMinYrs: 1,
    salaryMin: 34000,
    salaryMax: 36000,
    city: "Bron",
    postalCode: "69500",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 20,
    daysAgo: 0,
  },
  {
    key: "finance-lyon",
    title: "Assistant comptable / paie",
    company: "DataRhône",
    description: "Saisie comptable, suivi des paies et préparation des documents de fin de mois. 2 ans d'expérience.",
    contractType: "CDI",
    experienceText: "2 ans",
    experienceMinYrs: 2,
    salaryMin: 42000,
    salaryMax: 48000,
    city: "Lyon",
    postalCode: "69003",
    department: "69",
    remoteType: "hybrid",
    travelMinutes: null,
    daysAgo: 4,
  },
  {
    key: "support-remote",
    title: "Chargé de support client (100 % télétravail)",
    company: "RemoteFirst",
    description: "Accompagnement client, gestion des demandes, suivi administratif et satisfaction client. Télétravail complet. 2 à 4 ans d'expérience.",
    contractType: "CDI",
    experienceText: "2 à 4 ans",
    experienceMinYrs: 2,
    salaryMin: null,
    salaryMax: null,
    city: "Télétravail",
    postalCode: "",
    department: "",
    remoteType: "remote",
    travelMinutes: null,
    daysAgo: 0,
  },
];

const prisma = createPrismaClient();
const clear = process.argv.includes("--clear");

async function main() {
  const removed = await prisma.job.deleteMany({ where: { sources: { some: { source: "demo" } } } });
  if (clear) {
    console.log(`✔ ${removed.count} offre(s) de démo supprimée(s)`);
    return;
  }
  for (const d of DEMOS) {
    const contentHash = createHash("sha256").update(JSON.stringify(d)).digest("hex").slice(0, 16);
    const publishedAt = new Date(Date.now() - d.daysAgo * 86_400_000);
    await prisma.job.create({
      data: {
        fingerprint: `demo:${d.key}`,
        contentHash,
        title: d.title,
        company: `[DÉMO] ${d.company}`,
        description: d.description,
        contractType: d.contractType,
        experienceText: d.experienceText,
        experienceMinYrs: d.experienceMinYrs,
        salaryMin: d.salaryMin,
        salaryMax: d.salaryMax,
        salaryPeriod: d.salaryMin ? "year" : null,
        city: d.city,
        postalCode: d.postalCode || null,
        department: d.department || null,
        locationPrecision: "city_centroid",
        remoteType: d.remoteType,
        technologies: [],
        publishedAt,
        sources: {
          create: { source: "demo", sourceJobId: d.key, sourceUrl: `https://example.com/demo/${d.key}` },
        },
        ...(d.travelMinutes !== null
          ? { travel: { create: { minutes: d.travelMinutes, provider: "demo", precision: "city_centroid" } } }
          : {}),
      },
    });
  }
  console.log(`✔ ${DEMOS.length} offres de démo créées (source « demo »)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
