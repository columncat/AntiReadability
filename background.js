// Background script for AntiReadability Extension

// 1. Create context menu item on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "start-obfuscation",
    title: "민감 정보 난독화 시작",
    contexts: ["all"]
  });
});

// 2. Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "start-obfuscation" && tab && tab.id) {
    triggerObfuscation(tab.id);
  }
});

// 3. Listen for message from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "activate_in_tab" && request.tabId) {
    triggerObfuscation(request.tabId);
    sendResponse({ status: "initiated" });
  }
});

// Helper function to inject script and activate
function triggerObfuscation(tabId) {
  // First, ping the content script to check if it's already loaded
  chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
    // If runtime.lastError occurs, it means the script is not loaded or tab is loading
    if (chrome.runtime.lastError || !response || response.status !== "pong") {
      // Content script is not injected yet, inject script and CSS
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      }).then(() => {
        return chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ["content.css"]
        });
      }).then(() => {
        // Send activate command to content script
        chrome.tabs.sendMessage(tabId, { action: "activate" });
      }).catch(err => {
        console.error("Failed to inject content script or CSS:", err);
      });
    } else {
      // Content script is already injected, send activate command
      chrome.tabs.sendMessage(tabId, { action: "activate" });
    }
  });
}
