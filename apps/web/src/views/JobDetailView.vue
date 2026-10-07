<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError, api } from "../api";
import AiAnalysisCard from "../components/AiAnalysisCard.vue";
import CoverLetterCard from "../components/CoverLetterCard.vue";
import Icon from "../components/Icon.vue";
import ScoreBadge from "../components/ScoreBadge.vue";
import SourceLogo from "../components/SourceLogo.vue";
import { BREAKDOWN_LABELS, SOURCE_LABELS, REMOTE_LABELS, STATUS_LABELS, formatSalary, linkLabel, mapsUrl, safeUrl, scoreTone, timeAgo, travelLabel } from "../format";
import { goBack } from "../router";
import type { JobDetail, JobEdits, JobStatus, RemoteType } from "../types";

const props = defineProps<{ id: string }>();
const job = ref<JobDetail | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const added = ref<string[]>([]);

async function load() {
  try {
    job.value = await api.getJob(props.id);
    if (job.value.status === "NEW") job.value = await api.setJobStatus(props.id, "SEEN");
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 404 ? "Offre introuvable." : "Impossible de charger l'offre.";
  }
}
onMounted(load);

async function setStatus(status: JobStatus) {
  busy.value = true;
  try {
    job.value = await api.setJobStatus(props.id, status);
  } finally {
    busy.value = false;
  }
}

/** Après une analyse IA : le score a pu être corrigé. */
async function reloadJob() {
  const fresh = await api.getJob(props.id).catch(() => null);
  if (fresh) job.value = fresh;
}

// ───── Annonce complète (Adzuna / Jooble ne donnent qu'un extrait) ─────
const completing = ref(false);
const fullText = ref("");
const completeError = ref<string | null>(null);

async function complete() {
  busy.value = true;
  completeError.value = null;
  try {
    job.value = { ...(await api.completeJob(props.id, fullText.value)), travelIssue: job.value?.travelIssue ?? null };
    completing.value = false;
    fullText.value = "";
  } catch (e) {
    completeError.value = e instanceof ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    busy.value = false;
  }
}

// ───── Infos corrigées à la main (entreprise, lieu, contrat, salaire… manquants ou faux) ─────
const CONTRACTS = ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"];
const editing = ref(false);
const editError = ref<string | null>(null);
const form = ref({ title: "", company: "", city: "", department: "", contractType: "", remoteType: "" as RemoteType | "", salaryMin: "", salaryMax: "", experienceMinYrs: "" });

/** Valeurs affichées actuellement : seules celles que tu changes deviennent des corrections. */
function currentValues(j: JobDetail) {
  const exp = j.userEdits?.experienceMinYrs ?? Number(j.experienceText?.match(/\d+/)?.[0] ?? NaN);
  return {
    title: j.title,
    company: j.company ?? "",
    city: j.city ?? "",
    department: j.department ?? "",
    contractType: j.contractType ?? "",
    remoteType: j.remoteType === "unknown" ? "" : j.remoteType,
    salaryMin: j.salaryMin?.toString() ?? "",
    salaryMax: j.salaryMax?.toString() ?? "",
    experienceMinYrs: Number.isNaN(exp) ? "" : String(exp),
  } as typeof form.value;
}

function startEdit() {
  form.value = currentValues(job.value!);
  editError.value = null;
  editing.value = true;
}

async function saveEdits(reset = false) {
  const before = currentValues(job.value!);
  const edits: Record<string, string | number> = reset ? {} : { ...job.value!.userEdits };
  if (!reset) {
    for (const [k, v] of Object.entries(form.value) as Array<[keyof typeof before, string]>) {
      const value = String(v).trim();
      if (value === before[k] || !value) continue; // inchangé, ou vidé : garde la valeur de la source
      edits[k] = ["salaryMin", "salaryMax", "experienceMinYrs"].includes(k) ? Number(value) : value;
    }
  }
  busy.value = true;
  editError.value = null;
  try {
    job.value = await api.editJob(props.id, edits as JobEdits);
    editing.value = false;
  } catch (e) {
    editError.value = e instanceof ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    busy.value = false;
  }
}

