/**
 * Doublons déjà en base : la même offre vue par plusieurs sources avec un titre ou un lieu écrit autrement.
 *   pnpm jobs:dedupe          → liste ce qui serait fusionné (ne supprime rien)
 *   pnpm jobs:dedupe --apply  → fusionne : l'offre où tu as agi est gardée, ses sources rapatriées
 */
import "./env"; // charge .env (DATABASE_URL)
import { createPrismaClient } from "@job-radar/db";
import { dedupeJobs } from "@job-radar/pipeline";

const apply = process.argv.includes("--apply");
const prisma = createPrismaClient();
try {
  const r = await dedupeJobs(prisma, { apply });
  const dups = r.groups.reduce((n, g) => n + g.drop.length, 0);
  console.log(`${r.jobs} offres en base, ${r.groups.length} groupe(s) de doublons (${dups} offre(s) en trop).`);
  for (const g of r.groups.slice(0, 60)) console.log(`  ${g.company ?? "?"} — ${g.title} : ${g.drop.length + 1} offres`);
  console.log(apply ? `\n${r.merged} offre(s) fusionnée(s).` : "\nRien n'a été supprimé. Pour fusionner : pnpm jobs:dedupe --apply");
} finally {
  await prisma.$disconnect();
}
