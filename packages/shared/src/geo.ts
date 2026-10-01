/**
 * Départements français : nom → code, et lecture d'un département dans un texte libre
 * (« Lille, Hauts-de-France », « Paris 9e », « 75009 Paris », « Remote - France »).
 * Rien de reconnu → null (on ne devine pas). "99" = étranger (code INSEE des pays étrangers).
 */

export const DEPARTMENTS: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude",
  "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente",
  "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
  "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme",
  "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers",
  "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire",
  "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
  "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère",
  "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne",
  "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
  "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
  "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
  "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
  "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
  "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée",
  "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
  "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
  "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte",
};

/** Grandes villes fréquentes dans les annonces (sans département écrit). Liste volontairement courte. */
const CITIES: Record<string, string> = {
  paris: "75", "la defense": "92", "boulogne-billancourt": "92", "issy-les-moulineaux": "92", nanterre: "92",
  "levallois-perret": "92", "neuilly-sur-seine": "92", courbevoie: "92", puteaux: "92", montrouge: "92",
  "saint-denis": "93", montreuil: "93", pantin: "93", "ivry-sur-seine": "94", creteil: "94", vincennes: "94",
  "saint-ouen": "93", "massy": "91", "saclay": "91", "evry": "91", versailles: "78", "velizy-villacoublay": "78",
  "saint-quentin-en-yvelines": "78", cergy: "95", argenteuil: "95", roissy: "95", "marne-la-vallee": "77",
  amiens: "80", beauvais: "60", "le havre": "76", caen: "14", "le mans": "72", angers: "49", brest: "29",
  dijon: "21", besancon: "25", metz: "57", nancy: "54", mulhouse: "68", limoges: "87", poitiers: "86",
  "clermont-ferrand": "63", "saint-etienne": "42", perpignan: "66", nimes: "30", avignon: "84", toulon: "83",
  pau: "64", bayonne: "64", "la rochelle": "17", annecy: "74", chambery: "73", valence: "26",
  lyon: "69", villeurbanne: "69", marseille: "13", "aix-en-provence": "13", lille: "59", roubaix: "59",
  toulouse: "31", bordeaux: "33", nantes: "44", rennes: "35", strasbourg: "67", montpellier: "34",
  nice: "06", "sophia antipolis": "06", grenoble: "38", rouen: "76", reims: "51", orleans: "45", tours: "37",
};

const FOREIGN = /\b(germany|allemagne|deutschland|berlin|munich|london|londres|united kingdom|royaume-uni|\buk\b|spain|espagne|madrid|barcelona|portugal|lisbon|lisbonne|italy|italie|milan|netherlands|pays-bas|amsterdam|belgium|belgique|bruxelles|brussels|switzerland|suisse|geneve|zurich|luxembourg|ireland|dublin|poland|pologne|warsaw|usa|united states|etats-unis|new york|san francisco|canada|montreal|toronto|india|singapore|morocco|maroc|tunisia|tunisie|casablanca)\b/;

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’']/g, "'").trim();
}

const NAME_TO_CODE = new Map(Object.entries(DEPARTMENTS).map(([code, name]) => [norm(name), code]));

export function departmentName(code: string): string | null {
  return DEPARTMENTS[code] ?? null;
}

export function departmentFromPostalCode(postalCode: string | null | undefined): string | null {
  const pc = postalCode?.trim();
  if (!pc || !/^\d{5}$/.test(pc)) return null;
  if (pc.startsWith("97")) return pc.slice(0, 3);
  if (pc.startsWith("20")) return Number(pc) < 20200 ? "2A" : "2B";
  return pc.slice(0, 2);
}

export function departmentFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = norm(text);
  const pc = t.match(/\b(\d{5})\b/)?.[1];
  if (pc) return departmentFromPostalCode(pc);
  const inParens = t.match(/\((\d{2,3}|2a|2b)\)/)?.[1];
  if (inParens) return inParens.toUpperCase();
  // « Paris 9e », « Paris 09 », « Paris 15e Arrondissement »
  if (/\bparis\b/.test(t)) return "75";
  const parts = t.split(/[,/|;·–-]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  for (const p of [t, ...parts]) {
    const byName = NAME_TO_CODE.get(p);
    if (byName) return byName;
    const byCity = CITIES[p];
    if (byCity) return byCity;
  }
  for (const [city, code] of Object.entries(CITIES)) {
    if (new RegExp(`(^|[^a-z])${city.replace(/[-]/g, "[- ]")}([^a-z]|$)`).test(t)) return code;
  }
  if (FOREIGN.test(t)) return "99";
  return null;
}

