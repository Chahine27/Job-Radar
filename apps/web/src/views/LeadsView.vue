<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef, watch } from "vue";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import LeadZoneCard from "../components/LeadZoneCard.vue";
import PageHeader from "../components/PageHeader.vue";
import Ring from "../components/Ring.vue";
import { timeAgo } from "../format";
import { MAX_PROMPT_COMPANIES, buildEmailPrompt, parseEmailJson } from "../lead-emails";
import { usePrefs } from "../prefs";
import type { Lead, LeadStatus } from "../types";

const STATUS_LABELS: Record<LeadStatus, string> = {
  TO_CONTACT: "À contacter",
  CONTACTED: "Contactée",
  FOLLOWED_UP: "Relancée",
  INTERVIEW: "Entretien",
  NOT_INTERESTED: "Pas intéressé",
  IGNORED: "Ignorée",
};
const STATUS_TONES: Record<LeadStatus, string> = {
  TO_CONTACT: "new",
  CONTACTED: "",
  FOLLOWED_UP: "warn",
  INTERVIEW: "good",
  NOT_INTERESTED: "",
  IGNORED: "",
};
const PAGE = 20;

const leads = ref<Lead[]>([]);
const total = ref(0);
/** Filtres retenus comme préférences (serveur + copie locale). */
const prefs = usePrefs<{ filter: LeadStatus | "active" | "all"; email: "any" | "hint" | "missing"; sort: "potential" | "distance" }>("entreprises", {
  filter: "active",
  email: "any",
  sort: "potential",
});
const filter = toRef(prefs, "filter");
const emailFilter = toRef(prefs, "email");
const sort = toRef(prefs, "sort");
const lastRefreshAt = ref<string | null>(null);
const configured = ref(true);
const loading = ref(true);
const busy = ref(false);
const message = ref<{ ok: boolean; text: string } | null>(null);
const drafts = ref<Record<string, string>>({});
const emails = ref<Record<string, string>>({});
const emailError = ref<Record<string, string | null>>({});

async function load(append = false) {
  if (!append) loading.value = true;
  try {
    const res = await api.listLeads(filter.value, sort.value, append ? leads.value.length : 0, PAGE, emailFilter.value);
    leads.value = append ? [...leads.value, ...res.items] : res.items;
    total.value = res.total;
    lastRefreshAt.value = res.lastRefreshAt;
    configured.value = res.configured;
    scheduleAddresses(res.addressesPending);
    for (const l of res.items) {
      drafts.value[l.id] = l.notes ?? "";
      emails.value[l.id] = l.contactEmail ?? "";
    }
  } finally {
    loading.value = false;
  }
}
onMounted(() => load());
watch([filter, sort, emailFilter], () => load());

async function refresh() {
  busy.value = true;
  message.value = null;
  try {
    const r = await api.refreshLeads();
    message.value = { ok: true, text: `${r.found} entreprise(s) trouvée(s) (${r.around}) : ${r.created} nouvelle(s).` };
    await load();
  } catch (e) {
    message.value = { ok: false, text: e instanceof ApiError ? e.message : "La Bonne Boîte ne répond pas." };
  } finally {
    busy.value = false;
  }
}

async function setStatus(l: Lead, status: LeadStatus) {
  const updated = await api.updateLead(l.id, { status });
  Object.assign(l, updated);
}

// ───── Adresses exactes : cherchées en arrière-plan par le serveur, on les récupère quelques secondes plus tard ─────
let addressTimer: ReturnType<typeof setTimeout> | undefined;
let addressTries = 0;
function scheduleAddresses(pending: boolean) {
  clearTimeout(addressTimer);
  if (!pending || addressTries >= 6) return;
  addressTimer = setTimeout(async () => {
    addressTries++;
    try {
      const res = await api.listLeads(filter.value, sort.value, 0, Math.max(PAGE, leads.value.length), emailFilter.value);
      for (const u of res.items) {
        const l = leads.value.find((x) => x.id === u.id);
        if (l) Object.assign(l, { address: u.address, addressCheckedAt: u.addressCheckedAt });
      }
      scheduleAddresses(res.addressesPending);
    } catch {
      /* on réessaiera au prochain chargement */
    }
  }, 6000);
}
onUnmounted(() => clearTimeout(addressTimer));

