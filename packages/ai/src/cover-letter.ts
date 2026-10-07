import type { LetterKit } from "@job-radar/shared";
import { extractSkills, getSkill, resolveSkill, type Skill } from "@job-radar/skills";
import { z } from "zod";
import type { AnalysisJobInput } from "./job-analysis";
import type { OllamaClient } from "./ollama";

/** Changer ce numéro quand la consigne change : les lettres existantes seront signalées « à refaire ». */
export const LETTER_PROMPT_VERSION = "2026-10-06.1";

/** Ce que l'IA écrit : l'objet et le corps. L'en-tête, « Madame, Monsieur » et la politesse sont ajoutés par le code. */
export const LetterDraftSchema = z.object({
  /**
   * Plan écrit AVANT la lettre (le modèle le remplit en premier) : pour chaque exigence de l'annonce,
   * le fait du CV qui y répond. Oblige l'IA à choisir des preuves pertinentes au lieu de réciter le CV.
   */
  correspondances: z
    .array(z.object({ exigence: z.string().trim().max(200), preuve: z.string().trim().max(300) }))
    .max(8)
    .default([]),
  objet: z.string().trim().min(5).max(200),
  paragraphes: z.array(z.string().trim().min(1).max(2000)).min(3).max(7),
});
export type LetterDraft = z.infer<typeof LetterDraftSchema>;
/** Ce qui sert à écrire la lettre (le plan « correspondances » reste interne). */
export type LetterBody = Pick<LetterDraft, "objet" | "paragraphes">;

export const LETTER_JSON_SCHEMA = {
  type: "object",
  properties: {
    correspondances: {
      type: "array",
      items: {
        type: "object",
        properties: { exigence: { type: "string" }, preuve: { type: "string" } },
        required: ["exigence", "preuve"],
      },
    },
    objet: { type: "string" },
    paragraphes: { type: "array", items: { type: "string" } },
  },
  required: ["correspondances", "objet", "paragraphes"],
} as const;

// Limites pour tenir dans la mémoire de travail du modèle (8k) avec la réponse.
const MAX_JOB = 5_000;
const MAX_CV = 5_000;
const MAX_EXAMPLE = 4_000;
const MAX_RULES = 8_000;

