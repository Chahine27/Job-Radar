<script setup lang="ts">
import { departmentFromPostalCode, departmentName } from "@job-radar/shared/geo";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, api } from "../api";
import Icon from "../components/Icon.vue";
import TagInput from "../components/TagInput.vue";
import { currentEmail, hasAccount, needsSetup } from "../session";
import type { CvProposal, SetupForm } from "../types";

/**
 * Premier lancement, en 3 étapes :
 * 1. créer son compte (personnel, gardé sur ce PC) ;
 * 2. déposer son CV → l'IA locale (Ollama) le lit ;
 * 3. relire et corriger ce qu'elle propose, puis valider.
 */
const router = useRouter();
type Step = "account" | "cv" | "reading" | "review";
const step = ref<Step>(currentEmail.value ? "cv" : "account");
const error = ref<string | null>(null);
const busy = ref(false);

const STEPS: Array<{ key: Step; label: string }> = [
  { key: "account", label: "Ton compte" },
  { key: "cv", label: "Ton CV" },
  { key: "review", label: "Ton profil" },
];
const stepIndex = computed(() => (step.value === "reading" ? 1 : STEPS.findIndex((s) => s.key === step.value)));

// ───────────── 1. Compte ─────────────
const email = ref("");
const password = ref("");
const password2 = ref("");

async function createAccount() {
  error.value = null;
  if (password.value.length < 12) return void (error.value = "Le mot de passe doit faire au moins 12 caractères.");
  if (password.value !== password2.value) return void (error.value = "Les deux mots de passe ne sont pas identiques.");
  busy.value = true;
  try {
    const res = await api.createAccount(email.value, password.value);
    currentEmail.value = res.user.email;
    hasAccount.value = true;
    needsSetup.value = true;
    step.value = "cv";
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      hasAccount.value = true;
      await router.push({ name: "login" });
    } else error.value = e instanceof ApiError && e.status < 500 ? e.message : "Serveur injoignable : relance Job Radar avec le raccourci du bureau.";
  } finally {
    busy.value = false;
  }
}

// ───────────── 2. CV ─────────────
const MAX_BYTES = 8 * 1024 * 1024;
const pasted = ref("");
const showPaste = ref(false);
const fileName = ref<string | null>(null);
const dragging = ref(false);

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.readAsDataURL(file);
  });
}
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function sendFile(file: File | undefined) {
  if (!file) return;
  error.value = null;
  if (file.size > MAX_BYTES) return void (error.value = "Fichier trop gros (8 Mo maximum).");
  if (!/\.(pdf|docx|txt)$/i.test(file.name)) return void (error.value = "Envoie ton CV en PDF, en Word (.docx) ou en texte (.txt).");
  fileName.value = file.name;
  await upload(file.name, await toBase64(file));
}
async function sendPasted() {
  error.value = null;
  if (pasted.value.trim().length < 200) return void (error.value = "Colle le texte complet de ton CV (au moins quelques lignes).");
  fileName.value = "texte collé";
  await upload("cv.txt", textToBase64(pasted.value));
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  void sendFile(e.dataTransfer?.files?.[0]);
}
function onPick(e: Event) {
  void sendFile((e.target as HTMLInputElement).files?.[0]);
}

async function upload(name: string, data: string) {
  busy.value = true;
  try {
    await api.uploadCv(name, data);
  } catch (e) {
    busy.value = false;
    error.value = e instanceof ApiError ? e.message : "Envoi impossible.";
    return;
  }
  busy.value = false;
  await readWithAi();
}

// ───────────── Lecture par l'IA ─────────────
const aiFailed = ref<string | null>(null);
async function readWithAi() {
  step.value = "reading";
  aiFailed.value = null;
  try {
    const res = await api.readCv();
    fillFrom(res.proposal);
  } catch (e) {
    aiFailed.value =
      e instanceof ApiError && e.status === 503
        ? "L'IA locale (Ollama) ne répond pas. Ouvre l'appli Ollama sur ce PC puis réessaie, ou remplis ton profil à la main."
        : `L'IA n'a pas réussi à lire ton CV${e instanceof Error && e.message ? ` (${e.message})` : ""}. Réessaie, ou remplis ton profil à la main.`;
  }
}