/** Départements limitrophes (métropole), pour la note « proche de ta zone ». */
const NEIGHBORS_RAW: Record<string, string> = {
  "01": "38 39 69 71 73 74", "02": "08 51 59 60 77 80", "03": "18 23 42 58 63 71", "04": "05 06 13 26 83 84",
  "05": "04 26 38 73", "06": "04 83", "07": "26 30 38 42 43 48 84", "08": "02 51 55", "09": "11 31 66",
  "10": "21 51 52 77 89", "11": "09 31 34 66 81", "12": "15 30 34 46 48 81 82", "13": "04 30 83 84",
  "14": "27 50 61", "15": "12 19 43 46 48 63", "16": "17 24 79 86 87", "17": "16 24 33 79 85",
  "18": "03 23 36 41 45 58", "19": "15 23 24 46 63 87", "2A": "2B", "2B": "2A", "21": "10 39 52 58 70 71 89",
  "22": "29 35 56", "23": "03 18 19 36 63 87", "24": "16 17 19 33 46 47 87", "25": "39 70 90",
  "26": "04 05 07 38 84", "27": "14 28 60 61 76 78 95", "28": "27 41 45 61 72 78 91", "29": "22 56",
  "30": "07 12 13 34 48 84", "31": "09 11 32 65 81 82", "32": "31 40 47 64 65 82", "33": "17 24 40 47",
  "34": "11 12 30 81", "35": "22 44 49 50 53 56", "36": "18 23 37 41 86 87", "37": "36 41 49 72 86",
  "38": "01 05 07 26 42 69 73", "39": "01 21 25 70 71", "40": "32 33 47 64", "41": "18 28 36 37 45 72",
  "42": "03 07 38 43 63 69 71", "43": "07 15 42 48 63", "44": "35 49 56 85", "45": "18 28 41 58 77 89 91",
  "46": "12 15 19 24 47 82", "47": "24 32 33 40 46 82", "48": "07 12 15 30 43", "49": "35 37 44 53 72 79 85 86",
  "50": "14 35 53 61", "51": "02 08 10 52 55 77", "52": "10 21 51 55 70 88", "53": "35 49 50 61 72",
  "54": "55 57 67 88", "55": "08 51 52 54 88", "56": "22 29 35 44", "57": "54 67", "58": "03 18 21 45 71 89",
  "59": "02 62 80", "60": "02 27 76 77 80 95", "61": "14 27 28 50 53 72", "62": "59 80", "63": "03 15 19 23 42 43",
  "64": "32 40 65", "65": "31 32 64", "66": "09 11", "67": "54 57 68 88", "68": "67 88 90", "69": "01 38 42 71",
  "70": "21 25 39 52 88 90", "71": "01 03 21 39 42 58 69", "72": "28 37 41 49 53 61", "73": "01 05 38 74",
  "74": "01 73", "75": "92 93 94", "76": "27 60 80", "77": "02 10 45 51 60 89 91 93 94 95",
  "78": "27 28 91 92 95", "79": "16 17 49 85 86", "80": "02 59 60 62 76", "81": "11 12 31 34 82",
  "82": "12 31 32 46 47 81", "83": "04 06 13 84", "84": "04 07 13 26 30 83", "85": "17 44 49 79",
  "86": "16 36 37 49 79 87", "87": "16 19 23 24 36 86", "88": "52 54 55 67 68 70 90", "89": "10 21 45 58 77",
  "90": "25 68 70 88", "91": "28 45 77 78 92 94", "92": "75 78 91 93 94 95", "93": "75 77 92 94 95",
  "94": "75 77 91 92 93", "95": "27 60 77 78 92 93",
};
export const DEPARTMENT_NEIGHBORS: Record<string, string[]> = Object.fromEntries(
  Object.entries(NEIGHBORS_RAW).map(([code, list]) => [code, list.split(" ")]),
);

/** Départements voisins d'un département (vide pour l'outre-mer). */
export function neighborDepartments(code: string): string[] {
  return DEPARTMENT_NEIGHBORS[code] ?? [];
}