export const LETTER_SYSTEM_PROMPT = `Tu écris une lettre de motivation en français pour un candidat, à partir de SON CV et d'une annonce. Le candidat peut exercer n'importe quel métier.
Tu réponds UNIQUEMENT avec le JSON demandé.

1. VÉRITÉ (règles absolues)
- N'invente RIEN : chaque expérience, projet, diplôme, chiffre, compétence ou outil cité doit être écrit dans le CV (ou dans les RÈGLES DU CANDIDAT, écrites par lui). Aucun chiffre qui n'y figure pas.
- Si des RÈGLES DU CANDIDAT sont fournies, elles passent AVANT toutes les règles ci-dessous en cas de conflit (structure, longueur, phrases types, phrase d'introduction imposée). Leurs listes de FAITS sont la référence : n'ajoute rien qu'elles ne disent pas.
- Projet en équipe : ce que le candidat a fait lui-même se dit « j'ai… » ; ce que faisait le reste de l'équipe se dit « le projet utilisait… ». Ne lui attribue jamais la part de l'équipe.
- Notion vue en formation (cours) : « ma formation m'a apporté des bases en… », jamais « j'ai conçu » ni « j'ai mis en production ».
- Associe une compétence ou un outil à une expérience SEULEMENT si le CV l'écrit pour CETTE expérience (ne prête pas à un poste ce qui a été fait ailleurs).
- Une expérience professionnelle (emploi, alternance, stage) n'est jamais présentée comme un projet de formation, et inversement.
- Sur l'entreprise, utilise seulement ce que dit l'annonce. Nom inconnu → n'en invente pas.

2. NIVEAU : ni trop, ni trop peu
- Jamais « je maîtrise », « maîtriser », « expert », « expertise », « parfaitement » (SEULE exception : ce qui est listé dans « CE QU'IL MAÎTRISE », si la liste est fournie). Écris « j'ai réalisé », « j'ai utilisé », « j'ai pratiqué », « j'ai travaillé avec ».
- Compétence de l'annonce ABSENTE du CV : jamais « approfondir », « consolider », « renforcer », « ma connaissance de », « j'ai de l'expérience en » pour elle. Ne LISTE JAMAIS ce qui lui manque. Au plus UN manque dans toute la lettre, et seulement s'il est central dans l'annonce (dans le titre ou parmi les premières exigences) : « … que je souhaite approfondir en m'appuyant sur … (une compétence PROCHE du CV) ». Sinon, n'en parle pas.
- Compétence PRÉSENTE dans le CV (même dans « Autres » ou « Outils ») : jamais « je souhaite l'apprendre » ; dis qu'il l'a déjà pratiquée.

3. PERTINENCE (le plus important)
- Commence par le plan « correspondances » : les 3 à 5 exigences les plus importantes de l'annonce (dans l'ordre du « profil recherché ») et, pour chacune, le fait PRÉCIS du CV qui y répond (« aucune » s'il n'y en a pas). Cherche aussi les ressemblances de métier (même type de clientèle, même secteur, même outil sous un autre nom).
- La lettre est écrite à partir de ces correspondances SEULEMENT. Chaque paragraphe répond à une exigence de l'annonce.
- Pas de catalogue du CV : une compétence absente de l'annonce ne doit pas être citée, sauf si c'est la seule preuve d'une compétence demandée.
- Les qualités (autonome, rigoureux…) se prouvent par un fait QUI LES MONTRE VRAIMENT et qui a un rapport avec le poste ; sinon ne les cite pas. Pas de lien artificiel.
- Le paragraphe sur les projets de formation n'existe que s'il répond à une exigence de CETTE annonce.

4. STYLE : une lettre écrite par une personne, pas par un robot
- Première personne, vouvoiement du recruteur, phrases courtes (25 mots maximum), un fait par phrase.
- Écris comme il parlerait à un recruteur à l'oral : simple, précis, sans jargon RH. Relis chaque phrase : si elle pourrait figurer dans n'importe quelle lettre, remplace-la par un fait précis.
- Varie les débuts de phrase : jamais plus de deux phrases de suite qui commencent par « J'ai ». Alterne avec le contexte (« Chez [entreprise], … », « Sur le projet [nom], … », « Avec les clients, … »).
- Pas de récitation chronologique du CV : chaque fait cité est relié en quelques mots à un besoin de l'annonce (« … , ce qui correspond à votre besoin de … » est interdit : dis-le simplement, par exemple « C'est le même type de clientèle que la vôtre. »).
- Ne répète pas une même compétence plus de deux fois, ni le même verbe dans un paragraphe (« réalisé » trois fois).
- Ne prétends jamais que l'offre « correspond à mon parcours » si des compétences principales lui manquent : dis ce qui est transférable.
- Clichés interdits : « bases solides », « m'ont exposé », « je vise », « correspond à mon parcours », « je serais intéressé », « mettre à profit », « au sein de votre structure », « environnement stimulant », « je suis convaincu », « motivé », « sérieux », « missions variées et complexes ».
- Pas de faux liens de cause : n'écris pas « ce qui m'a permis de », « ce qui me permet de » ni « comme en témoigne » ; décris simplement ce qu'il a fait.
- Nomme l'entreprise (ex. « chez [entreprise] ») et la mission : « une expérience enrichissante » ne dit rien.
- Verbes simples à la première personne (« j'ai développé », « j'ai créé », « j'ai migré ») : c'est bien, mais pas plus de deux phrases de suite qui commencent par « J'ai ».
- « particulièrement », « notamment », « également », « aussi » : une fois au plus chacun. Pas de tiret long (—), pas de liste à puces, pas de gras.
- Chaque phrase apporte un fait. Pas d'importance annoncée sans preuve (« ce qui souligne », « joue un rôle clé », « ma démarche structurée ») ; pas de formule du type « Plus qu'un poste, c'est… » ; pas de listes de trois éléments par réflexe.
- Varie la longueur des phrases : une courte quand elle suffit, une plus longue quand deux idées sont liées.
- N'invente jamais un détail pour remplir une phrase vide : supprime-la.
- La conclusion ne répète pas l'introduction : une phrase qui propose un échange, c'est tout.
- Mots interdits : « passionné », « dynamique », « challenge », « valeur ajoutée », « opportunité », « je me permets », « n'hésitez pas », « je suis prêt à », « véritable », « parfaite adéquation ».
- Pas de connecteurs en série (« De plus », « Parallèlement », « En outre ») : au plus un par lettre.
- Ne recopie pas l'annonce (« Votre mission consiste à… »), ne répète pas le nom complet du produit. Corrige les fautes de l'annonce.
- Annonce d'un intermédiaire (cabinet de recrutement, agence d'intérim, société de services : « nos clients », « pour notre client ») : ne dis pas ce qui l'attire chez l'intermédiaire ; parle du poste et de l'employeur décrits.
- LETTRE EXEMPLE : c'est SA façon d'écrire. Imite-la vraiment : même façon d'ouvrir, d'enchaîner les paragraphes et de conclure, mêmes tournures quand elles s'appliquent, même longueur. Ne reprends jamais son entreprise, son poste ni ses détails.
- Ne recopie aucune phrase de l'annonce (sauf l'intitulé du poste) : dis avec tes mots pourquoi le poste t'intéresse.

5. CONTENU
- objet : « Candidature au poste de » + l'intitulé du poste (sans « H/F »), orthographe corrigée.
- paragraphes : 3 à 5 paragraphes, 250 à 350 mots en tout (une page) :
  1. qui il est (formation, dernière expérience chez l'entreprise nommée) et le poste visé, avec UN élément concret de l'annonce qui l'attire ;
  2. (et 3. si utile) les preuves des correspondances, avec des faits concrets du CV ;
  4. les éventuels manques (une phrase franche) et ce qu'il apportera ;
  5. une phrase de conclusion qui propose un échange (avec le nom de l'entreprise s'il est connu).
- N'écris PAS « Madame, Monsieur », ni la formule de politesse finale, ni la signature : elles sont ajoutées automatiquement.`;

function customSkills(labels: string[]): Skill[] {
  return labels.map((name) => resolveSkill(name)).filter((skill) => skill.id.startsWith("custom:"));
}

function masteredLabels(kit: Pick<LetterKit, "mastered">): string[] {
  return (kit.mastered ?? "").split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean);
}

function skillLabel(id: string, extraSkills: Skill[] = []): string {
  return getSkill(id)?.label ?? extraSkills.find((skill) => skill.id === id)?.label ?? id;
}

/**
 * Calcul fait par le code (fiable) avant d'écrire : compétences de l'annonce présentes dans le CV (avec la ligne
 * du CV qui le prouve), dans l'ordre où l'annonce les cite, et compétences qui manquent.
 */
