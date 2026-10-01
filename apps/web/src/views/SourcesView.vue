<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { timeAgo, timeUntil } from "../format";
import type { SourceItem } from "../types";

const sources = ref<SourceItem[]>([]);
const drafts = ref<Record<string, number>>({});
const message = ref<{ ok: boolean; text: string } | null>(null);
const busy = ref(false);

const HELP: Record<string, string> = {
  "france-travail": "Identifiants à ajouter dans Réglages (gratuit).",
  adzuna: "Clé gratuite à ajouter dans Réglages. Quota : 250 appels par jour.",
  jooble: "Clé gratuite à ajouter dans Réglages. Une collecte par jour au plus.",
};

async function load() {
  const s = await api.listSources();
  sources.value = s.items;
  drafts.value = Object.fromEntries(s.items.map((i) => [i.source, i.intervalMinutes]));
}
onMounted(load);

async function act(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  message.value = null;
  try {
    await fn();
    message.value = { ok: true, text: ok };
    await load();
  } catch (e) {
    message.value = { ok: false, text: e instanceof ApiError ? e.message : "Erreur inattendue." };
  } finally {
    busy.value = false;
  }
}

function saveSource(s: SourceItem, enabled = s.enabled) {
  const interval = Math.max(Number(drafts.value[s.source]) || s.minIntervalMinutes, s.minIntervalMinutes);
  return act(() => api.updateSource(s.source, { enabled, intervalMinutes: interval }), `${s.label} : réglage enregistré.`);
}


function quotaTone(q: { used: number; limit: number }) {
  const ratio = q.used / q.limit;
  return ratio < 0.6 ? "good" : ratio < 0.9 ? "mid" : "low";
}

function statusTone(s: SourceItem) {
  const t = statusText(s);
  return t === "OK" ? "good" : t === "erreur" ? "bad" : "";
}

function statusText(s: SourceItem) {
  if (!s.configured) return "non configurée";
  if (!s.lastStatus) return "jamais lancée";
  if (s.lastStatus === "OK") return "OK";
  if (s.lastStatus === "SOURCE_UNAVAILABLE") return "non configurée";
  return "erreur";
}
</script>

<template>
  <PageHeader title="Sources" subtitle="D'où viennent les offres. Chaque source a sa fréquence, qui respecte ses limites." />

  <div class="stack">
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>

    <div class="sources">
      <section v-for="s in sources" :key="s.source" class="card stack source" :class="{ off: !s.enabled }">
        <div class="src-head">
          <SourceLogo :source="s.source" :size="40" />
          <div>
            <h2 style="margin: 0">{{ s.label }}</h2>
            <span class="muted small">{{ HELP[s.source] }}</span>
          </div>
          <span class="chip" :class="statusTone(s)"><span class="dot" :class="statusTone(s)" />{{ statusText(s) }}</span>
        </div>

        <div class="settings">
          <label class="switch">
            <input type="checkbox" :checked="s.enabled" :disabled="busy" @change="saveSource(s, !s.enabled)" /> Active
          </label>
          <label class="inline">
            Toutes les
            <input v-model.number="drafts[s.source]" type="number" :min="s.minIntervalMinutes" max="1440" style="width: 5.5rem" />
            min
          </label>
          <button type="button" class="small" :disabled="busy" @click="saveSource(s)"><Icon name="save" :size="14" />Enregistrer</button>
          <span class="muted small">minimum {{ s.minIntervalMinutes }} min</span>
        </div>

        <div class="stats small">
          <span><Icon name="check" :size="14" />Dernière réussite : <strong>{{ s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : "jamais" }}</strong></span>
          <span v-if="s.enabled"><Icon name="clock" :size="14" />Prochaine : <strong>{{ timeUntil(s.nextRunAt) }}</strong></span>
          <span v-if="s.failures" style="color: var(--low)"><Icon name="alert" :size="14" />{{ s.failures }} échec(s) de suite</span>
        </div>
        <div v-if="s.quota" class="quota">
          <div class="spread small">
            <span>Appels utilisés (la clé gratuite en donne {{ s.quota.limit }} au total, pas par jour)</span>
            <strong class="num">{{ s.quota.used }} / {{ s.quota.limit }}</strong>
          </div>
          <div class="bar"><div :class="quotaTone(s.quota)" :style="{ width: `${Math.min(100, (s.quota.used / s.quota.limit) * 100)}%` }" /></div>
        </div>
        <p v-if="s.lastError && s.lastStatus !== 'OK'" class="alert small"><Icon name="alert" :size="15" />{{ s.lastError }}</p>
        <p v-if="s.source === 'adzuna'" class="muted small" style="margin: 0">
          Offres fournies par <a href="https://www.adzuna.fr" target="_blank" rel="noopener noreferrer">Jobs by Adzuna</a>. Les salaires
          « estimés » par Adzuna sont ignorés.
        </p>

      </section>
    </div>
  </div>
</template>

<style scoped>
.sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1rem; }
.source.off { opacity: 0.75; }
.src-head { display: grid; grid-template-columns: auto 1fr auto; gap: 0.8rem; align-items: start; }
.settings { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1.1rem; padding: 0.75rem 0.9rem; background: var(--surface-2); border-radius: var(--radius-sm); }
.stats { display: flex; flex-wrap: wrap; gap: 0.35rem 1.2rem; color: var(--muted); }
.stats span { display: inline-flex; align-items: center; gap: 0.35rem; }
.stats strong { color: var(--text); font-weight: 600; }
.quota { display: grid; gap: 0.4rem; color: var(--muted); }
.quota strong { color: var(--text); }
@media (max-width: 600px) { .sources { grid-template-columns: 1fr; } }
</style>