async function resetFull() {
  busy.value = true;
  try {
    job.value = { ...(await api.resetFullText(props.id)), travelIssue: job.value?.travelIssue ?? null };
  } finally {
    busy.value = false;
  }
}

/** « J'ai cette compétence » : l'ajoute au profil, le score se recalcule. */
async function addSkill(skill: string) {
  busy.value = true;
  try {
    const { profile } = await api.getProfile();
    if (!profile.skills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      await api.saveProfile({ ...profile, skills: [...profile.skills, skill] });
    }
    added.value.push(skill);
    job.value = await api.getJob(props.id);
  } finally {
    busy.value = false;
  }
}

const links = computed(() =>
  (job.value?.sources ?? []).map((s) => ({ ...s, safe: safeUrl(s.url) })).filter((s) => s.safe),
);
const bars = computed(() =>
  job.value ? (Object.keys(BREAKDOWN_LABELS) as Array<keyof typeof BREAKDOWN_LABELS>).map((k) => ({
    key: k,
    label: BREAKDOWN_LABELS[k],
    value: job.value!.score.breakdown[k],
  })) : [],
);
</script>

<template>
  <RouterLink to="/" class="back small" @click.prevent="goBack('/')"><Icon name="arrowLeft" :size="15" /> Retour</RouterLink>
  <p v-if="error" class="alert"><Icon name="alert" :size="16" />{{ error }}</p>
  <div v-else-if="!job" class="stack"><div class="skeleton" style="height: 180px" /><div class="skeleton" /></div>

  <div v-else class="stack detail">
    <section class="card hero">
      <div class="stack" style="gap: 0.55rem; min-width: 0">
        <div class="row">
          <span class="chip" :class="job.status === 'NEW' ? 'new' : job.status === 'EXPIRED' ? 'bad' : ''">{{ STATUS_LABELS[job.status] }}</span>
          <span class="muted small">Publiée {{ timeAgo(job.publishedAt) }} · vue la 1ʳᵉ fois {{ timeAgo(job.firstSeenAt) }}</span>
        </div>
        <h1>{{ job.title }}</h1>
        <div class="company muted">
          <span><Icon name="building" :size="15" />{{ job.company ?? "Entreprise non précisée" }}</span>
          <a v-if="job.address" :href="mapsUrl(job.address)" target="_blank" rel="noopener" title="Ouvrir dans Google Maps (le trajet est calculé jusqu'ici)"><Icon name="pin" :size="15" />{{ job.address }}</a>
          <a v-else-if="job.city || job.department" :href="mapsUrl(job.company, job.city, job.department)" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">
            <Icon name="pin" :size="15" />{{ job.city ?? "Département" }}<template v-if="job.department"> ({{ job.department }})</template>
          </a>
          <span v-else><Icon name="pin" :size="15" />Lieu non précisé</span>
        </div>
        <div class="row facts">
          <span class="chip"><Icon name="file" :size="13" />{{ job.contractType ?? "Contrat non précisé" }}</span>
          <span class="chip"><Icon name="euro" :size="13" />{{ formatSalary(job.salaryMin, job.salaryMax) ?? "Salaire non communiqué" }}</span>
          <span v-if="REMOTE_LABELS[job.remoteType]" class="chip"><Icon name="home" :size="13" />{{ REMOTE_LABELS[job.remoteType] }}</span>
          <span class="chip"><Icon name="star" :size="13" />Expérience : {{ job.experienceText ?? "non précisée" }}</span>
          <span class="chip" :title="job.travelIssue ?? (job.travelMode === 'car' ? 'Calcul en voiture : © IGN — Géoplateforme' : '')">
            <Icon name="train" :size="13" />Trajet : {{ travelLabel(job.travelMinutes, job.travelMode) }}
          </span>
        </div>
      </div>
      <div class="hero-side">
        <ScoreBadge :value="job.score.final" large />
        <button v-if="!editing" type="button" class="ghost small" @click="startEdit"><Icon name="edit" :size="14" />Modifier les infos</button>
      </div>
    </section>

    <section v-if="editing" class="card stack edit">
      <div>
        <h2 style="margin: 0"><Icon name="edit" :size="17" />Modifier les infos de l'offre</h2>
        <p class="muted small" style="margin: 0.3rem 0 0">Complète ce qui manque ou corrige ce qui est faux : tes corrections priment sur la source et le score est recalculé. Un champ vidé reprend la valeur de la source.</p>
      </div>
      <div class="edit-grid">
        <label class="wide">Intitulé<input v-model="form.title" /></label>
        <label>Entreprise<input v-model="form.company" /></label>
        <label>Ville<input v-model="form.city" /></label>
        <label>Département<input v-model="form.department" placeholder="ex. 69" maxlength="3" /></label>
        <label>Contrat
          <select v-model="form.contractType"><option value="">Non précisé</option><option v-for="c in CONTRACTS" :key="c" :value="c">{{ c }}</option></select>
        </label>
        <label>Télétravail
          <select v-model="form.remoteType"><option value="">Non précisé</option><template v-for="(l, k) in REMOTE_LABELS" :key="k"><option v-if="l && k !== 'unknown'" :value="k">{{ l }}</option></template></select>
        </label>
        <label>Salaire min (€ brut/an)<input v-model="form.salaryMin" type="number" min="8000" step="1000" /></label>
        <label>Salaire max (€ brut/an)<input v-model="form.salaryMax" type="number" min="8000" step="1000" /></label>
        <label>Expérience demandée (ans)<input v-model="form.experienceMinYrs" type="number" min="0" max="30" /></label>
      </div>
      <p v-if="editError" class="alert small"><Icon name="alert" :size="15" />{{ editError }}</p>
      <div class="row">
        <button type="button" class="primary" :disabled="busy" @click="saveEdits()"><Icon name="check" :size="16" />Enregistrer</button>
        <button type="button" class="ghost" :disabled="busy" @click="editing = false">Annuler</button>
        <button v-if="job.userEditsAt" type="button" class="ghost danger" :disabled="busy" @click="saveEdits(true)"><Icon name="undo" :size="16" />Revenir aux infos de la source</button>
      </div>
    </section>
    <p v-else-if="job.userEditsAt" class="info small">
      <Icon name="edit" :size="16" />
      <span>Infos corrigées à la main {{ timeAgo(job.userEditsAt) }} : le score les utilise.</span>
    </p>

    <section class="card actions">
      <a v-for="l in links" :key="l.url" class="btn primary" :href="l.safe!" target="_blank" rel="noopener noreferrer">
        <SourceLogo :source="l.source" :size="22" /> Voir l'offre sur {{ linkLabel(l.source, l.url) }}
        <Icon name="external" :size="15" />
      </a>
      <span class="sep" />
      <button type="button" :disabled="busy || job.status === 'SAVED'" @click="setStatus('SAVED')"><Icon name="bookmark" :size="16" />Sauvegarder</button>
      <button type="button" :disabled="busy || job.status === 'APPLIED'" @click="setStatus('APPLIED')"><Icon name="send" :size="16" />Marquer comme postulé</button>
      <button type="button" class="danger" :disabled="busy || job.status === 'IGNORED'" @click="setStatus('IGNORED')"><Icon name="eyeOff" :size="16" />Ignorer</button>
      <button v-if="job.status !== 'SEEN'" type="button" class="ghost" :disabled="busy" @click="setStatus('SEEN')"><Icon name="undo" :size="16" />Remettre à « vue »</button>
    </section>

    <p v-if="job.sources.some((s) => s.source === 'adzuna')" class="info small">
      <Icon name="info" :size="16" />
      <span>Offre fournie par <a href="https://www.adzuna.fr" target="_blank" rel="noopener noreferrer">Jobs by Adzuna</a>.</span>
    </p>

    <section v-if="job.abridged || completing" class="card complete">
      <div class="complete-head">
        <Icon name="alert" :size="18" />
        <div class="stack" style="gap: 0.2rem">
          <strong v-if="!job.description.trim()">Annonce non récupérée : la source n'a donné que le titre, pas la description.</strong>
          <strong v-else>Annonce incomplète : {{ job.sources.some((s) => s.source === "jooble") ? "Jooble" : "Adzuna" }} ne donne que le début du texte.</strong>
          <span class="muted small">
            Score approximatif, et l'IA ne le vérifie pas tant que l'annonce est incomplète.
            Le plus simple : « Voir l'offre », puis clique sur l'extension <strong>Envoyer à Job Radar</strong> → « Compléter l'offre existante ».
            Sinon : Ctrl + A, Ctrl + C sur l'annonce, et colle tout ici.
          </span>
        </div>
        <button v-if="!completing" type="button" class="primary" @click="completing = true"><Icon name="plus" :size="16" />Compléter l'annonce</button>
      </div>
      <template v-if="completing">
        <textarea v-model="fullText" rows="8" placeholder="Colle ici toute la page de l'annonce (Ctrl + V). Menus et « offres similaires » sont retirés tout seuls." />
        <p v-if="completeError" class="alert small"><Icon name="alert" :size="15" />{{ completeError }}</p>
        <div class="row">
          <button type="button" class="primary" :disabled="busy || fullText.trim().length < 50" @click="complete"><Icon name="check" :size="16" />Enregistrer l'annonce complète</button>
          <button type="button" class="ghost" :disabled="busy" @click="completing = false; completeError = null">Annuler</button>
        </div>
      </template>
    </section>
    <p v-else-if="job.fullTextAt" class="info small">
      <Icon name="check" :size="16" />
      <span>Annonce complète collée {{ timeAgo(job.fullTextAt) }} : le score et l'IA l'utilisent.
      <button type="button" class="link" :disabled="busy" @click="resetFull">Revenir à l'extrait</button></span>
    </p>
    <p v-if="job.travelMinutes === null && job.travelIssue" class="info small">
      <Icon name="train" :size="16" />
      <span>Trajet non calculé : {{ job.travelIssue }}.
      <RouterLink v-if="job.travelIssue.includes('point de départ')" to="/profil">Renseigner mon point de départ</RouterLink></span>
    </p>
    <p v-if="job.score.hidden" class="info"><Icon name="eyeOff" :size="16" />Masquée du flux principal : {{ job.score.hiddenReason }}.</p>

    <div class="layout">
      <div class="stack main">
        <AiAnalysisCard :key="`ai-${job.fullTextAt}`" :job-id="job.id" @analyzed="reloadJob" />

        <div class="grid-2">
          <section class="card">
            <h2><Icon name="check" :size="17" />Pourquoi ça correspond</h2>
            <p v-if="job.reasons.length === 0" class="muted small">Rien de particulier.</p>
            <ul class="clean reasons">
              <li v-for="r in job.reasons" :key="r">{{ r }}</li>
            </ul>
          </section>
          <section class="card">
            <h2><Icon name="alert" :size="17" />Points de vigilance</h2>
            <p v-if="job.warnings.length === 0" class="muted small">Aucun.</p>
            <ul class="clean warnings">
              <li v-for="w in job.warnings" :key="w">{{ w }}</li>
            </ul>
          </section>
        </div>

        <CoverLetterCard :key="`letter-${job.fullTextAt}`" :job-id="job.id" :title="job.title" :company="job.company" />

        <section class="card">
          <h2><Icon name="file" :size="17" />Description</h2>
          <p v-if="job.description.trim()" class="description">{{ job.description }}</p>
          <p v-else class="muted">Aucune description récupérée par la source : utilise « Compléter l'annonce » ci-dessus.</p>
          <p class="muted small" style="margin: 0">Règles de score : version {{ job.rulesVersion }}</p>
        </section>
      </div>

      <aside class="stack side">
        <section class="card">
          <h2><Icon name="target" :size="17" />Détail du score</h2>
          <div class="bars">
            <template v-for="b in bars" :key="b.key">
              <span class="small" :title="b.key === 'technical' && job.aiSkills ? 'Calculé sur les compétences exigées et les « plus » lus par l\'IA' : ''">
                {{ b.label }}<Icon v-if="b.key === 'technical' && job.aiSkills" name="sparkle" :size="11" class="ai-mark" />
              </span>
              <div class="bar"><div :class="scoreTone(b.value)" :style="{ width: `${b.value}%` }" /></div>
              <span class="small num" style="text-align: right">{{ b.value }}</span>
            </template>
          </div>
          <ol v-if="job.scoreSteps?.length" class="steps small">
            <li v-for="(st, i) in job.scoreSteps" :key="i" :class="{ last: i === job.scoreSteps.length - 1 }">
              <span>{{ st.label }}</span><strong class="num">{{ st.value }} %</strong>
            </li>
          </ol>
          <p v-if="job.aiSkills || job.ai" class="muted small ai-note"><Icon name="sparkle" :size="12" /> Critères ajustés avec la lecture de l'IA.</p>
        </section>

        <section class="card">
          <h2><Icon name="code" :size="17" />Compétences</h2>
          <div v-if="job.matchedSkills.length" class="stack" style="gap: 0.4rem; margin-bottom: 0.9rem">
            <span class="muted small">Tu as :</span>
            <div class="row"><span v-for="s in job.matchedSkills" :key="s" class="chip good">{{ s }}</span></div>
          </div>
          <span class="muted small">Absentes de ton profil :</span>
          <p v-if="job.missingSkills.length === 0" class="muted small">Aucune : tu as toutes les compétences détectées.</p>
          <template v-else>
            <div class="row" style="margin-top: 0.4rem">
              <span v-for="s in job.missingSkills" :key="s" class="chip missing">
                {{ s }}
                <button type="button" :disabled="busy" :title="`J'ai ${s}`" @click="addSkill(s)">+ je l'ai</button>
              </span>
            </div>
            <p class="muted small">Si tu les maîtrises, ajoute-les à ton profil et mets-les en avant dans ton CV et ta lettre.</p>
          </template>
          <p v-if="added.length" class="success small"><Icon name="check" :size="15" />Ajouté au profil : {{ added.join(", ") }}</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--muted); font-weight: 550; margin-bottom: 1rem; }
