/**
 * Offres de DÉMONSTRATION pour tester l'interface sans clé ni collecte, dans des métiers variés
 * (santé, commerce, artisanat, transport, propreté, bureau). Entreprises inventées.
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
    key: "aide-soignant-ehpad-villeurbanne",
    title: "Aide-soignant / Aide-soignante en EHPAD",
    company: "Résidence Les Tilleuls",
    description:
      "Vous accompagnez les résidents dans les gestes de la vie quotidienne : soins d'hygiène et de confort, aide aux repas, " +
      "surveillance de l'état de santé et transmissions à l'équipe infirmière.\n\n" +
      "Profil : diplôme d'État d'aide-soignant (DEAS) exigé, 1 an d'expérience souhaité. Travail en 12 h, un week-end sur deux.",
    contractType: "CDI",
    experienceText: "1 an",
    experienceMinYrs: 1,
    salaryMin: 24000,
    salaryMax: 27000,
    city: "Villeurbanne",
    postalCode: "69100",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 30,
    daysAgo: 0,
  },
  {
    key: "infirmier-clinique-lyon",
    title: "Infirmier / Infirmière en soins généraux",
    company: "Clinique du Parc",
    description:
      "Service de médecine, équipe de 12 soignants. Préparation et administration des traitements, suivi des patients, " +
      "coordination avec les médecins. Diplôme d'État infirmier exigé. Débutant accepté.",
    contractType: "CDI",
    experienceText: "Débutant accepté",
    experienceMinYrs: 0,
    salaryMin: 30000,
    salaryMax: 34000,
    city: "Lyon",
    postalCode: "69008",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 35,
    daysAgo: 1,
  },
  {
    key: "boulanger-venissieux",
    title: "Boulanger / Boulangère",
    company: "Maison Fournier",
    description:
      "Fabrication du pain et des viennoiseries (pétrissage, façonnage, cuisson), gestion des fournées et respect des règles d'hygiène. " +
      "CAP boulanger, 2 ans d'expérience. Horaires de nuit, 35 h.",
    contractType: "CDI",
    experienceText: "2 ans",
    experienceMinYrs: 2,
    salaryMin: 23000,
    salaryMax: 25000,
    city: "Vénissieux",
    postalCode: "69200",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 25,
    daysAgo: 2,
  },
  {
    key: "vendeur-boulangerie-lyon",
    title: "Vendeur / Vendeuse en boulangerie",
    company: "Maison Fournier",
    description: "Accueil et conseil des clients, mise en rayon, tenue de la caisse et propreté de la boutique. Débutant accepté, formation assurée.",
    contractType: "CDD",
    experienceText: "Débutant accepté",
    experienceMinYrs: 0,
    salaryMin: 21000,
    salaryMax: 22000,
    city: "Lyon",
    postalCode: "69003",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 40,
    daysAgo: 3,
  },
  {
    key: "conducteur-pl-corbas",
    title: "Conducteur / Conductrice poids lourd",
    company: "Transports Delmas",
    description: "Livraisons régionales en porteur, chargement et déchargement, contrôle du véhicule. Permis C et FIMO à jour exigés, 3 ans d'expérience.",
    contractType: "CDI",
    experienceText: "3 ans",
    experienceMinYrs: 3,
    salaryMin: 27000,
    salaryMax: 30000,
    city: "Corbas",
    postalCode: "69960",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 45,
    daysAgo: 1,
  },
  {
    key: "agent-proprete-bron",
    title: "Agent / Agente de propreté de locaux",
    company: "Net'Services",
    description: "Entretien de bureaux et de parties communes, utilisation des produits et du matériel de nettoyage. Temps partiel 24 h, horaires du matin.",
    contractType: "CDI",
    experienceText: null,
    experienceMinYrs: null,
    salaryMin: null,
    salaryMax: null,
    city: "Bron",
    postalCode: "69500",
    department: "69",
    remoteType: "onsite",
    travelMinutes: 20,
    daysAgo: 0,
  },
  {
    key: "assistance-comptabilite-lyon",
    title: "Assistant comptable",
    company: "Cabinet Morel",
    description:
      "Saisie comptable, suivi des factures, relances fournisseurs et préparation de documents pour la comptabilité. Logiciel Sage. Débutant accepté.",
    contractType: "CDI",
    experienceText: "Débutant accepté",
    experienceMinYrs: 0,
    salaryMin: 26000,
    salaryMax: 29000,
    city: "Lyon",
    postalCode: "69002",
    department: "69",
    remoteType: "hybrid",
    travelMinutes: 30,
    daysAgo: 2,
  },
  {
    key: "commercial-vente-paris",
    title: "Commercial terrain",
    company: "Équipements Pro",
    description: "Prospection, développement du portefeuille clients et suivi des ventes. 7 ans d'expérience minimum dans la vente aux professionnels.",
    contractType: "CDI",
    experienceText: "7 ans",
    experienceMinYrs: 7,
    salaryMin: 45000,
    salaryMax: 55000,
    city: "Paris 2e",
    postalCode: "75002",
    department: "75",
    remoteType: "hybrid",
    travelMinutes: null,
    daysAgo: 1,
  },
  {
    key: "support-remote",
    title: "Chargé de support client (100 % télétravail)",
    company: "Assur'Direct",
    description: "Accompagnement des clients par téléphone et email, gestion des demandes et suivi administratif. Télétravail complet. 2 à 4 ans d'expérience.",
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
