import { reactive, watch } from "vue";
import { api } from "./api";

type Plain = string | number | boolean | null;

/** Toutes les préférences, chargées une seule fois depuis le serveur pour toutes les pages. */
let server: Promise<Record<string, Record<string, unknown>>> | null = null;
function serverPrefs() {
  server ??= api.getPrefs().catch(() => {
    server = null; // serveur injoignable : on réessaiera à la prochaine page
    return {};
  });
  return server;
}

/** Garde seulement les réglages connus, du bon type (une vieille préférence ne casse rien). */
function pick<T extends Record<string, Plain>>(defaults: T, src: unknown): Partial<T> {
  if (!src || typeof src !== "object") return {};
  const out: Partial<T> = {};
  for (const [k, def] of Object.entries(defaults) as Array<[keyof T, Plain]>) {
    const v = (src as Record<string, unknown>)[k as string];
    if (v !== undefined && (def === null || v === null || typeof v === typeof def)) out[k] = v as T[keyof T];
  }
  return out;
}

const cacheKey = (page: string) => `jobradar.prefs.${page}`;

/**
 * Filtres d'une page retenus comme préférences : enregistrés sur le serveur (retrouvés après un rechargement,
 * dans n'importe quel navigateur) et en copie locale pour s'afficher tout de suite.
 * `legacyKey` : ancienne clé locale, reprise une fois.
 */
export function usePrefs<T extends Record<string, Plain>>(page: string, defaults: T, opts: { legacyKey?: string } = {}): T {
  const read = (key: string) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  };
  const local = read(cacheKey(page)) ?? (opts.legacyKey ? read(opts.legacyKey) : null);
  const state = reactive({ ...defaults, ...pick(defaults, local) }) as T;
  let saved = "";
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function push(json: string) {
    saved = json;
    void api
      .savePrefs(page, JSON.parse(json))
      .then(() => serverPrefs().then((all) => (all[page] = JSON.parse(json)))) // les pages ouvertes ensuite voient la valeur
      .catch(() => (saved = "")); // échec : on renverra au prochain changement
  }

  void serverPrefs().then((all) => {
    const fromServer = pick(defaults, all[page]);
    if (Object.keys(fromServer).length) {
      Object.assign(state, fromServer);
      saved = JSON.stringify({ ...defaults, ...fromServer });
    } else if (JSON.stringify(state) !== JSON.stringify(defaults)) {
      push(JSON.stringify(state)); // réglages gardés seulement dans ce navigateur : envoyés au serveur
    }
    ready = true;
  });

  watch(
    () => JSON.stringify(state),
    (json) => {
      try {
        localStorage.setItem(cacheKey(page), json);
      } catch {
        /* stockage local indisponible : le serveur suffit */
      }
      if (!ready || json === saved) return;
      clearTimeout(timer);
      timer = setTimeout(() => push(json), 500);
    },
  );
  return state;
}
