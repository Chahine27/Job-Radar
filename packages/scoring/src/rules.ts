/**
 * Règles du score. Toute modification qui change un résultat DOIT changer `version`
 * (les scores déjà calculés seront alors recalculés, et les tests figés mis à jour).
 */
export type ScoringRules = {
  version: string;
  /** Sous-score donné quand l'information est absente (salaire, trajet...). */
  neutral: number;
  /** Départements à compter comme « proches » en plus des voisins des zones du profil (calculés tout seuls). */
  nearbyDepartments: string[];
  /** Masquer du flux principal les contrats hors profil (ils restent en base). */
  hideNonMatchingContract: boolean;
  /** Masquer au-delà de N années demandées (null = jamais masquer, seulement pénaliser). */
  hideAboveYears: number | null;
  /** Masquer les postes senior / confirmé / lead (lu dans le titre). */
  hideSenior: boolean;
  /**
   * Critères bloquants (contrat, expérience, lieu/trajet) : si un sous-score tombe à `atOrBelow` ou moins, le score final est plafonné à `cap`.
   * Évite qu'une offre « parfaite sauf 7 ans d'expérience » dépasse le seuil de notification.
   */
  caps: Array<{ part: CapPart; atOrBelow: number; cap: number; label: string }>;
  /**
   * Les compétences tiennent le reste : le score final ne dépasse jamais « note compétences + N points ».
   * Pas appliqué quand aucune compétence n'est reconnue (information inconnue ≠ inadéquation).
   */
  technicalMargin: number | null;
};

export type CapPart = "technical" | "experience" | "contract" | "salary" | "location" | "transport";

export const DEFAULT_RULES: ScoringRules = {
  version: "2026-10-01.2",
  neutral: 60,
  nearbyDepartments: [],
  hideNonMatchingContract: true,
  hideAboveYears: 4,
  hideSenior: true,
  caps: [
    { part: "experience", atOrBelow: 15, cap: 35, label: "expérience très au-dessus de ta cible" },
    { part: "experience", atOrBelow: 35, cap: 55, label: "expérience au-dessus de ta cible" },
    { part: "contract", atOrBelow: 10, cap: 40, label: "contrat hors profil" },
    { part: "location", atOrBelow: 15, cap: 50, label: "hors de ta zone" },
    { part: "transport", atOrBelow: 20, cap: 60, label: "trajet trop long" },
  ],
  technicalMargin: 25,
};
