import { createRouter, createWebHistory } from "vue-router";
import { ensureSession, hasAccount, needsSetup } from "./session";

export const router = createRouter({
  history: createWebHistory(),
  // Lien vers une carte précise (ex. /reglages#email).
  scrollBehavior: (to) => (to.hash ? { el: to.hash } : undefined),
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/bienvenue", name: "welcome", component: () => import("./views/WelcomeView.vue"), meta: { public: true, bare: true } },
    { path: "/", name: "jobs", component: () => import("./views/DashboardView.vue") },
    { path: "/postule", name: "applications", component: () => import("./views/ApplicationsView.vue") },
    { path: "/ajouter", name: "add-job", component: () => import("./views/ManualJobView.vue") },
    { path: "/offres/:id", name: "job", component: () => import("./views/JobDetailView.vue"), props: true },
    { path: "/entreprises", name: "leads", component: () => import("./views/LeadsView.vue") },
    { path: "/entreprises/:id/candidature", name: "spontaneous", component: () => import("./views/SpontaneousView.vue"), props: true },
    { path: "/sources", name: "sources", component: () => import("./views/SourcesView.vue") },
    { path: "/extension", name: "extension", component: () => import("./views/ExtensionView.vue") },
    { path: "/candidature", name: "letter-kit", component: () => import("./views/LetterKitView.vue") },
    { path: "/reglages", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/profil", name: "profile", component: () => import("./views/ProfileView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const loggedIn = await ensureSession();
  // Premier lancement : aucun compte → on le crée ; compte créé mais CV / profil pas faits → on les termine.
  if (!loggedIn && !hasAccount.value) return to.name === "welcome" ? true : { name: "welcome" };
  if (loggedIn && needsSetup.value) return to.name === "welcome" ? true : { name: "welcome" };
  if (to.name === "welcome") return loggedIn ? { name: "jobs" } : { name: "login" };
  if (!to.meta.public && !loggedIn) return { name: "login", query: { redirect: to.fullPath } };
  if (to.name === "login" && loggedIn) return { name: "jobs" };
});