// ───────────── 3. Profil à relire ─────────────
const CONTRACTS = ["CDI", "CDD", "Intérim", "Alternance", "Freelance"];
const FROM_AI: Record<string, string> = { CDI: "CDI", CDD: "CDD", INTERIM: "Intérim", ALTERNANCE: "Alternance", FREELANCE: "Freelance" };
const form = ref<SetupForm>({
  fullName: null,
  email: null,
  phone: null,
  city: null,
  postalCode: null,
  department: null,
  searches: [],
  skills: [],
  mastered: [],
  yearsOfExperience: null,
  contracts: ["CDI", "CDD"],
  salaryTarget: null,
});
const job = ref<string | null>(null);

function fillFrom(p: CvProposal) {
  const contracts = p.contracts.map((c) => FROM_AI[c]).filter((c): c is string => !!c);
  form.value = {
    ...form.value,
    fullName: p.fullName,
    email: p.email,
    phone: p.phone,
    city: p.city,
    postalCode: p.postalCode,
    department: p.department,
    searches: p.searches.length ? p.searches : p.job ? [p.job] : [],
    skills: p.skills,
    yearsOfExperience: p.yearsOfExperience,
    contracts: contracts.length ? contracts : form.value.contracts,
  };
  job.value = p.job;
  step.value = "review";
}
function fillByHand() {
  step.value = "review";
}

const department = computed(() => departmentFromPostalCode(form.value.postalCode) ?? form.value.department);
const departmentLabel = computed(() => (department.value ? departmentName(department.value) : null));

function toggleContract(c: string) {
  const list = form.value.contracts;
  form.value.contracts = list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
}
function removeSkill(skill: string) {
  form.value.skills = form.value.skills.filter((x) => x !== skill);
  form.value.mastered = form.value.mastered.filter((x) => x !== skill);
}
function toggleMastered(skill: string) {
  const list = form.value.mastered;
  form.value.mastered = list.includes(skill) ? list.filter((x) => x !== skill) : list.length < 8 ? [...list, skill] : list;
}

const salaryInput = computed({
  get: () => (form.value.salaryTarget ? String(form.value.salaryTarget) : ""),
  set: (v: string) => {
    const n = Number(v.replace(/\D/g, ""));
    form.value.salaryTarget = n >= 8000 ? n : null;
  },
});
const yearsInput = computed({
  get: () => (form.value.yearsOfExperience === null ? "" : String(form.value.yearsOfExperience)),
  set: (v: string) => {
    const n = Number.parseInt(v, 10);
    form.value.yearsOfExperience = Number.isFinite(n) && n >= 0 ? Math.min(n, 50) : null;
  },
});
const blank = (s: string | null) => (s && s.trim() ? s.trim() : null);

