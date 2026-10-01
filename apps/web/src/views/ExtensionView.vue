<script setup lang="ts">
import Icon from "../components/Icon.vue";
import PageHeader from "../components/PageHeader.vue";
</script>

<template>
  <PageHeader
    title="Extension navigateur"
    subtitle="Envoie une offre consultée dans ton navigateur vers Job Radar en un clic."
  />

  <div class="stack">
    <section class="card stack">
      <h2><Icon name="info" :size="18" />Installation pour Chrome ou Edge</h2>
      <p class="muted">
        L'extension est fournie avec le dossier Job Radar. Pour des raisons de sécurité, le navigateur demande de confirmer
        son ajout depuis sa page d'extensions.
      </p>
      <div class="row">
        <a class="btn primary" href="chrome://extensions/" target="_blank" rel="noopener noreferrer">
          <Icon name="external" :size="16" />Ouvrir les extensions Chrome
        </a>
        <a class="btn primary" href="edge://extensions/" target="_blank" rel="noopener noreferrer">
          <Icon name="external" :size="16" />Ouvrir les extensions Edge
        </a>
      </div>
      <p class="muted small">
        Si le bouton ne fonctionne pas, copie l'adresse <code>chrome://extensions</code> ou <code>edge://extensions</code>
        dans la barre d'adresse du navigateur.
      </p>
    </section>

    <section class="card stack">
      <h2>Ajouter Job Radar</h2>
      <ol class="install-steps">
        <li>Dans Chrome ou Edge, active le <strong>Mode développeur</strong> sur la page des extensions.</li>
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
      <p class="muted small">L'extension est compatible avec Chrome et Edge. Elle n'est pas publiée sur leurs boutiques : l'ajout se fait depuis le dossier local.</p>
    </section>
  </div>
</template>

<style scoped>
.install-steps { display: grid; gap: 0.65rem; margin: 0; padding-left: 1.4rem; }
.install-steps li { padding-left: 0.2rem; }
kbd { border: 1px solid var(--border-strong); border-radius: 5px; padding: 0.1rem 0.35rem; background: var(--surface-2); }
</style>
