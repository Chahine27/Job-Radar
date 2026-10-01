<script setup lang="ts">
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";

type Browser = "chrome" | "edge" | "firefox" | "opera" | "unknown";

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
const extensionPage: Partial<Record<Browser, string>> = {
  chrome: "chrome://extensions/",
  edge: "edge://extensions/",
  opera: "opera://extensions/",
};
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
          L'extension actuelle n'est pas compatible avec Firefox : elle utilise un service worker Manifest V3 qui n'est pas
          pris en charge par Firefox. Job Radar reste utilisable sans l'extension.
        </p>
      </template>
      <template v-else>
        <p class="muted">
          L'extension est fournie avec le dossier Job Radar. Pour des raisons de sécurité, le navigateur demande de confirmer
          son ajout depuis sa page d'extensions.
          <template v-if="browser === 'opera'">Opera GX utilise le même accès aux extensions qu'Opera.</template>
        </p>
        <div class="row">
          <a
            v-if="extensionPage[browser]"
            class="btn primary"
            :href="extensionPage[browser]"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="external" :size="16" />Ouvrir les extensions {{ browserName }}
          </a>
          <template v-else>
            <a class="btn primary" href="chrome://extensions/" target="_blank" rel="noopener noreferrer">
              <Icon name="external" :size="16" />Chrome
            </a>
            <a class="btn primary" href="edge://extensions/" target="_blank" rel="noopener noreferrer">
              <Icon name="external" :size="16" />Edge
            </a>
            <a class="btn primary" href="opera://extensions/" target="_blank" rel="noopener noreferrer">
              <Icon name="external" :size="16" />Opera / Opera GX
            </a>
          </template>
        </div>
        <p class="muted small">
          Si le bouton ne fonctionne pas, copie l'adresse
          <code>{{ extensionPage[browser] ?? "chrome://extensions" }}</code> dans la barre d'adresse de {{ browserName }}.
        </p>
      </template>
    </section>

    <section v-if="browser !== 'firefox'" class="card stack">
      <h2>Ajouter Job Radar dans {{ browserName }}</h2>
      <ol class="install-steps">
        <li>Active le <strong>Mode développeur</strong> sur la page des extensions.</li>
        <li>Clique sur <strong>Charger l'extension non empaquetée</strong>.</li>
        <li>Choisis le dossier <code>extension</code> situé dans le dossier où Job Radar a été installé ou extrait.</li>
        <li>Épingle l'icône Job Radar depuis le menu des extensions pour l'avoir sous la main.</li>
      </ol>
      <p class="info">
        L'extension ne lit la page que lorsque tu cliques dessus. Elle envoie l'offre uniquement à ton instance Job Radar
        sur ce PC.
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
        l'ajout se fait depuis le dossier local. Opera GX est détecté comme Opera, car son identifiant navigateur ne permet
        pas toujours de le distinguer.
      </p>
    </section>
  </div>
</template>

<style scoped>
.install-steps { display: grid; gap: 0.65rem; margin: 0; padding-left: 1.4rem; }
.install-steps li { padding-left: 0.2rem; }
kbd { border: 1px solid var(--border-strong); border-radius: 5px; padding: 0.1rem 0.35rem; background: var(--surface-2); }
</style>
