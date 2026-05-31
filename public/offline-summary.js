(() => {
  const storageKey = "treasuri:last-dashboard-summary";
  const fields = [
    "balance_as_of",
    "confidence",
    "confidence_note",
    "month",
    "projected_savings",
    "review_count",
    "safe_per_day",
    "safe_to_spend",
    "saved_at",
    "target_savings",
  ];

  function readSummary() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      const summary = JSON.parse(raw);
      if (!summary || typeof summary !== "object") {
        return null;
      }
      return fields.every((field) => Object.prototype.hasOwnProperty.call(summary, field))
        ? summary
        : null;
    } catch {
      localStorage.removeItem(storageKey);
      return null;
    }
  }

  function render() {
    const container = document.querySelector("[data-offline-summary]");
    if (!container) {
      return;
    }
    const summary = readSummary();
    if (!summary) {
      return;
    }
    for (const element of container.querySelectorAll("[data-offline-field]")) {
      const field = element.getAttribute("data-offline-field");
      element.textContent = field ? String(summary[field] ?? "") : "";
    }
    container.hidden = false;
    const empty = document.querySelector("[data-offline-empty]");
    if (empty) {
      empty.hidden = true;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
