import { OllamaClient } from "@job-radar/ai";
import { type Mailer, type Notifier, type SmtpConfig, verifySmtp } from "@job-radar/notifications";
import { PrimRoutingService, type RoutingService } from "@job-radar/routing";
import {
  AdzunaSource,
  type FetchLike,
  FranceTravailSource,
  JOOBLE_DEFAULTS,
  JoobleSource,
  type JobSource,
  type JoobleQuotaStore,
  LaBonneBoiteClient,
  RomeoClient,
} from "@job-radar/source-connectors";
import { REQUIRED_KEYS, type SettingKey, type SettingService, isSecretKey, maskSecret } from "./settings-keys";

/*
 * « Relais » : les services gardent la même identité pour le reste de l'appli, mais chaque appel
 * passe par le service du moment. Quand une clé change dans les Réglages, on reconstruit les
 * services et le relais suit, sans redémarrer.
 */

export function liveSource(get: () => JobSource): JobSource {
  const first = get();
  const source: JobSource = {
    name: first.name,
    search: (p) => get().search(p),
    healthCheck: () => get().healthCheck(),
  };
  if (first.searchAll) source.searchAll = (q) => get().searchAll!(q);
  if (first.fetchAll) source.fetchAll = () => get().fetchAll!();
  return source;
}

export function liveNotifier(get: () => Notifier): Notifier {
  return {
    channel: get().channel,
    isConfigured: () => get().isConfigured(),
    sendAlerts: (alerts) => get().sendAlerts(alerts),
    sendTest: () => get().sendTest(),
  };
}

export function liveMailer(get: () => Mailer): Mailer {
  return {
    isConfigured: () => get().isConfigured(),
    address: () => get().address(),
    send: (mail) => get().send(mail),
  };
}

export function liveRouting(get: () => RoutingService): RoutingService {
  return {
    get name() {
      return get().name;
    },
    isConfigured: () => get().isConfigured(),
    estimateTravelTime: (o, d) => get().estimateTravelTime(o, d),
  };
}

/** Configuration SMTP lue dans les valeurs de .env (mot de passe Gmail souvent collé avec des espaces). */
export function smtpFrom(v: Partial<Record<SettingKey, string | undefined>>): SmtpConfig {
  return {
    host: v.SMTP_HOST?.trim() || undefined,
    port: v.SMTP_PORT?.trim() ? Number(v.SMTP_PORT) : undefined,
    user: v.SMTP_USER?.trim() || undefined,
    password: v.SMTP_PASSWORD?.replace(/\s/g, "") || undefined,
  };
}

export type TestResult = { ok: boolean; message: string };
export type TestDeps = {
  /** Compteur Jooble (chaque appel compte dans les 500 de la clé gratuite). */
  joobleQuota: (apiKey: string) => JoobleQuotaStore;
  fetch?: FetchLike;
  verifySmtp?: (cfg: SmtpConfig) => Promise<void>;
  /** Adresse d'Ollama (OLLAMA_URL), pour tester le modèle de la lettre. */
  ollamaUrl?: string | undefined;
};

