<script setup lang="ts">
import { ref } from "vue";
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";

type Browser = "chrome" | "edge" | "firefox" | "opera" | "unknown";
type InstallableBrowser = "chrome" | "edge" | "opera";

function detectBrowser(userAgent: string): Browser {
  if (/Edg(e|A|iOS)?\//i.test(userAgent)) return "edge";
  if (/OPR\//i.test(userAgent)) return "opera";
  if (/Firefox\//i.test(userAgent)) return "firefox";
  if (/(Chrome|CriOS)\//i.test(userAgent)) return "chrome";
  return "unknown";
}

const browser = detectBrowser(navigator.userAgent);
const browserNames: Record<Browser, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  opera: "Opera ou Opera GX",
  unknown: "ton navigateur",
};
const browserName = browserNames[browser];
const extensionPage: Record<InstallableBrowser, string> = {
  chrome: "chrome://extensions/",
  edge: "edge://extensions/",
  opera: "opera://extensions/",
};
const copiedBrowser = ref<InstallableBrowser | null>(null);
const copyErrorBrowser = ref<InstallableBrowser | null>(null);

async function copyExtensionsAddress(targetBrowser: InstallableBrowser) {
  try {
    await navigator.clipboard.writeText(extensionPage[targetBrowser]);
    copiedBrowser.value = targetBrowser;
    copyErrorBrowser.value = null;
  } catch {
    copiedBrowser.value = null;
    copyErrorBrowser.value = targetBrowser;
  }
}
</script>

<template>
  <PageHeader
    title="Extension navigateur"
    subtitle="Envoie une offre consultée dans ton navigateur vers Job Radar en un clic."
  />

  <div class="stack">
    <section class="card stack">
      <h2><Icon name="info" :size="18" />{{ browser === "firefox" ? "Firefox détecté" : `Installation pour ${browserName}` }}</h2>
      <template v-if="browser === 'firefox'">
        <p class="info">
          L'extension actuelle n'est pas compatible avec Firefox : son script d'arrière-plan utilise un service worker
          Manifest V3. Job Radar reste utilisable sans l'extension.
        </p>
      </template>
      <template v-else>
        <p class="muted">
          Job Radar ne peut pas ouvrir directement cette page interne ni sélectionner le dossier à ta place. Copie son
          adresse, colle-la dans la barre d'adresse de {{ browserName }}, puis appuie sur Entrée.
          <template v-if="browser === 'opera'">Opera GX utilise le même accès aux extensions qu'Opera.</template>
        </p>
        <div class="row">
          <button
            v-if="browser !== 'unknown'"
            type="button"
            class="btn primary"
            @click="copyExtensionsAddress(browser)"
          >
            <Icon :name="copiedBrowser === browser ? 'check' : 'file'" :size="16" />
            {{ copiedBrowser === browser ? "Adresse copiée" : `Copier l'adresse des extensions ${browserName}` }}
          </button>
          <template v-else>
            <button type="button" class="btn" @click="copyExtensionsAddress('chrome')">
              {{ copiedBrowser === "chrome" ? "Chrome : adresse copiée" : "Copier l'adresse pour Chrome" }}
            </button>
            <button type="button" class="btn" @click="copyExtensionsAddress('edge')">
              {{ copiedBrowser === "edge" ? "Edge : adresse copiée" : "Copier l'adresse pour Edge" }}
            </button>
            <button type="button" class="btn" @click="copyExtensionsAddress('opera')">
              {{ copiedBrowser === "opera" ? "Opera : adresse copiée" : "Copier l'adresse pour Opera / Opera GX" }}
            </button>
          </template>
        </div>
        <p v-if="copiedBrowser" class="success small" role="status">
          Colle l'adresse copiée dans la barre d'adresse du navigateur et appuie sur Entrée.
        </p>
        <p v-if="copyErrorBrowser" class="alert small" role="alert">
          La copie automatique est bloquée. Saisis manuellement l'adresse
          <code>{{ extensionPage[copyErrorBrowser] }}</code>
          dans la barre d'adresse du navigateur.
        </p>
      </template>
    </section>

    <section v-if="browser !== 'firefox'" class="card stack">
      <h2>Charger le dossier de l'extension dans {{ browserName }}</h2>
      <ol class="install-steps">
        <li>Active le <strong>Mode développeur</strong> sur la page des extensions.</li>
        <li>Clique sur <strong>Charger l'extension non empaquetée</strong>.</li>
        <li>
          Dans le sélecteur de dossiers du navigateur, choisis le dossier <code>extension</code> qui se trouve à la racine
          du dossier où Job Radar a été installé ou extrait. Il faut sélectionner ce dossier, pas le dossier Job Radar
          complet ni un fichier à l'intérieur.
        </li>
        <li>Épingle l'icône Job Radar depuis le menu des extensions pour l'avoir sous la main.</li>
      </ol>
      <p class="info">
        L'ajout doit être confirmé dans le navigateur : une page web ne peut pas installer une extension locale ni choisir
        un dossier sur ton ordinateur à ta place.
      </p>
    </section>

    <section class="card stack">
      <h2>Envoyer une offre</h2>
      <ol class="install-steps">
        <li>Lance Job Radar avec le raccourci du Bureau.</li>
        <li>Ouvre une offre d'emploi, puis clique sur l'icône Job Radar ou utilise <kbd>Alt</kbd> + <kbd>Maj</kbd> + <kbd>J</kbd>.</li>
        <li>L'offre est transférée vers Job Radar pour être vérifiée et ajoutée à ta liste.</li>
      </ol>
      <p class="muted small">
        L'extension est compatible avec Chrome, Edge, Opera et Opera GX. Elle n'est pas publiée sur leurs boutiques :
        il faut charger le dossier local <code>extension</code>. Opera GX est détecté comme Opera.
      </p>
    </section>
  </div>
</template>

<style scoped>
.install-steps { display: grid; gap: 0.65rem; margin: 0; padding-left: 1.4rem; }
.install-steps li { padding-left: 0.2rem; }
kbd { border: 1px solid var(--border-strong); border-radius: 5px; padding: 0.1rem 0.35rem; background: var(--surface-2); }
</style>