.back:hover { color: var(--accent); text-decoration: none; }
.hero { display: flex; justify-content: space-between; align-items: center; gap: 1.5rem; padding: 1.4rem 1.5rem; }
.hero h1 { font-size: 1.55rem; }
.hero-side { display: grid; justify-items: center; gap: 0.5rem; }
.edit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.7rem 1rem; }
.edit-grid label { display: grid; gap: 0.3rem; font-size: 0.85rem; }
.edit-grid .wide { grid-column: 1 / -1; }
.company { display: flex; flex-wrap: wrap; gap: 0.35rem 1.2rem; }
.company span, .company a { display: inline-flex; align-items: center; gap: 0.4rem; }
.company a { color: inherit; }
.facts { margin-top: 0.2rem; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.8rem 1rem; }
.actions .sep { flex: 1; }
.actions .btn.primary { padding-left: 0.55rem; }
.actions .btn.primary :deep(.source-logo) { border-color: transparent; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 1rem; align-items: start; }
.side { position: sticky; top: 1rem; }
.steps { list-style: none; margin: 0.9rem 0 0; padding: 0.7rem 0 0; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 0.3rem; }
.steps li { display: flex; justify-content: space-between; gap: 0.6rem; color: var(--muted); }
.steps li.last { color: var(--text); font-weight: 600; }
.ai-mark { margin-left: 0.3rem; color: var(--accent); vertical-align: -1px; }
.ai-note { display: flex; align-items: center; gap: 0.3rem; margin: 0.5rem 0 0; }
.description { white-space: pre-wrap; margin: 0 0 0.9rem; line-height: 1.65; }
.complete { display: flex; flex-direction: column; gap: 0.8rem; border-color: var(--mid); }
.complete-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.7rem; color: var(--mid); }
.complete-head strong { color: var(--text); }
.complete-head .stack { flex: 1 1 320px; }
.complete-head button { margin-left: auto; flex-shrink: 0; }
.complete textarea { width: 100%; }
button.link { background: none; border: 0; padding: 0; min-height: 0; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } .side { position: static; } }
@media (max-width: 600px) { .hero { flex-direction: column-reverse; align-items: flex-start; } }
</style>
