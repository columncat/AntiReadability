// Popup logic for AntiReadability Extension

document.addEventListener("DOMContentLoaded", () => {
  // 1. Localize HTML elements
  const localizableElements = document.querySelectorAll('[data-i18n]');
  localizableElements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const translation = chrome.i18n.getMessage(key);
    if (translation) {
      element.innerHTML = translation;
    }
  });

  const btnActivate = document.getElementById("btn-activate-now");
  const errorNotice = document.getElementById("tab-error-notice");
  const radioButtons = document.querySelectorAll('input[name="default-mode"]');

  // 2. Load saved default mode from storage
  chrome.storage.local.get(["defaultMode"], (result) => {
    if (result.defaultMode) {
      const savedRadio = document.querySelector(`input[name="default-mode"][value="${result.defaultMode}"]`);
      if (savedRadio) {
        savedRadio.checked = true;
      }
    }
  });

  // 3. Save settings when default mode changes
  radioButtons.forEach(radio => {
    radio.addEventListener("change", (e) => {
      const mode = e.target.value;
      chrome.storage.local.set({ defaultMode: mode }, () => {
        console.log("Default mode set to:", mode);
      });
    });
  });

  // 4. Handle activation in the current active tab
  btnActivate.addEventListener("click", () => {
    errorNotice.style.display = "none";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;

      const activeTab = tabs[0];
      const url = activeTab.url || "";

      // Validate injected target tab (restricted by Chrome security on these protocols)
      if (
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("devtools://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:") ||
        url === ""
      ) {
        errorNotice.style.display = "block";
        errorNotice.textContent = chrome.i18n.getMessage("tab_error_system");
        return;
      }

      // First, try sending a ping to see if the script is already injected
      chrome.tabs.sendMessage(activeTab.id, { action: "ping" }, (response) => {
        if (chrome.runtime.lastError || !response || response.status !== "pong") {
          // If not loaded, inject content.js and content.css directly from popup script
          // to prevent activeTab permission revocation when popup window closes.
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ["content.js"]
          }).then(() => {
            return chrome.scripting.insertCSS({
              target: { tabId: activeTab.id },
              files: ["content.css"]
            });
          }).then(() => {
            // Send activate command to content script
            chrome.tabs.sendMessage(activeTab.id, { action: "activate" }, () => {
              window.close();
            });
          }).catch(err => {
            errorNotice.style.display = "block";
            errorNotice.textContent = chrome.i18n.getMessage("tab_error_load");
            console.error("Direct injection failed:", err);
          });
        } else {
          // Already injected, send activate command directly
          chrome.tabs.sendMessage(activeTab.id, { action: "activate" }, () => {
            window.close();
          });
        }
      });
    });
  });
});
