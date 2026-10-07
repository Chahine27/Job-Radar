import type { SettingsState } from "./types";

/** Une carte de la page « Réglages » : un service, ses clés et comment les obtenir. */
export type SettingField = {
  key: string;
  label: string;
  placeholder?: string;
  /** Valeur proposée quand rien n'est enregistré (ex. smtp.gmail.com). */
  suggested?: string;
  optional?: boolean;
  help?: string;
};
export type SettingCard = {
  id: string;
  title: string;
  purpose: string;
  link: { href: string; label: string };
  steps: string[];
  fields: SettingField[];
  note?: string;
};

// Étapes vérifiées sur les sites officiels (octobre 2026).
export const SETTING_CARDS: SettingCard[] = [
  {
    id: "france-travail",
    title: "France Travail",
    purpose: "Les offres de France Travail et de ses partenaires, la page « Entreprises » (La Bonne Boîte) et les codes métier (ROMEO). Gratuit.",
    link: { href: "https://francetravail.io/produits-partages/catalogue", label: "francetravail.io — catalogue d'API" },
    steps: [
      "Crée un compte gratuit sur francetravail.io, puis connecte-toi.",
      "Dans ton espace, crée une application (nom au choix, par exemple « Ma recherche d'emploi »).",
      "Ajoute à cette application les API « Offres d'emploi », « La bonne boîte V2 » et « ROMEO » (dans le catalogue d'API).",
      "Copie l'identifiant client et la clé secrète de l'application, colle-les ci-dessous, puis Enregistrer et Tester.",
    ],
    fields: [
      { key: "FRANCE_TRAVAIL_CLIENT_ID", label: "Identifiant client", placeholder: "PAR_…" },
      { key: "FRANCE_TRAVAIL_CLIENT_SECRET", label: "Clé secrète" },
    ],
  },
  {
    id: "adzuna",
    title: "Adzuna",
    purpose: "Des offres venues de nombreux sites d'emploi. Gratuit, 250 appels par jour (l'appli les économise).",
    link: { href: "https://developer.adzuna.com/signup", label: "developer.adzuna.com — inscription" },
    steps: [
      "Remplis le formulaire d'inscription (nom, email, mot de passe, à quoi te sert l'API : « recherche d'emploi personnelle »).",
      "Accepte les conditions et valide ton inscription.",
      "Dans ton espace Adzuna, copie l'Application ID et l'Application key, colle-les ci-dessous, puis Enregistrer et Tester.",
    ],
    fields: [
      { key: "ADZUNA_APP_ID", label: "Application ID" },
      { key: "ADZUNA_APP_KEY", label: "Application key" },
    ],
  },
  {
    id: "jooble",
    title: "Jooble",
    purpose: "Encore plus d'offres, regroupées depuis de nombreux sites français. Gratuit, mais 500 appels au total par clé.",
    link: { href: "https://fr.jooble.org/api/about", label: "fr.jooble.org/api/about" },
    steps: [
      "Remplis le formulaire (nom, poste, email, site web : par exemple ta page LinkedIn, téléphone).",
      "Prends bien la clé sur fr.jooble.org : une clé d'un autre pays ne donne pas les offres françaises.",
      "Colle la clé reçue par email ci-dessous, puis Enregistrer. Active ensuite Jooble dans la page Sources.",
    ],
    fields: [{ key: "JOOBLE_API_KEY", label: "Clé Jooble" }],
    note: "Le bouton Tester fait un vrai appel : il compte dans les 500 de la clé.",
  },
  {
    id: "email",
    title: "Email (Gmail)",
    purpose: "Recevoir les alertes de nouvelles offres et envoyer tes candidatures spontanées depuis ton adresse.",
    link: { href: "https://myaccount.google.com/apppasswords", label: "myaccount.google.com/apppasswords" },
    steps: [
      "Active la « validation en deux étapes » sur ton compte Google (obligatoire pour l'étape suivante).",
      "Ouvre la page des « mots de passe d'application », donne un nom (par exemple « Job Radar ») et crée-le.",
      "Google affiche un code de 16 lettres : colle-le dans « Mot de passe d'application » (pas ton mot de passe habituel).",
      "Remplis ton adresse Gmail, puis Enregistrer et Tester.",
    ],
    fields: [
      { key: "SMTP_USER", label: "Adresse Gmail", placeholder: "prenom.nom@gmail.com" },
      { key: "SMTP_PASSWORD", label: "Mot de passe d'application", placeholder: "abcd efgh ijkl mnop" },
      { key: "NOTIFY_EMAIL_TO", label: "Recevoir les alertes sur", placeholder: "Par défaut : ton adresse Gmail", optional: true },
      { key: "SMTP_FROM", label: "Nom d'expéditeur des alertes", placeholder: "Job Radar <prenom.nom@gmail.com>", optional: true },
      { key: "SMTP_HOST", label: "Serveur", suggested: "smtp.gmail.com", help: "Ne change pas pour Gmail." },
      { key: "SMTP_PORT", label: "Port", suggested: "587", help: "Ne change pas pour Gmail." },
    ],
  },
  {
    id: "prim",
    title: "Transports en Île-de-France (PRIM)",
    purpose:
      "Facultatif. Sans rien faire, le temps de trajet est déjà calculé en voiture partout en France (IGN). Avec cette clé gratuite, il est calculé en transports en commun pour les trajets en Île-de-France.",
    link: { href: "https://prim.iledefrance-mobilites.fr", label: "prim.iledefrance-mobilites.fr" },
    steps: [
      "Crée un compte gratuit sur PRIM (Île-de-France Mobilités), puis connecte-toi.",
      "Dans ton menu personnel, ouvre « Mes jetons d'authentification », onglet « API ».",
      "Clique sur « Générer mon jeton », copie-le, colle-le ci-dessous, puis Enregistrer et Tester.",
    ],
    fields: [{ key: "PRIM_API_KEY", label: "Jeton (clé API)" }],
  },
  {
    id: "ai",
    title: "Lettre de motivation : modèle d'IA plus gros",
    purpose:
      "Facultatif. Par défaut, la lettre est écrite par le même modèle que le reste (gemma4:e4b, rapide). Un modèle plus gros écrit nettement mieux, mais met 2 à 3 minutes par lettre et demande un PC plus puissant (16 Go de mémoire conseillés).",
    link: { href: "https://ollama.com/library/gemma4", label: "ollama.com — modèles Gemma 4" },
    steps: [
      "Ouvre le menu Démarrer, tape « cmd » et ouvre l'Invite de commandes.",
      "Tape « ollama pull gemma4:12b » puis Entrée, et attends la fin du téléchargement (environ 8 Go).",
      "Écris « gemma4:12b » ci-dessous, puis Enregistrer et Tester. Pour revenir au modèle rapide, vide le champ et enregistre.",
    ],
    fields: [{ key: "OLLAMA_LETTER_MODEL", label: "Modèle pour la lettre", placeholder: "gemma4:12b" }],
  },
];

