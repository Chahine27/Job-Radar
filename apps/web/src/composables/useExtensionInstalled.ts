import { onMounted, onUnmounted, ref } from "vue";

const CHECK_EVENT = "job-radar:check-extension";
const INSTALLED_EVENT = "job-radar:extension-installed";
const CHECK_TIMEOUT_MS = 700;

export function useExtensionInstalled() {
  const installed = ref(false);
  let timeoutId: number | undefined;
  let disposed = false;

  function detect() {
    if (disposed) return;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    installed.value = false;
    timeoutId = window.setTimeout(() => {
      timeoutId = undefined;
    }, CHECK_TIMEOUT_MS);
    window.dispatchEvent(new Event(CHECK_EVENT));
  }

  function onInstalled() {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    timeoutId = undefined;
    installed.value = true;
  }

  onMounted(() => {
    disposed = false;
    window.addEventListener(INSTALLED_EVENT, onInstalled);
    window.addEventListener("pageshow", detect);
    window.addEventListener("focus", detect);
    detect();
  });

  onUnmounted(() => {
    disposed = true;
    window.removeEventListener(INSTALLED_EVENT, onInstalled);
    window.removeEventListener("pageshow", detect);
    window.removeEventListener("focus", detect);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });

  return installed;
}
