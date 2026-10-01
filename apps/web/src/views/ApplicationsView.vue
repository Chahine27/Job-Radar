<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { timeAgo } from "../format";
import { usePrefs } from "../prefs";
import type { Application, JobStatus } from "../types";

/** Au-delà, pas de nouvelles : un petit rappel pour relancer. */
const FOLLOW_UP_DAYS = 10;

const items = ref<Application[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const tab = toRef(usePrefs<{ tab: "waiting" | "rejected" }>("candidatures", { tab: "waiting" }), "tab");
const busy = ref<string | null>(null);

async function load() {
  try {
    items.value = (await api.listApplications()).items;
  } catch {
    error.value = "Impossible de charger tes candidatures.";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const waiting = computed(() => items.value.filter((j) => j.status === "APPLIED"));
const rejected = computed(() => items.value.filter((j) => j.status === "REJECTED"));
const shown = computed(() => (tab.value === "waiting" ? waiting.value : rejected.value));

const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
const needsFollowUp = (j: Application) => j.status === "APPLIED" && (daysSince(j.appliedAt) ?? 0) >= FOLLOW_UP_DAYS;

async function setStatus(j: Application, status: JobStatus) {
  busy.value = j.id;
  try {
    await api.setJobStatus(j.id, status);
    await load();
  } finally {
    busy.value = null;
  }
}

const place = (j: Application) =>
  [j.city, j.department && !j.city?.includes(j.department) ? `(${j.department})` : null].filter(Boolean).join(" ");
</script>

<template>
  <PageHeader title="Candidatures" subtitle="Les offres où tu as postulé. Elles n'apparaissent plus dans « Offres » pour ne pas t'encombrer." />

  <div class="stack">
    <div class="tabs" role="tablist" aria-label="Candidatures">
      <button type="button" role="tab" :aria-selected="tab === 'waiting'" :class="{ active: tab === 'waiting' }" @click="tab = 'waiting'">
        En attente de réponse <span class="count">{{ waiting.length }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'rejected'" :class="{ active: tab === 'rejected' }" @click="tab = 'rejected'">
        Refusées <span class="count">{{ rejected.length }}</span>
      </button>
    </div>

    <p v-if="error" class="alert"><Icon name="alert" :size="16" />{{ error }}</p>
    <template v-if="loading"><div v-for="n in 3" :key="n" class="skeleton" /></template>

    <div v-else-if="shown.length === 0" class="empty">
      <Icon name="send" :size="40" />
      <strong>{{ tab === "waiting" ? "Aucune candidature en attente" : "Aucun refus" }}</strong>
      <span v-if="tab === 'waiting'" class="small">Sur la page d'une offre, clique sur « Marquer comme postulé » : elle arrivera ici.</span>
    </div>

    <article v-for="j in shown" :key="j.id" class="card app">
      <ScoreBadge :value="j.score.final" />
      <div class="body">
        <div class="top">
          <RouterLink :to="{ name: 'job', params: { id: j.id } }" class="title">{{ j.title }}</RouterLink>
          <div class="origin"><SourceLogo v-for="s in j.sources" :key="s.source" :source="s.source" :size="24" /></div>
        </div>
        <div class="company muted small">
          <span><Icon name="building" :size="14" />{{ j.company ?? "Entreprise non précisée" }}</span>
          <span><Icon name="pin" :size="14" />{{ place(j) || "Lieu non précisé" }}</span>
          <span v-if="j.appliedAt"><Icon name="send" :size="14" />Postulé {{ timeAgo(j.appliedAt) }}</span>
        </div>
        <p v-if="needsFollowUp(j)" class="follow small">
          <Icon name="clock" :size="14" /> Pas de réponse depuis {{ daysSince(j.appliedAt) }} jours : c'est le bon moment pour relancer le recruteur.
        </p>
        <div class="row actions">
          <RouterLink :to="{ name: 'job', params: { id: j.id } }" class="btn small"><Icon name="eye" :size="14" />Voir l'offre</RouterLink>
          <template v-if="j.status === 'APPLIED'">
            <button type="button" class="small danger" :disabled="busy === j.id" @click="setStatus(j, 'REJECTED')"><Icon name="eyeOff" :size="14" />Refus reçu</button>
            <button type="button" class="small ghost" :disabled="busy === j.id" title="Tu n'as finalement pas postulé : l'offre revient dans « Offres »" @click="setStatus(j, 'SAVED')">
              <Icon name="undo" :size="14" />Je n'ai pas postulé
            </button>
          </template>
          <button v-else type="button" class="small ghost" :disabled="busy === j.id" @click="setStatus(j, 'APPLIED')"><Icon name="undo" :size="14" />Remettre en attente</button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.tabs button { border-radius: 99px; }
.tabs button.active { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.count { display: inline-grid; place-items: center; min-width: 1.4rem; padding: 0 0.35rem; margin-left: 0.3rem; border-radius: 99px; background: var(--surface-2, var(--border)); font-size: 0.75rem; }
.app { display: flex; gap: 1rem; align-items: flex-start; }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.45rem; }
.top { display: flex; justify-content: space-between; gap: 0.8rem; align-items: flex-start; }
.title { font-weight: 650; color: var(--text); }
.title:hover { color: var(--accent); }
.origin { display: flex; gap: 0.3rem; flex-shrink: 0; }
.company { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; }
.company span { display: inline-flex; align-items: center; gap: 0.35rem; }
.follow { display: flex; align-items: center; gap: 0.4rem; margin: 0; padding: 0.45rem 0.7rem; border-radius: 8px; background: var(--mid-bg); color: var(--text); }
.actions { gap: 0.4rem; }
</style>
