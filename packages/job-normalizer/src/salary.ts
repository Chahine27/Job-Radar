/**
 * Lit un libellé de salaire France Travail et le convertit en brut annuel.
 *   « Annuel de 38000.00 Euros à 42000.00 Euros sur 12 mois »
 *   « Mensuel de 2500,00 Euros sur 13 mois »
 *   « Horaire de 11.88 Euros »
 * Libellé absent ou incompréhensible → null (jamais deviné).
 */
export type AnnualSalary = { min: number; max: number };

const HOURS_PER_MONTH = 151.67; // durée légale : 35 h/semaine

export function parseFtSalary(label: string | null | undefined): AnnualSalary | null {
  if (!label) return null;
  const text = label.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const period = /annuel/.test(text) ? "year" : /mensuel/.test(text) ? "month" : /horaire/.test(text) ? "hour" : null;
  if (!period) return null;

  const amounts = [...text.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)\s*euros?/g)]
    .map((m) => Number(m[1]!.replace(/\s/g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length === 0) return null;

  const monthsMatch = text.match(/sur\s+(\d+(?:[.,]\d+)?)\s*mois/);
  const months = monthsMatch ? Number(monthsMatch[1]!.replace(",", ".")) : 12;

  const toYear = (n: number) => {
    if (period === "year") return n;
    if (period === "month") return n * months;
    return n * HOURS_PER_MONTH * months;
  };
  const values = amounts.slice(0, 2).map((n) => Math.round(toYear(n)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Garde-fou : un « annuel » à 3 000 € est une erreur de saisie → on ne l'utilise pas.
  if (min < 8000 || max > 500_000) return null;
  return { min, max };
}

/**
 * Salaire en texte libre (Jooble…) : « 35 000 € - 45 000 € par an », « 38k € - 42k € », « 2 800 € par mois ».
 * Période inconnue : gardé seulement si le montant ressemble à un salaire annuel (≥ 8 000).
 * Taux journalier / horaire, autre devise ou texte incompréhensible → null (jamais deviné).
 */
export function parseLooseSalary(label: string | null | undefined): AnnualSalary | null {
  if (!label) return null;
  const text = label.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ | /g, " ");
  if (/\$|£|usd|gbp|chf/.test(text)) return null;
  if (/jour|day|heure|hour|horaire|\/h\b/.test(text)) return null;
  const amounts = [...text.matchAll(/(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?)\s*(k)?/g)]
    .map((m) => {
      const n = Number(m[1]!.replace(/[ .](?=\d{3}\b)/g, "").replace(",", "."));
      return m[2] ? n * 1000 : n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length === 0) return null;
  const factor = /mois|mensuel|month/.test(text) ? 12 : 1;
  const values = amounts.slice(0, 2).map((n) => Math.round(n * factor));
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min < 8000 || max > 500_000) return null;
  return { min, max };
}
