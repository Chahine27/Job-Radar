<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
import SourceRelaunchCard from "../components/SourceRelaunchCard.vue";
import { SETTING_CARDS, type SettingCard, initialDrafts, pendingChanges } from "../settings-guide";
import type { SettingsState } from "../types";

const state = ref<SettingsState | null>(null);
const loadError = ref("");
const drafts = reactive<Record<string, Record<string, string>>>({});
const busy = reactive<Record<string, "save" | "test" | null>>({});
const results = reactive<Record<string, { ok: boolean; text: string } | null>>({});
const openSteps = reactive<Record<string, boolean>>({});

function resetDrafts(card: SettingCard) {
  drafts[card.id] = initialDrafts(card, state.value);
}

onMounted(async () => {
  try {
    state.value = await api.settingsKeys();
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : "Impossible de lire les réglages.";
  }
  for (const card of SETTING_CARDS) {
    resetDrafts(card);
    openSteps[card.id] = !state.value?.services[card.id]?.configured;
  }
});

async function save(card: SettingCard) {
  const changes = pendingChanges(card, drafts[card.id] ?? {}, state.value);
  if (Object.keys(changes).length === 0) {
    results[card.id] = { ok: true, text: "Rien de nouveau à enregistrer." };
    return;
  }
  busy[card.id] = "save";
  results[card.id] = null;
  try {
    state.value = await api.saveSettingsKeys(changes);
    resetDrafts(card);
    results[card.id] = { ok: true, text: "Enregistré. C'est pris en compte tout de suite : clique sur Tester pour vérifier." };
  } catch (e) {
    results[card.id] = { ok: false, text: e instanceof ApiError ? e.message : "Enregistrement impossible." };
  } finally {
    busy[card.id] = null;
  }
}

async function clearKey(card: SettingCard, key: string) {
  busy[card.id] = "save";
  try {
    state.value = await api.saveSettingsKeys({ [key]: "" });
    resetDrafts(card);
    results[card.id] = { ok: true, text: "Valeur effacée." };
  } catch (e) {
    results[card.id] = { ok: false, text: e instanceof ApiError ? e.message : "Impossible d'effacer." };
  } finally {
    busy[card.id] = null;
  }
}

async function test(card: SettingCard) {
  busy[card.id] = "test";
  results[card.id] = null;
  try {
    const r = await api.testSetting(card.id);
    results[card.id] = { ok: r.ok, text: r.message };
  } catch (e) {
    results[card.id] = { ok: false, text: e instanceof ApiError ? e.message : "Le test n'a pas pu être lancé." };
  } finally {
    busy[card.id] = null;
  }
}

const keyState = (key: string) => state.value?.keys[key];
const configured = (id: string) => Boolean(state.value?.services[id]?.configured);
</script>

<template>
  <PageHeader
    title="Réglages"
    subtitle="Les clés gratuites des services utilisés par Job Radar. Elles restent sur ton PC, et sont prises en compte tout de suite."
  />

  <div class="stack">
    <p v-if="loadError" class="alert" role="alert"><Icon name="alert" :size="16" />{{ loadError }}</p>
    <p class="muted small" style="margin: 0">
      Aucun service n'est obligatoire. Pour recevoir des offres, il faut au moins France Travail, Adzuna ou Jooble.
    </p>

    <section v-for="card in SETTING_CARDS" :id="card.id" :key="card.id" class="card stack setting">
      <div class="spread">
        <h2 style="margin: 0">{{ card.title }}</h2>
        <span class="chip" :class="configured(card.id) ? 'good' : 'missing'">
          <Icon :name="configured(card.id) ? 'check' : 'lock'" :size="14" />{{ configured(card.id) ? "configuré" : "non configuré" }}
        </span>
      </div>
      <p style="margin: 0">{{ card.purpose }}</p>

      <div class="guide">
        <button type="button" class="link-button small" :aria-expanded="openSteps[card.id]" @click="openSteps[card.id] = !openSteps[card.id]">
          <Icon name="info" :size="14" />{{ openSteps[card.id] ? "Masquer les étapes" : "Comment obtenir la clé ?" }}
        </button>
        <div v-if="openSteps[card.id]" class="stack steps">
          <a :href="card.link.href" target="_blank" rel="noopener noreferrer"><Icon name="external" :size="14" />{{ card.link.label }}</a>
          <ol>
            <li v-for="(step, i) in card.steps" :key="i">{{ step }}</li>
          </ol>
        </div>
      </div>

      <form class="fields" @submit.prevent="save(card)">
        <label v-for="f in card.fields" :key="f.key">
          <span>
            {{ f.label }}<span v-if="f.optional" class="muted"> (facultatif)</span>
          </span>
          <input
            v-if="drafts[card.id]"
            v-model="drafts[card.id]![f.key]"
            :type="keyState(f.key)?.secret ? 'password' : 'text'"
            :placeholder="keyState(f.key)?.secret && keyState(f.key)?.filled ? `${keyState(f.key)?.display} (enregistrée, laisse vide pour garder)` : (f.placeholder ?? '')"
            autocomplete="off"
            spellcheck="false"
          />
          <span v-if="f.help" class="muted small">{{ f.help }}</span>
          <button
            v-if="keyState(f.key)?.secret && keyState(f.key)?.filled"
            type="button"
            class="link-button small"
            :disabled="!!busy[card.id]"
            @click="clearKey(card, f.key)"
          >
            Effacer cette clé
          </button>
        </label>
        <div class="actions">
          <button type="submit" class="primary" :disabled="!!busy[card.id]">
            <Icon name="save" :size="15" />{{ busy[card.id] === "save" ? "Enregistrement…" : "Enregistrer" }}
          </button>
          <button type="button" :disabled="!!busy[card.id]" @click="test(card)">
            <Icon name="target" :size="15" />{{ busy[card.id] === "test" ? "Test en cours…" : "Tester" }}
          </button>
        </div>
      </form>
      <p v-if="card.note" class="muted small" style="margin: 0"><Icon name="info" :size="13" /> {{ card.note }}</p>
      <p v-if="results[card.id]" :class="results[card.id]!.ok ? 'success' : 'alert'" role="status">
        <Icon :name="results[card.id]!.ok ? 'check' : 'alert'" :size="16" />{{ results[card.id]!.text }}
      </p>
    </section>
    <SourceRelaunchCard />
  </div>
</template>

<style scoped>
.setting { scroll-margin-top: 1rem; }
.steps { padding: 0.75rem 1rem; border-radius: 10px; background: var(--accent-soft); margin-top: 0.5rem; }
.steps ol { margin: 0; padding-left: 1.2rem; display: grid; gap: 0.35rem; }
.steps a { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.8rem 1rem; }
.fields label { display: grid; gap: 0.3rem; align-content: start; }
.fields .actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.6rem; }
.link-button { border: none; background: none; box-shadow: none; padding: 0; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; justify-self: start; }
.link-button:hover:not(:disabled) { text-decoration: underline; }
</style>