export function strengthsAndGaps(
  jobText: string,
  cvText: string,
  knownSkills: string[] = [],
): { strengths: Array<{ id: string; skill: string; proof: string }>; gaps: string[] } {
  const extraSkills = customSkills(knownSkills);
  const job = extractSkills(jobText, extraSkills);
  const cv = new Set(extractSkills(cvText, extraSkills));
  const lower = jobText.toLowerCase();
  const pos = (id: string) => {
    const sk = getSkill(id) ?? extraSkills.find((skill) => skill.id === id);
    const idx = [sk?.label ?? id, ...(sk?.aliases ?? [])].map((a) => lower.indexOf(a.toLowerCase())).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : Number.MAX_SAFE_INTEGER;
  };
  const ordered = [...job].sort((a, b) => pos(a) - pos(b));
  const lines = cvText.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3);
  const proofOf = (id: string) => {
    // La ligne la plus « concrète » (expérience ou projet) plutôt qu'une rubrique « Compétences », « Logiciels », « Langues »…
    const hits = lines.filter((l) => extractSkills(l, extraSkills).includes(id));
    const concrete = hits.find((l) => !/^(-\s*)?(comp[ée]tences|savoir[- ]faire|logiciels|outils|langues|permis|qualit[ée]s|centres d.int[ée]r[êe]t|autres|frontend|backend|mobile|architecture|devops|accessibilit)\b/i.test(l));
    return (concrete ?? hits[0] ?? "").slice(0, 160);
  };
  return {
    strengths: ordered.filter((id) => cv.has(id)).map((id) => ({ id, skill: skillLabel(id, extraSkills), proof: proofOf(id) })).slice(0, 8),
    gaps: ordered.filter((id) => !cv.has(id)).map((id) => skillLabel(id, extraSkills)).slice(0, 8),
  };
}

/** Options d'écriture : candidature spontanée (pas d'offre publiée). */
export type LetterOptions = { spontaneous?: boolean };

/** Entreprise visée par une candidature spontanée (La Bonne Boîte). */
export type SpontaneousCompany = {
  name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  headcountMin: number | null;
  headcountMax: number | null;
};

/**
 * Une candidature spontanée n'a pas d'annonce : on décrit seulement ce qu'on sait de l'entreprise
 * (nom, secteur, ville, taille), pour que l'IA n'invente ni produit, ni client, ni projet.
 */
export function spontaneousJobInput(c: SpontaneousCompany, title: string): AnalysisJobInput {
  const size =
    c.headcountMin != null && c.headcountMax != null
      ? `${c.headcountMin} à ${c.headcountMax} salariés`
      : c.headcountMin != null
        ? `au moins ${c.headcountMin} salariés`
        : "non indiqué";
  return {
    title,
    company: c.name,
    city: c.city,
    department: c.department,
    contractType: "CDI",
    remoteType: "unknown",
    salaryMin: null,
    salaryMax: null,
    description: [
      "CANDIDATURE SPONTANÉE : l'entreprise n'a publié AUCUNE offre.",
      `Entreprise : ${c.name}`,
      `Secteur d'activité : ${c.sector ?? "non indiqué"}`,
      `Ville : ${c.city ?? "non indiquée"}`,
      `Taille : ${size}`,
      `Poste proposé par le candidat : ${title} (CDI).`,
      "Ce sont les SEULES informations connues sur l'entreprise.",
    ].join("\n"),
  };
}

const SPONTANEOUS_RULES = `CANDIDATURE SPONTANÉE (priorité sur tout le reste)
- Il n'y a PAS d'offre : n'écris jamais « votre offre », « votre annonce », « le poste que vous proposez ». Objet : « Candidature spontanée – » + l'intitulé visé.
- Si les RÈGLES DU CANDIDAT prévoient une phrase sur « votre offre », remplace-la par l'envie de rejoindre l'entreprise, avec une raison liée à son SECTEUR (seule info connue).
- N'invente RIEN sur l'entreprise : ni produit, ni client, ni projet, ni valeur, ni actualité. Seuls le nom, le secteur, la ville et la taille sont connus.
- Présente les expériences les plus solides du CV (pas de compétences « demandées » : il n'y en a pas).
`;

export function buildLetterPrompt(job: AnalysisJobInput, kit: LetterKit, opts: LetterOptions = {}): string {
  const place = [job.city, job.department ? `(${job.department})` : null].filter(Boolean).join(" ") || "non indiqué";
  const { strengths, gaps } = strengthsAndGaps(`${job.title}\n${job.description}`, kit.cvText, masteredLabels(kit));
  const table = strengths.length
    ? `ATOUTS VÉRIFIÉS (compétences de l'annonce présentes dans le CV, dans l'ordre de l'annonce ; utilise en priorité les premières)
${strengths.map((x) => `- ${x.skill} ← CV : « ${x.proof} »`).join("\n")}
`
    : "";
  const missing = gaps.length ? `MANQUES (compétences de l'annonce absentes du CV : NE LES LISTE PAS dans la lettre ; au plus une, si elle est centrale)\n- ${gaps.join(", ")}\n` : "";
  const own = kit.rules?.trim()
    ? `RÈGLES DU CANDIDAT (écrites par lui : elles passent AVANT les règles générales ; les faits qu'elles contiennent sont vrais)
"""
${kit.rules.trim().slice(0, MAX_RULES)}
"""
`
    : "";
  const mastered = masteredSkills(kit).size ? `CE QU'IL MAÎTRISE (les seules compétences où « maîtrise » est permis) : ${kit.mastered}\n` : "";
  const closing = kit.closing?.trim()
    ? `DERNIER PARAGRAPHE : ajouté automatiquement (« ${kit.closing.trim().slice(0, 200)} »). N'écris PAS de conclusion ni de phrase qui propose un échange.\n`
    : "";
  return `${opts.spontaneous ? SPONTANEOUS_RULES : ""}${own}${mastered}${closing}${table}${missing}
CV DU CANDIDAT
"""
${kit.cvText.slice(0, MAX_CV)}
"""

LETTRE EXEMPLE (écrite pour une AUTRE entreprise : pour le style uniquement)
"""
${kit.letterExample ? kit.letterExample.slice(0, own ? MAX_EXAMPLE - 1_000 : MAX_EXAMPLE) : "aucune"}
"""

ANNONCE
Titre : ${job.title}
Entreprise : ${job.company ?? "non indiquée"}
Lieu : ${place}
Contrat : ${job.contractType ?? "non indiqué"}

Texte de l'annonce :
"""
${job.description.slice(0, own ? MAX_JOB - 1_000 : MAX_JOB)}
"""`;
}