/** Champs dont on affiche la valeur actuelle (pas un secret). */
export const isPublicField = (state: SettingsState | null, key: string) => state?.keys[key]?.secret === false;

/** Brouillon de départ d'une carte : valeur actuelle pour les champs non secrets, vide pour les secrets. */
export function initialDrafts(card: SettingCard, state: SettingsState | null): Record<string, string> {
  return Object.fromEntries(
    card.fields.map((f) => {
      const k = state?.keys[f.key];
      if (k && !k.secret) return [f.key, k.filled ? k.display : (f.suggested ?? "")];
      return [f.key, ""];
    }),
  );
}

/**
 * Ce qu'il faut envoyer au serveur : un secret laissé vide = inchangé (on ne connaît pas sa valeur) ;
 * un champ visible est envoyé s'il a changé (vide = effacé).
 */
export function pendingChanges(card: SettingCard, drafts: Record<string, string>, state: SettingsState | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of card.fields) {
    const value = (drafts[f.key] ?? "").trim();
    const k = state?.keys[f.key];
    if (!k || k.secret) {
      if (value) out[f.key] = value;
    } else if (value !== (k.filled ? k.display : "")) {
      out[f.key] = value;
    }
  }
  return out;
}

/** Au moins une source d'offres a ses clés (sinon le bandeau de la page Offres s'affiche). */
export function anyJobSourceConfigured(state: SettingsState): boolean {
  return ["france-travail", "adzuna", "jooble"].some((s) => state.services[s]?.configured);
}
