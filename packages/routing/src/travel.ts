import type { PrismaClient } from "@job-radar/db";
import { geocode } from "./geocode";
import type { Point, RoutingService } from "./types";

/** Au-delà, on arrête pour la journée (PRIM : 1 000 appels/jour pour un nouveau compte ; IGN : pas de quota journalier annoncé). */
export const DAILY_ROUTE_BUDGET = 800;

const round = (n: number, d: number) => n.toFixed(d);
export const originKeyOf = (p: Point) => `${round(p.lat, 3)},${round(p.lng, 3)}`;
/** Arrondi ~1 km : deux offres dans le même quartier partagent le même trajet (économise le quota). */
export const routeKeyOf = (provider: string, o: Point, d: Point) =>
  `${provider}|${round(o.lat, 3)},${round(o.lng, 3)}|${round(d.lat, 2)},${round(d.lng, 2)}`;

export type TravelReport = { considered: number; computed: number; fromCache: number; geocoded: number; skipped: string | null };

/**
 * Calcule le temps de trajet de CERTAINES offres (celles qu'on ouvre, ou les nouvelles offres
 * susceptibles d'être notifiées) — pas de calcul en masse, pour ménager le quota.
 * Jamais de durée inventée : pas d'itinéraire → minutes = null.
 */
export async function ensureTravelTimes(opts: {
  prisma: PrismaClient;
  routing: RoutingService;
  jobIds: string[];
  maxRoutes?: number;
  log?: (m: string) => void;
}): Promise<TravelReport> {
  const { prisma, routing, log = () => {} } = opts;
  const report: TravelReport = { considered: 0, computed: 0, fromCache: 0, geocoded: 0, skipped: null };
  if (opts.jobIds.length === 0) return report;
  if (!routing.isConfigured()) return { ...report, skipped: "calcul d'itinéraire non configuré" };

  const home = await prisma.profile.findFirst({ select: { homeLat: true, homeLng: true } });
  if (home?.homeLat == null || home.homeLng == null) return { ...report, skipped: "point de départ non renseigné" };
  const origin = { lat: home.homeLat, lng: home.homeLng };
  const originKey = originKeyOf(origin);

  const since = new Date(Date.now() - 86_400_000);
  let usedToday = await prisma.travelCache.count({ where: { createdAt: { gte: since } } });

  const jobs = await prisma.job.findMany({
    where: {
      id: { in: opts.jobIds },
      remoteType: { not: "remote" },
      // `not: "99"` seul exclurait aussi les départements inconnus (NULL en SQL) : la ville ne serait jamais localisée.
      AND: [{ OR: [{ department: null }, { department: { not: "99" } }] }],
      OR: [{ travel: null }, { travel: { originKey: { not: originKey } } }, { travel: { originKey: null } }],
    },
    select: { id: true, latitude: true, longitude: true, city: true, department: true, address: true, locationPrecision: true },
  });
  report.considered = jobs.length;
  let calls = 0;

  for (const job of jobs) {
    let dest: Point | null = job.latitude != null && job.longitude != null ? { lat: job.latitude, lng: job.longitude } : null;

    // Adresse précise connue (lue dans l'annonce) : on la localise (cache pour ne pas redemander).
    if (!dest && job.address && /\d/.test(job.address)) {
      const query = job.address.trim();
      const cached = await prisma.geocodeCache.findUnique({ where: { query } });
      let hit: { lat: number; lng: number } | null = null;
      if (cached) {
        hit = cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null;
      } else {
        const [found] = await geocode(query).catch(() => []);
        await prisma.geocodeCache.create({
          data: { query, lat: found?.lat ?? null, lng: found?.lng ?? null, precision: found ? found.precision : "unknown" },
        });
        report.geocoded++;
        hit = found ? { lat: found.lat, lng: found.lng } : null;
      }
      if (hit) {
        dest = hit;
        job.locationPrecision = "address";
        await prisma.job.update({ where: { id: job.id }, data: { latitude: hit.lat, longitude: hit.lng, locationPrecision: "address" } });
      }
    }

    // Pas de coordonnées : on cherche la commune (cache pour ne pas redemander).
    if (!dest && job.city) {
      const query = `${job.city} ${job.department ?? ""}`.trim();
      const cached = await prisma.geocodeCache.findUnique({ where: { query } });
      if (cached) {
        dest = cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null;
      } else {
        const [hit] = await geocode(query, { cityOnly: true }).catch(() => []);
        await prisma.geocodeCache.create({
          data: { query, lat: hit?.lat ?? null, lng: hit?.lng ?? null, precision: hit ? "city_centroid" : "unknown" },
        });
        report.geocoded++;
        dest = hit ? { lat: hit.lat, lng: hit.lng } : null;
      }
      if (dest) {
        await prisma.job.update({ where: { id: job.id }, data: { latitude: dest.lat, longitude: dest.lng, locationPrecision: "city_centroid" } });
      }
    }
    if (!dest) continue;

    const key = routeKeyOf(routing.name, origin, dest);
    let minutes: number | null;
    let provider = routing.name;
    const cached = await prisma.travelCache.findUnique({ where: { key } });
    if (cached) {
      minutes = cached.minutes;
      provider = cached.provider ?? routing.name;
      report.fromCache++;
    } else {
      if (calls >= (opts.maxRoutes ?? 20) || usedToday >= DAILY_ROUTE_BUDGET) {
        report.skipped = "quota atteint : la suite sera calculée plus tard";
        break;
      }
      try {
        // Le calculateur qui a vraiment répondu (PRIM en transports, IGN en voiture…).
        ({ minutes, provider } = await routing.estimateTravelTime(origin, dest));
      } catch (err) {
        report.skipped = err instanceof Error ? err.message : String(err);
        log(`Trajets : ${report.skipped}`);
        break; // erreur (clé, quota…) : on ne gaspille pas d'appels
      }
      calls++;
      usedToday++;
      report.computed++;
      await prisma.travelCache.create({ data: { key, minutes, provider } });
    }

    const precision = job.locationPrecision === "address" ? "address" : "city_centroid";
    await prisma.travelEstimate.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, minutes, provider, precision, originKey },
      update: { minutes, provider, precision, originKey, computedAt: new Date() },
    });
  }
  if (report.computed || report.fromCache) {
    log(`Trajets : ${report.computed} calculé(s), ${report.fromCache} déjà connu(s), ${report.geocoded} ville(s) localisée(s)`);
  }
  return report;
}

/**
 * Trajet entre deux points avec cache (même règle que pour les offres).
 * Renvoie undefined si le quota du jour est atteint (on réessaiera plus tard).
 */
export async function cachedTravelMinutes(
  prisma: PrismaClient,
  routing: RoutingService,
  origin: Point,
  dest: Point,
): Promise<number | null | undefined> {
  const key = routeKeyOf(routing.name, origin, dest);
  const cached = await prisma.travelCache.findUnique({ where: { key } });
  if (cached) return cached.minutes;
  const usedToday = await prisma.travelCache.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (usedToday >= DAILY_ROUTE_BUDGET) return undefined;
  const { minutes, provider } = await routing.estimateTravelTime(origin, dest);
  await prisma.travelCache.create({ data: { key, minutes, provider } });
  return minutes;
}
