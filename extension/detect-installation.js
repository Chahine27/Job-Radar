window.addEventListener("job-radar:check-extension", () => {
  window.dispatchEvent(new Event("job-radar:extension-installed"));
});