async function finish() {
  error.value = null;
  if (form.value.searches.length === 0) return void (error.value = "Ajoute au moins un métier à rechercher.");
  if (form.value.contracts.length === 0) return void (error.value = "Choisis au moins un type de contrat.");
  const pc = blank(form.value.postalCode);
  if (pc && !/^\d{5}$/.test(pc)) return void (error.value = "Le code postal doit faire 5 chiffres.");
  busy.value = true;
  try {
    await api.finishSetup({
      ...form.value,
      fullName: blank(form.value.fullName),
      email: blank(form.value.email),
      phone: blank(form.value.phone),
      city: blank(form.value.city),
      postalCode: pc,
      department: department.value,
      mastered: form.value.mastered.filter((m) => form.value.skills.includes(m)),
    });
    needsSetup.value = false;
    await router.push({ name: "jobs" });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "Enregistrement impossible.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="welcome-wrap">
    <div class="welcome stack">
      <div class="head">
        <span class="brand-logo big"><Icon name="radar" :size="26" color="#fff" /></span>
        <h1>Bienvenue sur Job Radar</h1>
        <p class="muted small">Tout reste sur ce PC : ton compte, ton CV et tes offres. Aucune inscription sur internet.</p>
      </div>

      <ol class="steps">
        <li v-for="(s, i) in STEPS" :key="s.key" :class="{ done: i < stepIndex, now: i === stepIndex }">
          <span class="dot"><Icon v-if="i < stepIndex" name="check" :size="13" /><template v-else>{{ i + 1 }}</template></span>{{ s.label }}
        </li>
      </ol>

      <!-- 1. Compte -->
      <form v-if="step === 'account'" class="card stack pad" @submit.prevent="createAccount">
        <h2>Crée ton compte</h2>
        <p class="muted small">Il sert seulement à protéger ton espace sur ce PC. Note bien ton mot de passe.</p>
        <label>Email
          <div class="field"><Icon name="mail" :size="16" /><input v-model="email" type="email" autocomplete="username" required /></div>
        </label>
        <label>Mot de passe (12 caractères minimum)
          <div class="field"><Icon name="lock" :size="16" /><input v-model="password" type="password" autocomplete="new-password" minlength="12" required /></div>
        </label>
        <label>Le même mot de passe, encore une fois
          <div class="field"><Icon name="lock" :size="16" /><input v-model="password2" type="password" autocomplete="new-password" required /></div>
        </label>
        <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
        <button class="primary" type="submit" :disabled="busy">{{ busy ? "Création…" : "Créer mon compte" }}</button>
      </form>

      <!-- 2. CV -->
      <section v-else-if="step === 'cv'" class="card stack pad">
        <h2>Dépose ton CV</h2>
        <p class="muted small">L'IA installée sur ce PC le lit et prépare ton profil : métiers à chercher, compétences, ville. Rien n'est envoyé sur internet.</p>
        <label
          class="drop"
          :class="{ over: dragging, busy }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <Icon :name="busy ? 'refresh' : 'file'" :size="30" :class="{ spin: busy }" />
          <strong>{{ busy ? `Envoi de ${fileName}…` : "Glisse ton CV ici, ou clique pour le choisir" }}</strong>
          <span class="muted small">PDF, Word (.docx) ou texte — 8 Mo maximum</span>
          <input type="file" accept=".pdf,.docx,.txt" hidden :disabled="busy" @change="onPick" />
        </label>
        <button type="button" class="link small" @click="showPaste = !showPaste">CV scanné ou en image ? Colle plutôt son texte</button>
        <div v-if="showPaste" class="stack">
          <textarea v-model="pasted" rows="8" placeholder="Colle ici tout le texte de ton CV"></textarea>
          <button type="button" :disabled="busy" @click="sendPasted">Envoyer ce texte</button>
        </div>
        <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
      </section>

      <!-- Lecture par l'IA -->
      <section v-else-if="step === 'reading'" class="card stack pad center">
        <template v-if="!aiFailed">
          <Icon name="sparkle" :size="34" class="pulse" />
          <h2>L'IA lit ton CV…</h2>
          <p class="muted small">Cela prend de 30 secondes à 2 minutes selon ton PC. Ne ferme pas la page.</p>
        </template>
        <template v-else>
          <p class="alert" role="alert"><Icon name="alert" :size="16" />{{ aiFailed }}</p>
          <div class="row">
            <button class="primary" type="button" @click="readWithAi"><Icon name="refresh" :size="15" />Réessayer</button>
            <button type="button" @click="fillByHand">Remplir à la main</button>
            <button type="button" class="ghost" @click="step = 'cv'">Changer de CV</button>
          </div>
        </template>
      </section>

      <!-- 3. Profil -->
      <form v-else class="stack" @submit.prevent="finish">
        <section class="card stack pad">
          <h2>Vérifie ton profil</h2>
          <p class="muted small">
            {{ job ? `L'IA a lu ton CV : métier « ${job} ». ` : "" }}Corrige tout ce qui ne va pas : c'est ce qui sert à chercher et à noter les offres. Tout reste modifiable ensuite dans « Profil » et « CV & lettre ».
          </p>
        </section>

        <section class="card stack pad">
          <h3><Icon name="search" :size="16" />Métiers à rechercher</h3>
          <p class="muted small">Les intitulés tapés dans les sites d'offres, du plus proche au plus large.</p>
          <TagInput v-model="form.searches" placeholder="Ex. Assistant comptable" />
        </section>

        <section class="card stack pad">
          <h3><Icon name="star" :size="16" />Compétences et outils</h3>
          <p class="muted small">Logiciels, techniques, gestes métier, langues, permis… Clique sur l'étoile des compétences que tu maîtrises vraiment (8 au plus) : les lettres les mettront en avant.</p>
          <div class="row">
            <span v-for="s in form.skills" :key="s" class="chip" :class="{ accent: form.mastered.includes(s) }">
              <button type="button" :aria-label="`Je maîtrise ${s}`" :aria-pressed="form.mastered.includes(s)" @click="toggleMastered(s)">
                <Icon name="star" :size="13" />
              </button>
              {{ s }}
              <button type="button" :aria-label="`Retirer ${s}`" @click="removeSkill(s)">×</button>
            </span>
            <span v-if="form.skills.length === 0" class="muted small">Aucune compétence pour l'instant.</span>
          </div>
          <TagInput v-model="form.skills" hide-tags placeholder="Ajouter une compétence" />
        </section>

        <div class="grid-2">
          <section class="card stack pad">
            <h3><Icon name="pin" :size="16" />Où tu habites</h3>
            <div class="grid-two">
              <label>Code postal<input v-model="form.postalCode" inputmode="numeric" maxlength="5" placeholder="Ex. 69003" /></label>
              <label>Ville<input v-model="form.city" placeholder="Ex. Lyon" /></label>
            </div>
            <p class="muted small">
              {{ departmentLabel ? `Les offres seront cherchées dans : ${departmentLabel} (${department}).` : "Indique ton code postal pour cibler ton département." }}
            </p>
          </section>

          <section class="card stack pad">
            <h3><Icon name="calendar" :size="16" />Expérience et salaire</h3>
            <div class="grid-two">
              <label>Années d'expérience<input v-model="yearsInput" inputmode="numeric" placeholder="Ex. 3" /></label>
              <label>Salaire visé (brut / an, facultatif)<input v-model="salaryInput" inputmode="numeric" placeholder="Ex. 28000" /></label>
            </div>
          </section>
        </div>

        <section class="card stack pad">
          <h3><Icon name="file" :size="16" />Contrats recherchés</h3>
          <div class="row">
            <button
              v-for="c in CONTRACTS"
              :key="c"
              type="button"
              class="toggle"
              :class="{ on: form.contracts.includes(c) }"
              :aria-pressed="form.contracts.includes(c)"
              @click="toggleContract(c)"
            >
              <Icon v-if="form.contracts.includes(c)" name="check" :size="14" />{{ c }}
            </button>
          </div>
        </section>

        <section class="card stack pad">
          <h3><Icon name="user" :size="16" />En-tête des lettres de motivation</h3>
          <div class="grid-two">
            <label>Prénom et nom<input v-model="form.fullName" /></label>
            <label>Email de contact<input v-model="form.email" type="email" /></label>
            <label>Téléphone<input v-model="form.phone" /></label>
          </div>
        </section>

        <p v-if="error" class="alert" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
        <div class="row end">
          <button type="button" class="ghost" @click="step = 'cv'">Changer de CV</button>
          <button class="primary" type="submit" :disabled="busy">{{ busy ? "Enregistrement…" : "C'est bon, lancer la recherche" }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.welcome-wrap {
  min-height: 100vh; padding: 2rem 1rem;
  background:
    radial-gradient(800px 400px at 15% 10%, rgb(99 102 241 / 0.18), transparent 60%),
    radial-gradient(700px 400px at 85% 90%, rgb(34 211 238 / 0.14), transparent 60%),
    var(--bg);
}
.welcome { width: 100%; max-width: 760px; margin: 0 auto; gap: 1rem; }
.head { display: grid; justify-items: center; gap: 0.5rem; text-align: center; }
.head h1, .head p { margin: 0; }
.brand-logo.big { width: 52px; height: 52px; border-radius: 15px; }
.pad { padding: 1.5rem; }
.card h2, .card h3 { margin: 0; display: flex; align-items: center; gap: 0.45rem; }
.card p { margin: 0; }
.center { justify-items: center; text-align: center; }
.steps { list-style: none; display: flex; justify-content: center; gap: 1.2rem; padding: 0; margin: 0; flex-wrap: wrap; }
.steps li { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.9rem; }
.steps li.now { color: var(--accent); font-weight: 600; }
.steps li.done { color: var(--text); }
.dot { width: 24px; height: 24px; border-radius: 99px; display: grid; place-items: center; border: 1px solid var(--border-strong); font-size: 0.8rem; }
.now .dot { border-color: var(--accent); background: var(--accent-soft); }
.done .dot { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
.drop {
  display: grid; justify-items: center; gap: 0.4rem; padding: 2.2rem 1rem; text-align: center; cursor: pointer;
  border: 2px dashed var(--border-strong); border-radius: var(--radius-sm); color: var(--muted); transition: border-color 0.15s, background 0.15s;
}
.drop:hover, .drop.over { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.drop.busy { pointer-events: none; opacity: 0.8; }
.drop strong { color: var(--text); }
.grid-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.8rem; }
.grid-two label { display: grid; gap: 0.3rem; }
.grid-two input { width: 100%; }
textarea { width: 100%; resize: vertical; }
.toggle { border-radius: 99px; padding: 0.35rem 0.85rem; font-size: 0.86rem; color: var(--muted); }
.toggle.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.end { justify-content: flex-end; }
.pulse { color: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; transform: scale(0.92); } }
</style>