const OPENING = /^(madame|monsieur|bonjour)\b[^.]{0,40},?$/i;
const CLOSING = /(je vous prie d.agr|veuillez agr|salutations distingu|cordialement|bien à vous)/i;

/** Retire ce que le modèle ajoute malgré la consigne (« Madame, Monsieur », politesse, signature, numéros). */
export function cleanDraft(d: LetterBody, signature: string): LetterBody {
  const sig = signature.trim().toLowerCase();
  const paragraphes = d.paragraphes
    .map((p) => p.replace(/^\s*\d+[.)]\s+/, "").trim())
    .filter((p) => p && !OPENING.test(p) && !(CLOSING.test(p) && p.length < 300) && p.toLowerCase() !== sig);
  const objet = d.objet
    .replace(/^objet\s*:\s*/i, "")
    .replace(/\s*[(\[]?\b[HF]\s*\/\s*[HF]\b[)\]]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { objet, paragraphes };
}

export function formatLetterDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Lettre complète, prête à copier : en-tête, lieu et date, objet, corps, politesse, signature. */
export function assembleLetter(kit: LetterKit, draft: LetterBody, date: Date): string {
  const parts: string[] = [];
  // En-tête recopié d'une ancienne lettre : on retire son « Objet » et sa date, ajoutés plus bas pour CETTE offre.
  const header = kit.header
    .split("\n")
    .filter((l) => !/^\s*objet\s*:/i.test(l) && !/^\s*(à .+, )?le \d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s*$/i.test(l))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (header) parts.push(header);
  const d = formatLetterDate(date);
  parts.push(kit.city.trim() ? `À ${kit.city.trim()}, le ${d}` : `Le ${d}`);
  parts.push(`Objet : ${draft.objet}`);
  parts.push("Madame, Monsieur,");
  parts.push(...draft.paragraphes);
  parts.push("Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.");
  if (kit.signature.trim()) parts.push(kit.signature.trim());
  return parts.join("\n\n");
}

/**
 * Relecture automatique : ce qui mérite un coup d'œil avant d'envoyer.
 * - compétence citée dans la lettre mais absente du CV (l'IA a peut-être dit que tu la maîtrises) ;
 * - nom propre venant de la lettre exemple (autre entreprise) et absent de l'annonce et du CV.
 */
