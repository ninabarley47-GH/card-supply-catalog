const VERSION_FILE_URL = "version.json";

export async function initializeVersionDisplay() {
  const container = document.querySelector("[data-app-version]");

  if (!container) {
    return;
  }

  const summary = container.querySelector("[data-version-summary]");
  const versionValue = container.querySelector("[data-version-value]");
  const buildValue = container.querySelector("[data-build-value]");
  const builtAtValue = container.querySelector("[data-built-at-value]");
  const commitValue = container.querySelector("[data-commit-value]");
  const cacheValue = container.querySelector("[data-cache-value]");
  const updateButton = container.querySelector("[data-check-for-updates]");
  const updateMessage = container.querySelector("[data-version-message]");

  try {
    const versionInfo = await loadVersionInfo();
    const cacheVersion = await getServiceWorkerVersion();

    summary.textContent = `Version ${versionInfo.version} · Build ${versionInfo.build}`;
    versionValue.textContent = versionInfo.version;
    buildValue.textContent = versionInfo.build;
    builtAtValue.textContent = formatBuildTime(versionInfo.builtAt);
    commitValue.textContent = versionInfo.commit || "unknown";
    cacheValue.textContent = cacheVersion;

    if (cacheVersion !== "unavailable" && cacheVersion !== `card-supply-catalog-${versionInfo.build}`) {
      container.dataset.updateAvailable = "true";
      updateMessage.textContent = "An update may be waiting. Check for updates to load it.";
    }
  } catch (error) {
    summary.textContent = "Version information unavailable";
  }

  updateButton?.addEventListener("click", async () => {
    updateButton.disabled = true;
    updateMessage.textContent = "Checking for updates...";

    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
      const latestVersion = await loadVersionInfo({ bypassCache: true });
      const displayedBuild = buildValue.textContent;

      if (latestVersion.build !== displayedBuild || registration?.waiting) {
        updateMessage.textContent = "Update available. Loading it now...";
        container.dataset.updateAvailable = "true";
        if (registration?.waiting) {
          navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
          registration.waiting.postMessage({ type: "catalog:activate-update" });
        } else {
          window.location.reload();
        }
      } else {
        updateMessage.textContent = "This is the latest deployed build.";
        delete container.dataset.updateAvailable;
      }
    } catch (error) {
      updateMessage.textContent = "The update check could not be completed.";
    } finally {
      updateButton.disabled = false;
    }
  });
}

async function loadVersionInfo(options = {}) {
  const response = await fetch(VERSION_FILE_URL, {
    cache: options.bypassCache ? "no-store" : "default"
  });

  if (!response.ok) {
    throw new Error("Version information could not be loaded.");
  }

  return await response.json();
}

function getServiceWorkerVersion() {
  const controller = navigator.serviceWorker?.controller;

  if (!controller) {
    return Promise.resolve("unavailable");
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve("unavailable"), 1500);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      resolve(event.data?.version || "unavailable");
    };
    controller.postMessage({ type: "catalog:get-service-worker-version" }, [channel.port2]);
  });
}

function formatBuildTime(value) {
  if (!value) {
    return "Local development build";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