/** Lien Google Maps : adresse exacte si connue, sinon nom + ville. */
const mapsUrl = (l: Lead) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address ? `${l.name}, ${l.address}` : `${l.name} ${l.postcode ?? ""} ${l.city ?? ""}`)}`;

// ───── Emails trouvés par une IA avec recherche web (copier le prompt → coller sa réponse JSON) ─────
const withoutEmail = computed(() => leads.value.filter((l) => !l.contactEmail));
const promptCopied = ref(false);
const pasteOpen = ref(false);
const pasted = ref("");
const overwrite = ref(false);
const importing = ref(false);
/** Métier visé, écrit dans le prompt (premier métier recherché du profil). */
const job = ref<string | null>(null);
onMounted(() => {
  api.getProfile().then((r) => (job.value = r.profile.searches[0] ?? null)).catch(() => {});
});

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(buildEmailPrompt(withoutEmail.value, job.value));
    promptCopied.value = true;
    pasteOpen.value = true;
    setTimeout(() => (promptCopied.value = false), 2500);
  } catch {
    message.value = { ok: false, text: "Copie impossible : autorise le presse-papiers dans le navigateur." };
  }
}

async function importEmails() {
  importing.value = true;
  message.value = null;
  try {
    const items = parseEmailJson(pasted.value);
    if (!items.length) throw new Error("Aucune entreprise reconnue dans le JSON (SIRET manquant ?).");
    const r = await api.importLeadEmails(items, overwrite.value);
    const parts = [`${r.updated} email(s) ajouté(s)`];
    if (r.notFound) parts.push(`${r.notFound} non trouvé(s) par l'IA${r.linksOnly ? ` (dont ${r.linksOnly} avec site ou formulaire noté)` : ""}`);
    if (r.kept) parts.push(`${r.kept} déjà rempli(s), gardé(s)`);
    if (r.invalid) parts.push(`${r.invalid} adresse(s) invalide(s)`);
    if (r.unknown) parts.push(`${r.unknown} SIRET inconnu(s)`);
    message.value = { ok: r.updated > 0, text: `${parts.join(" · ")}. Vérifie la source notée dans chaque fiche avant d'envoyer.` };
    pasted.value = "";
    pasteOpen.value = false;
    for (const u of r.leads) {
      const l = leads.value.find((x) => x.id === u.id);
      if (l) Object.assign(l, u);
      emails.value[u.id] = u.contactEmail ?? "";
      drafts.value[u.id] = u.notes ?? "";
    }
  } catch (e) {
    message.value = { ok: false, text: e instanceof Error ? e.message : "Import impossible." };
  } finally {
    importing.value = false;
  }
}

async function saveEmail(l: Lead) {
  const contactEmail = (emails.value[l.id] ?? "").trim();
  if ((l.contactEmail ?? "") === contactEmail) return;
  emailError.value[l.id] = null;
  try {
    Object.assign(l, await api.updateLead(l.id, { contactEmail }));
  } catch {
    emailError.value[l.id] = "Adresse email invalide.";
  }
}

async function saveNotes(l: Lead) {
  const notes = drafts.value[l.id] ?? "";
  if ((l.notes ?? "") === notes.trim()) return;
  Object.assign(l, await api.updateLead(l.id, { notes }));
}

function size(l: Lead) {
  if (l.headcountMin === null && l.headcountMax === null) return "taille inconnue";
  if (l.headcountMin === l.headcountMax || l.headcountMax === null) return `${l.headcountMin} salarié(s)`;
  return `${l.headcountMin ?? 0}–${l.headcountMax} salariés`;
}

const lbbUrl = (siret: string) => `https://labonneboite.francetravail.fr/entreprise/${encodeURIComponent(siret)}`;
const searchUrl = (l: Lead) =>
  `https://www.google.com/search?q=${encodeURIComponent(`${l.name} ${l.city ?? ""} site carrière`)}`;
</script>