const LABELS: Record<SettingKey, string> = {
  FRANCE_TRAVAIL_CLIENT_ID: "Identifiant client",
  FRANCE_TRAVAIL_CLIENT_SECRET: "Clé secrète",
  ADZUNA_APP_ID: "Application ID",
  ADZUNA_APP_KEY: "Application key",
  JOOBLE_API_KEY: "Clé Jooble",
  SMTP_HOST: "Serveur",
  SMTP_PORT: "Port",
  SMTP_USER: "Adresse Gmail",
  SMTP_PASSWORD: "Mot de passe d'application",
  SMTP_FROM: "Nom d'expéditeur",
  NOTIFY_EMAIL_TO: "Adresse de réception",
  PRIM_API_KEY: "Clé PRIM",
  OLLAMA_LETTER_MODEL: "Modèle pour la lettre",
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Deux lieux publics de Paris, pour un trajet de test PRIM. */
const PRIM_TEST = { from: { lat: 48.8584, lng: 2.347 }, to: { lat: 48.8919, lng: 2.238 } };

/**
 * Bouton « Tester » : un vrai petit appel au service, avec les valeurs enregistrées.
 * Les messages ne contiennent jamais une clé en entier.
 */
export async function testService(
  service: SettingService,
  values: Partial<Record<SettingKey, string | undefined>>,
  deps: TestDeps,
): Promise<TestResult> {
  const v = (k: SettingKey) => values[k]?.trim() || undefined;
  const missing = REQUIRED_KEYS[service].filter((k) => !v(k));
  if (missing.length) return { ok: false, message: `Remplis et enregistre d'abord : ${missing.map((k) => LABELS[k]).join(", ")}.` };
  const fetchOpt = deps.fetch ? { fetch: deps.fetch } : {};
  const secrets = (Object.entries(values) as Array<[SettingKey, string | undefined]>)
    .filter(([k, s]) => isSecretKey(k) && s && s.trim().length >= 4)
    .map(([, s]) => s!);
  const scrub = (msg: string) => secrets.reduce((m, s) => m.split(s.trim()).join(maskSecret(s.trim())), msg);
  try {
    const res = await runTest(service, v, deps, fetchOpt);
    return { ok: res.ok, message: scrub(res.message) };
  } catch (err) {
    return { ok: false, message: scrub(errText(err)) };
  }
}

async function runTest(
  service: SettingService,
  v: (k: SettingKey) => string | undefined,
  deps: TestDeps,
  fetchOpt: { fetch?: FetchLike },
): Promise<TestResult> {
  switch (service) {
    case "france-travail": {
      const creds = { clientId: v("FRANCE_TRAVAIL_CLIENT_ID"), clientSecret: v("FRANCE_TRAVAIL_CLIENT_SECRET"), ...fetchOpt };
      const offers = await new FranceTravailSource(creds).healthCheck();
      if (offers.status !== "OK") {
        if (/invalid_client|HTTP 401/.test(offers.message)) {
          return { ok: false, message: "France Travail refuse ces identifiants : vérifie l'identifiant client et la clé secrète (sans espace)." };
        }
        if (/invalid_scope/.test(offers.message)) {
          return { ok: false, message: "Identifiants reconnus, mais l'API « Offres d'emploi » n'est pas ajoutée à ton application sur francetravail.io." };
        }
        return { ok: false, message: `France Travail : ${offers.message}` };
      }
      // Les deux autres API sont facultatives : on dit seulement ce qui manque.
      const missing: string[] = [];
      await new LaBonneBoiteClient(creds).healthCheck().catch(() => missing.push("« La bonne boîte V2 » (page Entreprises)"));
      await new RomeoClient(creds).healthCheck().catch(() => missing.push("« ROMEO » (codes métier)"));
      if (missing.length === 0) return { ok: true, message: "France Travail répond : offres d'emploi, La Bonne Boîte et ROMEO OK." };
      return { ok: true, message: `Offres d'emploi OK. À ajouter à ton application sur francetravail.io : ${missing.join(", ")}.` };
    }
    case "adzuna": {
      const health = await new AdzunaSource({ appId: v("ADZUNA_APP_ID"), appKey: v("ADZUNA_APP_KEY"), ...fetchOpt }).healthCheck();
      if (health.status === "OK") return { ok: true, message: "Adzuna répond : la clé fonctionne." };
      if (/HTTP 40[13]/.test(health.message)) return { ok: false, message: "Adzuna refuse la clé : vérifie l'Application ID et l'Application key." };
      return { ok: false, message: `Adzuna : ${health.message}` };
    }
    case "jooble": {
      const apiKey = v("JOOBLE_API_KEY")!;
      const quota = deps.joobleQuota(apiKey);
      const r = await new JoobleSource({ apiKey, quota, ...fetchOpt }).testCall("emploi", "France");
      const { used } = await quota.get();
      return { ok: true, message: `Jooble répond : ${r.count} offre(s) trouvée(s). Appels utilisés : ${used} sur ${JOOBLE_DEFAULTS.lifetimeLimit}.` };
    }
    case "email": {
      const cfg = smtpFrom({ SMTP_HOST: v("SMTP_HOST"), SMTP_PORT: v("SMTP_PORT"), SMTP_USER: v("SMTP_USER"), SMTP_PASSWORD: v("SMTP_PASSWORD") });
      try {
        await (deps.verifySmtp ?? verifySmtp)(cfg);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "EAUTH") {
          return { ok: false, message: "Adresse ou mot de passe refusé. Avec Gmail, il faut un « mot de passe d'application », pas ton mot de passe habituel." };
        }
        if (code && ["ECONNECTION", "ETIMEDOUT", "EDNS", "ESOCKET"].includes(code)) {
          return { ok: false, message: `Impossible de joindre ${cfg.host}:${cfg.port ?? 587}. Vérifie le serveur, le port et ta connexion internet.` };
        }
        throw err;
      }
      return { ok: true, message: `Connexion réussie à ${cfg.host} avec ${cfg.user}. Les emails peuvent partir.` };
    }
    case "ai": {
      const model = v("OLLAMA_LETTER_MODEL")!;
      const s = await new OllamaClient({ baseUrl: deps.ollamaUrl, model, ...fetchOpt }).status();
      if (!s.available) return { ok: false, message: s.message ?? "Ollama ne répond pas." };
      if (!s.installed) return { ok: false, message: s.message ?? `Modèle « ${model} » absent.` };
      return { ok: true, message: `Le modèle « ${model} » est installé : il écrira les lettres de motivation.` };
    }
    case "prim": {
      try {
        const r = await new PrimRoutingService({ apiKey: v("PRIM_API_KEY"), ...fetchOpt }).estimateTravelTime(PRIM_TEST.from, PRIM_TEST.to);
        if (r.minutes != null) return { ok: true, message: `PRIM répond : trajet test dans Paris calculé (${r.minutes} min).` };
        return { ok: true, message: "PRIM répond (aucun itinéraire pour le trajet test, mais la clé est acceptée)." };
      } catch (err) {
        if (/HTTP 40[13]/.test(errText(err))) return { ok: false, message: "PRIM refuse la clé : génère un jeton dans l'onglet « API » de « Mes jetons d'authentification »." };
        throw err;
      }
    }
  }
}
