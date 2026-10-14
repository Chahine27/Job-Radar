<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, errorMessage } from "../api";
import { timeAgo } from "../format";
import type { SourceItem } from "../types";
import Icon from "./Icon.vue";
import SourceLogo from "./SourceLogo.vue";

/** Page Réglages : relance une source à la main (utile si elle est en erreur), sans changer son rythme de collecte. */
const sources = ref<SourceItem[]>([]);
/** Sources relancées : heure du clic. Terminé quand la source a une collecte plus récente. */
const pending = ref<Record<string, number>>({});
const message = ref<{ ok: boolean; text: string } | null>(null);

async function load() {
  sources.value = (await api.listSources()).items;
  for (const s of sources.value) {
    const since = pending.value[s.source];
    if (since === undefined || !s.lastRunAt || new Date(s.lastRunAt).getTime() < since) continue;
    delete pending.value[s.source];
    message.value =
      s.lastStatus === "OK" ? { ok: true, text: `${s.label} : collecte réussie.` } : { ok: false, text: `${s.label} : échec (détail ci-dessous).` };
  }
}
onMounted(() => load().catch(() => {}));
// Pendant qu'une relance est en cours : état rechargé toutes les 4 s.
const timer = setInterval(() => void (Object.keys(pending.value).length && load().catch(() => {})), 4000);
onUnmounted(() => clearInterval(timer));

async function relaunch(s: SourceItem) {
  message.value = null;
  const clickedAt = Date.now();
  try {
    const res = await api.refreshSource(s.source);
    if (res.status === "already_running") {
      message.value = { ok: false, text: `${s.label} : une collecte est déjà en cours, réessaie dans un moment.` };
      return;
    }
    pending.value[s.source] = clickedAt;
  } catch (e) {
    message.value = { ok: false, text: `${s.label} : ${errorMessage(e, "erreur inattendue.")}` };
  }
}

function status(s: SourceItem): { text: string; tone: string } {
  if (!s.enabled) return { text: "inactive", tone: "" };
  if (!s.configured) return { text: "non configurée", tone: "" };
  if (!s.lastStatus) return { text: "jamais lancée", tone: "" };
  return s.lastStatus === "OK" ? { text: "OK", tone: "good" } : { text: "erreur", tone: "bad" };
}

/** Début de l'erreur : le détail complet reste dans l'infobulle et sur la page Sources. */
const shortError = (e: string) => (e.length > 220 ? `${e.slice(0, 220)}…` : e);
</script>

<template>
  <section class="card stack">
    <h2 style="margin: 0"><Icon name="refresh" :size="17" />Relancer une source</h2>
    <p class="muted small" style="margin: 0">Une source en erreur ? Relance-la ici sans attendre sa prochaine collecte (son rythme ne change pas).</p>
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>
    <ul class="rows">
      <li v-for="s in sources" :key="s.source">
        <SourceLogo :source="s.source" :size="32" />
        <div class="info">
          <strong>{{ s.label }}</strong>
          <span class="muted small">
            <template v-if="!s.enabled">inactive (page Sources)</template>
            <template v-else>dernière réussite {{ s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : "jamais" }}<template v-if="s.failures"> · {{ s.failures }} échec(s) de suite</template></template>
          </span>
          <span v-if="s.enabled && s.lastStatus && s.lastStatus !== 'OK'" class="err small" :title="s.lastError ?? ''">{{ shortError(s.lastError ?? "erreur") }}</span>
        </div>
        <span class="chip" :class="status(s).tone">{{ status(s).text }}</span>
        <button type="button" class="small" :disabled="!s.enabled || s.source in pending" @click="relaunch(s)">
          <Icon name="refresh" :size="14" />{{ s.source in pending ? "En cours…" : "Relancer" }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.rows { list-style: none; margin: 0; padding: 0; display: grid; }
.rows li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.8rem; align-items: center; padding: 0.75rem 0; border-top: 1px solid var(--border); }
.rows li:first-child { border-top: none; }
.info { display: grid; gap: 0.15rem; min-width: 0; }
.err { color: var(--low); overflow-wrap: anywhere; }
@media (max-width: 600px) { .rows li { grid-template-columns: auto 1fr; } }
</style>