<template>
  <PageHeader title="Candidatures spontanées">
    <p class="subtitle">
      Entreprises qui devraient recruter dans ton métier dans les 6 prochains mois, dans la zone choisie. Données
      <a href="https://labonneboite.francetravail.fr/" target="_blank" rel="noopener noreferrer">La Bonne Boîte</a> (France Travail, licence Etalab).
    </p>
    <p class="subtitle small"><Icon name="clock" :size="13" /> Dernière mise à jour : {{ lastRefreshAt ? timeAgo(lastRefreshAt) : "jamais" }}</p>
    <template #actions>
      <button type="button" class="primary" :disabled="busy || !configured" @click="refresh">
        <Icon name="refresh" :size="16" :class="{ spin: busy }" />
        {{ busy ? "Recherche…" : "Actualiser les entreprises" }}
      </button>
    </template>
  </PageHeader>

  <div class="stack">
    <LeadZoneCard @apply="refresh" />

    <p v-if="!configured" class="alert"><Icon name="alert" :size="16" />Identifiants France Travail absents de .env.</p>
    <p v-if="message" :class="message.ok ? 'success' : 'alert'" role="status">
      <Icon :name="message.ok ? 'check' : 'alert'" :size="16" />{{ message.text }}
    </p>

    <section v-if="leads.length" class="card stack finder">
      <div class="finder-head">
        <div>
          <strong><Icon name="mail" :size="16" />Trouver les emails avec une IA qui cherche sur internet</strong>
          <p class="muted small">
            Copie le prompt, colle-le dans ChatGPT, Claude ou Perplexity (recherche web activée), puis colle ici sa réponse :
            chaque email est rangé dans la bonne entreprise.
          </p>
        </div>
        <div class="row">
          <button type="button" :disabled="!withoutEmail.length" @click="copyPrompt">
            <Icon :name="promptCopied ? 'check' : 'file'" :size="15" />
            {{ promptCopied ? "Prompt copié !" : `Copier le prompt (${Math.min(withoutEmail.length, MAX_PROMPT_COMPANIES)} entreprise(s) sans email)` }}
          </button>
          <button type="button" class="ghost" @click="pasteOpen = !pasteOpen">Coller la réponse</button>
        </div>
      </div>
      <template v-if="pasteOpen">
        <textarea v-model="pasted" rows="7" placeholder='Colle ici toute la réponse de l&apos;IA : [{"siret": "…", "email": "…", "source": "…"}]' />
        <div class="row">
          <button type="button" class="primary" :disabled="importing || !pasted.trim()" @click="importEmails">
            <Icon name="check" :size="15" />{{ importing ? "Import…" : "Ranger les emails" }}
          </button>
          <label class="switch small"><input v-model="overwrite" type="checkbox" /> Remplacer les emails déjà saisis</label>
        </div>
      </template>
    </section>

    <section class="card toolbar">
      <label>
        Afficher
        <select v-model="filter" aria-label="Suivi">
          <option value="active">À traiter (sans les écartées)</option>
          <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
          <option value="all">Toutes</option>
        </select>
      </label>
      <label>
        Email
        <select v-model="emailFilter">
          <option value="any">Toutes</option>
          <option value="hint">« Email sur la fiche » La Bonne Boîte (pas encore saisi)</option>
          <option value="missing">Sans email saisi</option>
        </select>
      </label>
      <label>
        Trier par
        <select v-model="sort">
          <option value="potential">Potentiel d'embauche</option>
          <option value="distance">Du plus proche au plus loin</option>
        </select>
      </label>
      <span class="muted small total"><strong>{{ total }}</strong> entreprise(s) dans la zone</span>
    </section>

    <template v-if="loading">
      <div v-for="n in 3" :key="n" class="skeleton" />
    </template>
    <div v-else-if="leads.length === 0" class="empty">
      <Icon name="building" :size="40" />
      <strong>Aucune entreprise pour l'instant</strong>
      <span class="small">Choisis une zone puis clique sur « Actualiser les entreprises ».</span>
    </div>

    <article v-for="l in leads" :key="l.id" class="card lead">
      <Ring
        :value="l.hiringPotential"
        :tone="l.isHighPotential ? 'good' : 'accent'"
        caption="/ 100"
        class="md"
        :title="`Potentiel d'embauche : ${l.hiringPotential ?? '?'} / 100`"
      />
      <div class="stack body">
        <div class="top">
          <div class="row">
            <strong class="name">{{ l.name }}</strong>
            <span v-if="l.officeName" class="muted small">({{ l.officeName }})</span>
            <span v-if="l.isHighPotential" class="chip good"><Icon name="star" :size="12" />Fort potentiel</span>
          </div>
          <span class="chip" :class="STATUS_TONES[l.status]">{{ STATUS_LABELS[l.status] }}</span>
        </div>
        <div class="meta muted small">
          <span><Icon name="briefcase" :size="14" />{{ l.nafLabel ?? "Secteur inconnu" }}</span>
          <span><Icon name="users" :size="14" />{{ size(l) }}</span>
          <a :href="mapsUrl(l)" target="_blank" rel="noopener noreferrer" class="maps" title="Ouvrir dans Google Maps">
            <Icon name="pin" :size="14" />
            <template v-if="l.address">{{ l.address }}</template>
            <template v-else>{{ l.city ?? "?" }} ({{ l.postcode ?? l.department ?? "?" }})</template>
          </a>
          <span v-if="l.distanceKm !== null">à {{ l.distanceKm }} km</span>
          <span v-if="l.contactedAt"><Icon name="send" :size="14" />contactée {{ timeAgo(l.contactedAt) }}</span>
        </div>
        <div class="row links small">
          <a :href="lbbUrl(l.siret)" target="_blank" rel="noopener noreferrer"><Icon name="external" :size="14" />Fiche La Bonne Boîte</a>
          <span v-if="l.hasEmail" class="chip accent"><Icon name="mail" :size="12" />email sur la fiche</span>
          <a :href="searchUrl(l)" target="_blank" rel="noopener noreferrer"><Icon name="globe" :size="14" />Chercher leur site</a>
        </div>
        <div class="edit">
          <select :value="l.status" aria-label="Suivi" @change="setStatus(l, ($event.target as HTMLSelectElement).value as LeadStatus)">
            <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
          <input
            v-model="drafts[l.id]"
            placeholder="Notes (contact, date de relance…)"
            aria-label="Notes"
            @blur="saveNotes(l)"
            @keydown.enter="saveNotes(l)"
          />
        </div>
        <div class="apply">
          <input
            v-model="emails[l.id]"
            type="email"
            placeholder="Email de contact (collé depuis la fiche ou leur site)"
            aria-label="Email de contact"
            @blur="saveEmail(l)"
            @keydown.enter="saveEmail(l)"
          />
          <RouterLink :to="`/entreprises/${l.id}/candidature`" class="btn" :class="{ primary: !!l.contactEmail }">
            <Icon name="mail" :size="15" />Préparer la candidature
          </RouterLink>
        </div>
        <p v-if="emailError[l.id]" class="alert small">{{ emailError[l.id] }}</p>
      </div>
    </article>

    <div v-if="!loading && leads.length < total" class="more">
      <button type="button" @click="load(true)">Charger plus ({{ total - leads.length }} restante(s))</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 0.9rem 1.2rem; padding: 0.9rem 1rem; }
