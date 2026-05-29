(() => {
  const storageKey = "treasuri:last-dashboard-summary";
  const requiredFields = [
    "month",
    "safe_to_spend",
    "safe_per_day",
    "projected_savings",
    "target_savings",
    "confidence",
    "confidence_note",
    "review_count",
    "last_sync",
  ];

  function isSummary(value) {
    return (
      value &&
      typeof value === "object" &&
      requiredFields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
    );
  }

  function storeDashboardSummary() {
    const source = document.getElementById("treasuri-offline-summary");
    if (!source || !source.textContent) {
      return;
    }
    try {
      const summary = JSON.parse(source.textContent);
      if (!isSummary(summary)) {
        return;
      }
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          ...summary,
          saved_at: new Date().toISOString(),
        }),
      );
    } catch (_error) {
      localStorage.removeItem(storageKey);
    }
  }

  function readStoredSummary() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      const summary = JSON.parse(raw);
      return isSummary(summary) ? summary : null;
    } catch (_error) {
      localStorage.removeItem(storageKey);
      return null;
    }
  }

  function renderOfflineSummary() {
    const container = document.querySelector("[data-offline-summary]");
    if (!container) {
      return;
    }
    const summary = readStoredSummary();
    if (!summary) {
      return;
    }
    for (const element of container.querySelectorAll("[data-offline-field]")) {
      const field = element.getAttribute("data-offline-field");
      element.textContent = field && summary[field] !== undefined ? String(summary[field]) : "";
    }
    container.hidden = false;
    const emptyMessage = document.querySelector("[data-offline-empty]");
    if (emptyMessage) {
      emptyMessage.hidden = true;
    }
  }

  function ready() {
    storeDashboardSummary();
    renderOfflineSummary();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
})();
