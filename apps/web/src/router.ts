import { createRouter, createWebHistory } from "vue-router";
import { ensureSession } from "./session";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/", name: "jobs", component: () => import("./views/DashboardView.vue") },
    { path: "/postule", name: "applications", component: () => import("./views/ApplicationsView.vue") },
    { path: "/ajouter", name: "add-job", component: () => import("./views/ManualJobView.vue") },
    { path: "/offres/:id", name: "job", component: () => import("./views/JobDetailView.vue"), props: true },
    { path: "/entreprises", name: "leads", component: () => import("./views/LeadsView.vue") },
    { path: "/entreprises/:id/candidature", name: "spontaneous", component: () => import("./views/SpontaneousView.vue"), props: true },
    { path: "/sources", name: "sources", component: () => import("./views/SourcesView.vue") },
    { path: "/candidature", name: "letter-kit", component: () => import("./views/LetterKitView.vue") },
    { path: "/profil", name: "profile", component: () => import("./views/ProfileView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const loggedIn = await ensureSession();
  if (!to.meta.public && !loggedIn) return { name: "login", query: { redirect: to.fullPath } };
  if (to.name === "login" && loggedIn) return { name: "jobs" };
});
