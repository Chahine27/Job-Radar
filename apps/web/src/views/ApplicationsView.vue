<script setup lang="ts">
import { computed, onActivated, ref, toRef } from "vue";
import { api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { mapsUrl, place, timeAgo } from "../format";
import { usePrefs } from "../prefs";
import type { Application, JobStatus, SentSpontaneous } from "../types";

/** Au-delà, pas de nouvelles : un petit rappel pour relancer. */
const FOLLOW_UP_DAYS = 10;

const items = ref<Application[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const prefs = usePrefs<{ tab: "waiting" | "rejected"; kind: "offers" | "spontaneous" }>("candidatures", { tab: "waiting", kind: "offers" });
const tab = toRef(prefs, "tab");
/** « Sur une offre » ou « Spontanées » (candidatures envoyées depuis la page Entreprises). */
const kind = toRef(prefs, "kind");
const spontaneous = ref<SentSpontaneous[]>([]);
const busy = ref<string | null>(null);

async function load() {
  try {
    const [offers, sent] = await Promise.all([api.listApplications(), api.listSpontaneous()]);
    items.value = offers.items;
    spontaneous.value = sent.items;
  } catch {
    error.value = "Impossible de charger tes candidatures.";
  } finally {
    loading.value = false;
  }
}
onActivated(load); // aussi au retour depuis une offre

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

const leadPlace = (s: SentSpontaneous) => [s.lead.postcode, s.lead.city].filter(Boolean).join(" ");
const day = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
</script>

<template>
  <PageHeader title="Candidatures" subtitle="Les offres où tu as postulé. Elles n'apparaissent plus dans « Offres » pour ne pas t'encombrer." />

  <div class="stack">
    <div class="tabs" role="tablist" aria-label="Type de candidature">
      <button type="button" role="tab" :aria-selected="kind === 'offers'" :class="{ active: kind === 'offers' }" @click="kind = 'offers'">
        Sur une offre <span class="count">{{ items.length }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="kind === 'spontaneous'" :class="{ active: kind === 'spontaneous' }" @click="kind = 'spontaneous'">
        Spontanées <span class="count">{{ spontaneous.length }}</span>
      </button>
    </div>

    <template v-if="kind === 'spontaneous'">
      <template v-if="loading"><div v-for="n in 3" :key="n" class="skeleton" /></template>
      <div v-else-if="spontaneous.length === 0" class="empty">
        <Icon name="building" :size="40" />
        <strong>Aucune candidature spontanée envoyée</strong>
        <span class="small">Page « Entreprises » → « Préparer la candidature » : une fois envoyée, elle arrive ici.</span>
      </div>
      <article v-for="s in spontaneous" :key="s.leadId" class="card app">
        <div class="body">
          <RouterLink :to="{ name: 'spontaneous', params: { id: s.leadId } }" class="title">{{ s.lead.name }}</RouterLink>
          <div class="company muted small">
            <span v-if="s.lead.nafLabel"><Icon name="briefcase" :size="14" />{{ s.lead.nafLabel }}</span>
            <span v-if="leadPlace(s)"><Icon name="pin" :size="14" /><a class="map" :href="mapsUrl(s.lead.name, leadPlace(s))" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">{{ leadPlace(s) }}</a></span>
            <span><Icon name="send" :size="14" />Envoyée le {{ day(s.sentAt) }}</span>
            <span v-if="s.sentTo"><Icon name="mail" :size="14" />{{ s.sentTo }}</span>
          </div>
          <p v-if="(daysSince(s.sentAt) ?? 0) >= FOLLOW_UP_DAYS && s.lead.status === 'CONTACTED'" class="follow small">
            <Icon name="clock" :size="14" /> Pas de nouvelles depuis {{ daysSince(s.sentAt) }} jours : c'est le bon moment pour relancer.
          </p>
          <div class="row actions">
            <RouterLink :to="{ name: 'spontaneous', params: { id: s.leadId } }" class="btn small"><Icon name="eye" :size="14" />Voir la candidature</RouterLink>
          </div>
        </div>
      </article>
    </template>

    <template v-else>
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
          <span><Icon name="pin" :size="14" /><a v-if="place(j)" class="map" :href="mapsUrl(j.company, place(j))" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">{{ place(j) }}</a><template v-else>Lieu non précisé</template></span>
          <span v-if="j.appliedAt" :title="timeAgo(j.appliedAt)"><Icon name="send" :size="14" />Postulé le {{ day(j.appliedAt) }}</span>
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
    </template>
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
