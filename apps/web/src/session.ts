import { ref } from "vue";
import { api } from "./api";

export const currentEmail = ref<string | null>(null);
/** Un compte existe-t-il déjà sur ce PC ? (sinon : écran de bienvenue pour le créer) */
export const hasAccount = ref(true);
/** Connecté mais premier lancement pas terminé (CV + profil). */
export const needsSetup = ref(false);
let checked = false;

/** Vérifie une seule fois au chargement si une session existe déjà, et si le premier lancement est fait. */
export async function ensureSession(): Promise<boolean> {
  if (!checked) {
    checked = true;
    try {
      currentEmail.value = (await api.me()).user.email;
    } catch {
      currentEmail.value = null;
    }
    try {
      const s = await api.setupStatus();
      hasAccount.value = s.hasAccount;
      needsSetup.value = s.needsSetup;
    } catch {
      // Serveur injoignable : la page de connexion le dira.
    }
  }
  return currentEmail.value !== null;
}

export function setLoggedOut() {
  currentEmail.value = null;
}