export function checkLetter(letter: string, kit: LetterKit, jobText: string, jobTitle = "", opts: LetterOptions = {}): string[] {
  const warnings: string[] = [];
  const extraSkills = customSkills(masteredLabels(kit));
  const inCv = new Set(extractSkills(kit.cvText, extraSkills));
  // Le titre du poste recopié (objet, 1re phrase) n'est pas une affirmation de maîtrise.
  const title = jobTitle.replace(/\s*[(\[]?\b[HF]\s*\/\s*[HF]\b[)\]]?/gi, "").trim();
  const claims = title ? letter.split(title).join(" ") : letter;
  for (const id of extractSkills(claims, extraSkills)) {
    if (inCv.has(id)) continue;
    const label = skillLabel(id, extraSkills);
    warnings.push(`« ${label} » n'est pas dans ton CV : vérifie que la lettre ne dit pas que tu le maîtrises.`);
  }
  // « je souhaite apprendre Python » alors que Python est dans le CV : la lettre se sous-vend.
  for (const m of letter.matchAll(/(?:apprendre|découvrir|me former (?:à|sur)|monter en compétences? (?:sur|en))\s+(?:le |la |l'|les )?([^.,;\n]{2,60})/gi)) {
    for (const id of extractSkills(m[1]!, extraSkills)) {
      if (!inCv.has(id)) continue;
      const label = skillLabel(id, extraSkills);
      warnings.push(`La lettre dit que tu veux apprendre « ${label} », alors que c'est dans ton CV : dis plutôt que tu l'as déjà pratiqué.`);
    }
  }
  if (/\bVu\.js\b/.test(letter)) warnings.push("« Vu.js » : faute de frappe (Vue.js).");
  // Mots interdits, « maîtrise / expert », phrases trop longues : les mêmes règles que la relecture automatique.
  for (const issue of findLetterIssues(letter, kit, jobText, opts)) {
    if (/^(Supprime|Pas de « maîtrise »|Phrase trop longue|Ne liste pas tes manques|Le chiffre|Phrase recopiée|Candidature spontanée)/.test(issue)) warnings.push(issue);
  }
  // Compétences du CV citées dans la lettre mais absentes de l'annonce : la lettre récite le CV au lieu de répondre à l'offre.
  const inJob = new Set(extractSkills(jobText, extraSkills));
  const offTopicIds = offTopicSkills(letter, inCv, inJob, extraSkills);
  const offTopic = offTopicIds.map((id) => skillLabel(id, extraSkills));
  if (familiesOf(offTopicIds, extraSkills) >= 2) {
    warnings.push(`La lettre cite ${offTopic.join(", ")}, absents de l'annonce : garde seulement ce qui répond à l'offre (sinon ça ressemble à une récitation du CV).`);
  }
  if (kit.letterExample) {
    const known = `${kit.cvText}\n${jobText}\n${kit.header}\n${kit.signature}\n${kit.city}`.toLowerCase();
    const seen = new Set<string>();
    // Mot avec majuscule au milieu d'une phrase (« chez Veillis », « votre CTO ») : sûrement un nom propre.
    for (const m of kit.letterExample.matchAll(/(?<=[\p{Ll}'’] )(\p{Lu}[\p{L}\p{N}-]{2,})/gu)) {
      const word = m[1]!;
      if (seen.has(word) || known.includes(word.toLowerCase())) continue;
      seen.add(word);
      if (new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, "u").test(letter)) {
        warnings.push(`« ${word} » vient de ta lettre exemple (autre entreprise) : vérifie qu'il a sa place ici.`);
      }
    }
  }
  return warnings;
}

/** Fautes de frappe fréquentes dans les titres d'annonces, corrigées dans la lettre. */
const TYPOS: Array<[RegExp, string]> = [
  [/\bVu\.js\b/g, "Vue.js"],
  [/\bVue\.JS\b/g, "Vue.js"],
  [/\bRect\.js\b/g, "React.js"],
  [/\bNode\.JS\b/g, "Node.js"],
  [/\bJava\s?script\b/g, "JavaScript"],
  [/\bType\s?script\b/g, "TypeScript"],
];
export function fixTypos(text: string): string {
  return TYPOS.reduce((t, [re, good]) => t.replace(re, good), text);
}

// ───── Relecture automatique avant de rendre la lettre : les règles que le modèle oublie parfois ─────

// Bornes de mots compatibles avec les accents (\b ne connaît pas « é »).
const word = (src: string) => new RegExp(`(?<![\\p{L}])(?:${src})(?![\\p{L}])`, "iu");
const FORBIDDEN: Array<[RegExp, string]> = [
  [word("passionn[ée]e?s?"), "« passionné »"],
  [word("dynamiques?"), "« dynamique »"],
  [word("challenges?"), "« challenge »"],
  [word("valeur ajout[ée]e"), "« valeur ajoutée »"],
  [word("opportunit[ée]s?"), "« opportunité »"],
  [word("je me permets"), "« je me permets »"],
  [word("n['’]h[ée]sitez pas"), "« n'hésitez pas »"],
  [word("je suis pr[êe]te? à"), "« je suis prêt à »"],
  [word("v[ée]ritables?"), "« véritable »"],
  [word("parfaite ad[ée]quation"), "« parfaite adéquation »"],
  [word("comme en t[ée]moigne"), "« comme en témoigne » (faux lien de cause)"],
  [word("ce qui m['’]a permis"), "« ce qui m'a permis » (faux lien de cause)"],
  [word("m['’]ont expos[ée]|m['’]a expos[ée]"), "« m'ont exposé » (dis ce que tu as pratiqué)"],
  [word("bases? solides?"), "« bases solides » (cliché)"],
  [word("je vise"), "« je vise » (dis simplement que tu candidates)"],
  [word("correspond(?:ent)? à mon parcours"), "« correspond à mon parcours » (dis ce qui est transférable)"],
  [word("je serais int[ée]ress[ée]e?"), "« je serais intéressé » (trop faible)"],
  [word("mettre à profit"), "« mettre à profit » (cliché)"],
  [word("au sein de votre structure"), "« au sein de votre structure » (cliché)"],
  [word("environnement stimulant"), "« environnement stimulant » (cliché)"],
  [word("je suis convaincu"), "« je suis convaincu » (cliché)"],
  [word("applications? m[ée]tiers? complexes?"), "« applications métier complexes » (trop vague : cite l'application)"],
  [word("ce qui me permet(?:tra)?"), "« ce qui me permet » (faux lien de cause)"],
  [word("d[ée]marche structur[ée]e"), "« démarche structurée » (qualité sans preuve)"],
  [word("syst[èe]mes complexes"), "« systèmes complexes » (trop vague : cite le logiciel)"],
  [word("joue(?:nt)? un r[ôo]le (?:cl[ée]|essentiel|central|majeur)"), "« joue un rôle clé » (importance annoncée sans preuve)"],
  [word("ce qui souligne|ce qui t[ée]moigne"), "« ce qui souligne / témoigne » (importance annoncée sans preuve)"],
  [word("plus qu['’]un (?:simple )?(?:poste|emploi|m[ée]tier)"), "« plus qu'un poste, c'est… » (formule toute faite)"],
  [/—/, "le tiret long « — » (mets une virgule ou un point)"],
];
/** Mots utiles une fois, mais qui sonnent « robot » quand ils reviennent. */
const ONCE = ["particulièrement", "notamment", "également", "aussi"];

/**
 * Projets et entreprises du CV, avec les compétences et outils écrits pour chacun.
 */
export function cvEntities(
  cvText: string,
  extraSkills: Skill[] = [],
): Array<{ name: string; kind: "projet" | "entreprise"; skills: Set<string> }> {
  const out: Array<{ name: string; kind: "projet" | "entreprise"; skills: Set<string> }> = [];
  let employer: { name: string; kind: "entreprise"; skills: Set<string> } | null = null;
  for (const raw of cvText.split(/\n/)) {
    const line = raw.trim();
    const emp = line.match(/·\s*([\p{Lu}][\p{L}0-9&'’ .-]{1,40})$/u);
    if (emp && /\d{4}/.test(line)) {
      const name = emp[1]!.trim();
      employer = out.find((e) => e.kind === "entreprise" && e.name.toLowerCase() === name.toLowerCase()) as typeof employer;
      if (!employer) out.push((employer = { name, kind: "entreprise", skills: new Set() }));
      continue;
    }
    const proj = line.match(/^[-•]\s*([^—–:]{2,40}?)\s+[—–]\s+/);
    if (proj) {
      employer = null;
      out.push({ name: proj[1]!.trim(), kind: "projet", skills: new Set(extractSkills(line, extraSkills)) });
      continue;
    }
    if (employer && /^[-•]/.test(line)) for (const id of extractSkills(line, extraSkills)) employer.skills.add(id);
    else if (!line.startsWith("-")) employer = null;
  }
  return out;
}
const MASTERY = word("je ma[îi]trise|ma ma[îi]trise|ma[îi]triser|ma[îi]trise (?:de|du|des|d['’])|expert(?:e|ise)?|parfaitement");
const KNOWS = /(approfondi|consolid|renforc|ma connaissance d|connaissances? (en|de|sur)|exp[ée]rience (avec|en|sur|de)|j['’]ai (utilis|pratiqu|travaill|d[ée]velopp|con[çc]u)|ma[îi]tris)/i;

/**
 * Compétences du CV citées dans la lettre mais sans rapport avec l'annonce : ni demandées, ni proches du même domaine.
 */
/** Compétences personnalisées inconnues partagent la famille « other ». */
const familiesOf = (ids: string[], extraSkills: Skill[] = []) =>
  new Set(
    ids.map((id) => {
      const family = getSkill(id)?.family ?? extraSkills.find((skill) => skill.id === id)?.family;
      return family && family !== "other" ? family : id;
    }),
  ).size;

function offTopicSkills(text: string, inCv: Set<string>, inJob: Set<string>, extraSkills: Skill[] = []): string[] {
  const families = new Set(
    [...inJob]
      .map((id) => getSkill(id)?.family ?? extraSkills.find((skill) => skill.id === id)?.family)
      .filter(Boolean),
  );
  return [...new Set(extractSkills(text, extraSkills))].filter((id) => {
    if (!inCv.has(id) || inJob.has(id)) return false;
    const fam = getSkill(id)?.family ?? extraSkills.find((skill) => skill.id === id)?.family;
    return !(fam && fam !== "other" && families.has(fam));
  });
}

/**
 * Problèmes précis d'une lettre, rédigés comme des consignes de correction pour l'IA.
 * Vide = rien à corriger.
 */
/** Compétences que le candidat dit maîtriser (champ « mastered »). */
export function masteredSkills(kit: Pick<LetterKit, "mastered">): Set<string> {
  const names = masteredLabels(kit);
  return new Set(extractSkills(names.join("\n"), customSkills(names)));
}

/** Mots interdits choisis par le candidat (virgules, points-virgules ou un par ligne). */
function ownBanned(kit: Pick<LetterKit, "bannedWords">): Array<[RegExp, string]> {
  return (kit.bannedWords ?? "")
    .split(/[,;\n]+/)
    .map((w) => w.trim().replace(/^[«"“]\s*|\s*[»"”]$/g, ""))
    .filter((w) => w.length >= 2)
    .map((w) => [word(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]")), `« ${w} » (dans tes mots interdits)`]);
}

/** Dernier paragraphe fixe, avec le nom de l'entreprise. */
export function closingParagraph(kit: Pick<LetterKit, "closing">, company: string | null | undefined): string {
  const c = (kit.closing ?? "").trim();
  if (!c) return "";
  return c.replace(/\{\s*entreprise\s*\}|\[\s*entreprise\s*\]/gi, company?.trim() || "votre entreprise");
}

const normWords = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Passage d'au moins 6 mots recopié de l'annonce (hors intitulé du poste). */
export function copiedFromJob(body: string, jobText: string, jobTitle = ""): string[] {
  const job = normWords(jobText);
  const title = normWords(jobTitle).join(" ");
  const grams = new Set<string>();
  for (let i = 0; i + 6 <= job.length; i++) grams.add(job.slice(i, i + 6).join(" "));
  const found: string[] = [];
  for (const s of body.split(/(?<=[.!?])\s+|\n+/)) {
    const w = normWords(s);
    for (let i = 0; i + 6 <= w.length; i++) {
      const g = w.slice(i, i + 6).join(" ");
      if (grams.has(g) && !(title && title.includes(g))) {
        found.push(s.trim().slice(0, 90));
        break;
      }
    }
  }
  return found;
}

export function findLetterIssues(body: string, kit: LetterKit, jobText: string, opts: LetterOptions = {}): string[] {
  const issues: string[] = [];
  const extraSkills = customSkills(masteredLabels(kit));
  const inCv = new Set(extractSkills(kit.cvText, extraSkills));
  const inJob = new Set(extractSkills(jobText, extraSkills));
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const label = (id: string) => skillLabel(id, extraSkills);

  for (const [re, name] of [...FORBIDDEN, ...ownBanned(kit)]) if (re.test(body)) issues.push(`Supprime ${name}.`);
  const mastered = masteredSkills(kit);
  for (const s of sentences) {
    // « maîtrise » accepté seulement si ce qui suit le mot (jusqu'à la virgule ou « en m'appuyant ») ne parle que de compétences maîtrisées.
    const m = MASTERY.exec(s);
    const after = m ? s.slice(m.index + m[0].length).split(/[,;.:]|\s(?:en m['’]appuyant|grâce|gr[aâ]ce à|avec|et j['’]ai|car)\s/i)[0] ?? "" : "";
    const claimed = extractSkills(after, extraSkills);
    const masteryOk = mastered.size > 0 && claimed.length > 0 && claimed.every((id) => mastered.has(id));
    if (MASTERY.test(s) && !masteryOk) issues.push(`Pas de « maîtrise » ni « expert » (seulement pour ce que tu as déclaré maîtriser) : « ${s.slice(0, 90)}… » → « j'ai utilisé / j'ai développé ».`);
    const absent = extractSkills(s, extraSkills).filter((id) => !inCv.has(id));
    // « je souhaite approfondir X en m'appuyant sur Y » : la seule façon permise de parler d'un manque.
    if (absent.length && KNOWS.test(s) && !/pas encore|jamais (?:utilis|travaill|pratiqu)|n['’]ai pas|approfondir [^.]{2,80} en m['’]appuyant sur/i.test(s)) {
      issues.push(`${absent.map(label).join(", ")} n'est pas dans le CV : ne prétends pas le connaître (« ${s.slice(0, 90)}… »). Une seule phrase franche : pas encore utilisé, envie de s'y former.`);
    }
    const words = s.split(/\s+/).length;
    if (words > 38) issues.push(`Phrase trop longue (${words} mots) à couper : « ${s.slice(0, 70)}… ».`);
  }
  for (const m of body.matchAll(/(?:apprendre|découvrir|me former (?:à|sur))\s+(?:le |la |l'|les )?([^.,;\n]{2,60})/gi)) {
    for (const id of extractSkills(m[1]!, extraSkills)) if (inCv.has(id)) issues.push(`${label(id)} est dans le CV : ne dis pas vouloir l'apprendre, dis qu'il l'a pratiqué.`);
  }
  const offIds = offTopicSkills(body, inCv, inJob, extraSkills);
  const offTopic = offIds.map(label);
  if (familiesOf(offIds) >= 2) issues.push(`Retire ${offTopic.join(", ")} : sans rapport avec l'annonce, ça fait récitation du CV.`);
  // Débuts de phrase répétitifs (« J'ai … J'ai … J'ai … »).
  let run = 0;
  for (const s of sentences) {
    run = /^j['’]ai\b/i.test(s) ? run + 1 : 0;
    if (run === 3) {
      issues.push("Trois phrases de suite commencent par « J'ai » : varie les débuts (« Chez [entreprise], … », « Sur le projet [nom], … »).");
      break;
    }
  }
  // Même compétence citée plus de deux fois.
  const counts = new Map<string, number>();
  for (const s of sentences) for (const id of extractSkills(s, extraSkills)) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 2 && !inJob.has(id)) issues.push(`${label(id)} est cité ${n} fois : une ou deux suffisent.`);
  // Atouts vérifiés oubliés (dans l'annonce ET dans le CV) : la lettre doit s'en servir.
  const { strengths } = strengthsAndGaps(jobText, kit.cvText, masteredLabels(kit));
  const used = new Set(extractSkills(body, extraSkills));
  const forgotten = strengths.slice(0, 5).filter((x) => !used.has(x.id)).map((x) => `${x.skill} (CV : « ${x.proof.slice(0, 80)} »)`);
  if (forgotten.length >= 2) issues.push(`Atouts demandés par l'annonce et prouvés par le CV mais absents de la lettre : ${forgotten.slice(0, 3).join(" ; ")}.`);
  // Technologie du CV attribuée au mauvais projet / à la mauvaise entreprise (ex. « microservices … projet salles »).
  const entities = cvEntities(kit.cvText, extraSkills);
  // Découpage en propositions (« …PostgreSQL et j'ai utilisé SQL sur Agenda Santé » = deux faits distincts).
  const clauses = sentences.flatMap((x) => x.split(/;|\s(?:et|puis|mais)\s+(?=j['’]|je\s|nous\s)/i));
  for (const s of clauses) {
    const named = entities.filter((e) => s.toLowerCase().includes(e.name.toLowerCase()));
    if (!named.length) continue;
    const wrong = extractSkills(s, extraSkills).filter((id) => inCv.has(id) && !named.some((e) => e.skills.has(id)));
    if (wrong.length) {
      issues.push(`${wrong.map(label).join(", ")} n'est pas écrit pour ${named.map((e) => e.name).join(" / ")} dans le CV : ne l'y associe pas (« ${s.slice(0, 90)}… »).`);
    }
  }
  if (opts.spontaneous && /votre (offre|annonce)|l['’](offre|annonce)|le poste que vous (proposez|recherchez)/i.test(body)) {
    issues.push("Candidature spontanée : il n'y a pas d'offre, n'écris pas « votre offre » ; parle de l'envie de rejoindre l'entreprise.");
  }
  // Manques listés : au plus un.
  const title = jobText.split("\n")[0] ?? "";
  const inTitle = new Set(extractSkills(title, extraSkills));
  const gapsCited = [...new Set(extractSkills(body, extraSkills))].filter((id) => !inCv.has(id) && inJob.has(id) && !inTitle.has(id));
  if (gapsCited.length >= 2) issues.push(`Ne liste pas tes manques (${gapsCited.map(label).join(", ")}) : au plus un, seulement s'il est central dans l'annonce.`);
  // Chiffres inventés.
  const sources = `${kit.cvText}\n${kit.rules ?? ""}\n${jobText}\n${kit.closing ?? ""}`;
  // On ignore les versions (« Vue 3 », « .NET 8 », « OAuth2 ») et les dates.
  const numbersText = body.replace(/\p{Lu}[\p{L}.#+]*\s?\d+(?:\.\d+)*/gu, " ").replace(/[\p{L}]\d+/gu, " ").replace(/\d+(?:[/.]\d+)+/g, " ");
  for (const n of new Set(numbersText.match(/\d+/g) ?? [])) {
    if (!new RegExp(`(^|\\D)${n}(\\D|$)`).test(sources)) issues.push(`Le chiffre « ${n} » n'est ni dans le CV ni dans l'annonce : supprime-le.`);
  }
  // Phrases recopiées de l'annonce.
  for (const s of copiedFromJob(body, jobText.split("\n").slice(1).join("\n"), title).slice(0, 2)) {
    issues.push(`Phrase recopiée de l'annonce : dis-le avec tes mots (« ${s}… »).`);
  }
  // La dernière entreprise doit être nommée.
  const employers = entities.filter((e) => e.kind === "entreprise");
  if (employers.length && !employers.some((e) => body.toLowerCase().includes(e.name.toLowerCase()))) {
    issues.push(`Nomme l'entreprise (${employers.map((e) => e.name).join(", ")}) : « une expérience » seule ne dit rien.`);
  }
  const jai = body.match(/(?<![\p{L}])j['’]ai(?![\p{L}])/giu)?.length ?? 0;
  // 5 pour une lettre courte, environ un par phrase sur trois au-delà (lettre de 330 mots → 10).
  const maxJai = Math.max(5, Math.round(body.split(/\s+/).length / 33));
  if (jai > maxJai) issues.push(`« J'ai » revient ${jai} fois : ${maxJai} au maximum. Varie (« Chez [entreprise], je travaillais… », « Sur le projet [nom], le travail consistait à… »).`);
  for (const w of ONCE) {
    const n = body.match(new RegExp(word(w).source, "giu"))?.length ?? 0;
    if (n > 1) issues.push(`Supprime un « ${w} » : ${n} fois, une seule suffit.`);
  }
  const connectors = body.match(/\b(De plus|Parall[èe]lement|En outre|Par ailleurs)\b/g) ?? [];
  if (connectors.length > 1) issues.push("Trop de connecteurs (« De plus », « Parallèlement »…) : un seul maximum.");
  // Les erreurs de vérité d'abord (la liste est coupée à 10).
  const truth = (i: string) => (/n'est pas (écrit pour|dans le CV)|maîtrise|Nomme l'entreprise|chiffre|manques/.test(i) ? 0 : 1);
  return [...new Set(issues)].sort((x, y) => truth(x) - truth(y)).slice(0, 10);
}

/** Écrit la lettre avec l'IA. Une réponse hors format est redemandée une fois. */
/** Remplace la conclusion écrite par l'IA par le dernier paragraphe fixe du candidat (s'il en a un). */
export function withClosing(draft: LetterBody, kit: Pick<LetterKit, "closing">, company: string | null | undefined): LetterBody {
  const closing = closingParagraph(kit, company);
  if (!closing) return draft;
  const paragraphes = [...draft.paragraphes];
  const conclusion = /(échanger|entretien|rencontr|disponib|à votre disposition|vous présenter)/i;
  while (paragraphes.length > 2 && conclusion.test(paragraphes[paragraphes.length - 1]!) && paragraphes[paragraphes.length - 1]!.length < 400) paragraphes.pop();
  return { ...draft, paragraphes: [...paragraphes, closing] };
}

export async function writeCoverLetter(
  client: Pick<OllamaClient, "chatJson" | "model">,
  job: AnalysisJobInput,
  kit: LetterKit,
  now: Date = new Date(),
  opts: LetterOptions = {},
): Promise<{ content: string; model: string; durationMs: number }> {
  const started = Date.now();
  const prompt = buildLetterPrompt(job, kit, opts);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await client.chatJson(LETTER_SYSTEM_PROMPT, prompt, LETTER_JSON_SCHEMA, { temperature: 0.5 });
    const parsed = LetterDraftSchema.safeParse(raw);
    if (parsed.success) {
      let draft = cleanDraft(parsed.data, kit.signature);
      if (draft.paragraphes.length >= 2) {
        // Relecture : si la lettre enfreint des règles, on la fait corriger une fois, avec la liste précise.
        const jobText = `${job.title}\n${job.description}`;
        const issues = findLetterIssues(`${draft.objet}\n${draft.paragraphes.join("\n")}`, kit, jobText, opts);
        if (issues.length) {
          const fix = `${prompt}

PREMIÈRE VERSION DE LA LETTRE (à corriger)
"""
${draft.paragraphes.join("\n\n")}
"""

PROBLÈMES À CORRIGER (réécris toute la lettre en les corrigeant, sans en créer d'autres) :
${issues.map((i) => `- ${i}`).join("\n")}

RELECTURE HUMAINE (en réécrivant) : garde tous les faits vrais, supprime les phrases qui n'en contiennent pas, ne répète pas une idée déjà dite, ne rajoute aucun détail absent du CV. Relis chaque phrase : une vraie personne la dirait-elle à voix haute à un recruteur ? Sinon, réécris-la simplement.`;
          const second = LetterDraftSchema.safeParse(
            await client.chatJson(LETTER_SYSTEM_PROMPT, fix, LETTER_JSON_SCHEMA, { temperature: 0.3 }).catch(() => null),
          );
          if (second.success) {
            const fixed = cleanDraft(second.data, kit.signature);
            if (fixed.paragraphes.length >= 2) draft = fixed;
          }
        }
        draft = withClosing(draft, kit, job.company);
        if (opts.spontaneous) draft = { ...draft, objet: `Candidature spontanée – ${job.title}` };
        return { content: fixTypos(assembleLetter(kit, draft, now)), model: client.model, durationMs: Date.now() - started };
      }
      lastError = "lettre trop courte";
    } else {
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ");
    }
  }
  throw new Error(`Réponse de l'IA hors format : ${lastError}`);
}