.toolbar .total { margin-left: auto; padding-bottom: 0.5rem; }
.toolbar .total strong { color: var(--text); }
.lead { display: flex; gap: 1.1rem; align-items: flex-start; transition: border-color 0.15s, box-shadow 0.15s; }
.lead:hover { border-color: var(--border-strong); box-shadow: var(--shadow-hover); }
.body { min-width: 0; flex: 1; gap: 0.55rem; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.name { font-size: 1.02rem; font-weight: 650; }
.meta { display: flex; flex-wrap: wrap; gap: 0.3rem 1.1rem; }
.meta span, .meta a, .links a { display: inline-flex; align-items: center; gap: 0.35rem; }
.meta .maps { color: inherit; text-decoration: underline dotted; text-underline-offset: 3px; }
.meta .maps:hover { color: var(--accent); }
.links { gap: 0.5rem 1.1rem; }
.edit { display: grid; grid-template-columns: 11rem 1fr; gap: 0.5rem; }
.apply { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
.finder { gap: 0.7rem; }
.finder-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.6rem 1rem; align-items: flex-start; }
.finder-head strong { display: inline-flex; align-items: center; gap: 0.4rem; }
.finder-head p { margin: 0.25rem 0 0; max-width: 46rem; }
.finder textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 0.82rem; }
.more { display: flex; justify-content: center; padding: 0.5rem 0 1rem; }
@media (max-width: 600px) { .lead { gap: 0.8rem; } .edit, .apply { grid-template-columns: 1fr; } .top { flex-direction: column; } }
</style>
