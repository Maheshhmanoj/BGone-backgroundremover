/**
 * MV3 service worker: context menu, notifications, download orchestration.
 * Heavy image work runs in offscreen.html (local @imgly/background-removal).
 */

importScripts("modes.js");

const OFFSCREEN_URL = "offscreen.html";
const DEFAULT_FILENAME = "image_no_bg.png";

const USE_API_FALLBACK = false;
const REMOVE_BG_API_KEY = "PASTE_YOUR_REMOVE_BG_API_KEY_HERE";

let keepAliveTimer = null;

// Recreate the menu whenever the service worker (re)starts. createQualityMenus
// calls removeAll first, so this is safe to run repeatedly.
createQualityMenus();

chrome.runtime.onInstalled.addListener(() => {
  createQualityMenus();
  setStatus("", "");
  warmupProcessor();
});

chrome.runtime.onStartup.addListener(() => {
  createQualityMenus();
  warmupProcessor();
});

async function warmupProcessor() {
  try {
    await setupOffscreenDocument();
    await chrome.runtime.sendMessage({ type: "PING_OFFSCREEN" });
  } catch (e) {
    console.warn("[bg-remover] Model warmup:", e?.message || e);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_PARENT || !info.srcUrl) return;
  const mode = modeFromMenuId(info.menuItemId);
  if (!mode) return;

  const imageUrl = info.srcUrl;
  const filename = buildFilename(imageUrl, tab?.url, mode.key);
  const started = performance.now();

  startKeepAlive();
  try {
    setStatus("…", `${mode.label} — ${mode.eta}`);
    await notify(
      `Removing background (${mode.label})…`,
      `${mode.eta} · ${mode.maxPx}px max · ${mode.model} model`
    );

    let savedPath;
    if (USE_API_FALLBACK) {
      savedPath = await downloadBlob(
        await removeBackgroundViaApi(imageUrl),
        filename
      );
    } else {
      const png = await removeBackgroundLocally(imageUrl, mode);
      savedPath = await downloadBase64Png(png.base64, filename, png.mimeType);
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setStatus("✓", `${seconds}s on ${lastBackend}`);
    await notify(
      `Done in ${seconds}s (${lastBackend})`,
      savedPath
        ? `Saved to:\n${savedPath}`
        : `Saved as ${filename}`
    );
  } catch (err) {
    console.error("[bg-remover]", err);
    setStatus("!", err?.message || "Failed");
    await notify(
      "Background removal failed",
      `${err?.message || err}\n\nTip: Open vivaldi://extensions → this extension → Service worker → Inspect, then try again.`,
      true
    );
  } finally {
    stopKeepAlive();
  }
});

function setStatus(badge, title) {
  chrome.action.setBadgeText({ text: badge || "" });
  if (badge) {
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  }
  chrome.action.setTitle({
    title: title
      ? `BG Remover — ${title}`
      : "Background-Removed PNG Downloader",
  });
}

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20_000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function buildFilename(imageUrl, pageUrl, modeKey = "balanced") {
  try {
    const path = new URL(imageUrl).pathname;
    const base = path.split("/").pop()?.split("?")[0] || "";
    const stem = base.replace(/\.[^.]+$/, "") || "image";
    const safe = stem.replace(/[^\w.-]+/g, "_").slice(0, 72) || "image";
    const tag = `${modeKey}_no_bg`;
    if (pageUrl && /pinterest\./i.test(pageUrl)) {
      return `pinterest_${safe}_${tag}.png`;
    }
    return `${safe}_${tag}.png`;
  } catch {
    return `image_${modeKey}_no_bg.png`;
  }
}

async function notify(title, message, isError = false) {
  const iconUrl = chrome.runtime.getURL("icons/icon128.png");
  const options = {
    type: "basic",
    title,
    message: message.slice(0, 240),
    priority: isError ? 2 : 1,
    requireInteraction: isError,
  };
  try {
    await chrome.notifications.create({ ...options, iconUrl });
    return;
  } catch (e) {
    console.warn("Notification with icon failed:", e);
  }
  try {
    await chrome.notifications.create(options);
  } catch (e) {
    console.warn("Notification failed:", e);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function downloadBase64Png(base64, filename, mimeType = "image/png") {
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Empty PNG data from processor");
  }
  const url = `data:${mimeType};base64,${base64}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });
  await waitForDownload(downloadId);
  const items = await chrome.downloads.search({ id: downloadId });
  return items[0]?.filename || filename;
}

async function downloadBlob(blob, filename) {
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return downloadBase64Png(base64, filename, blob.type || "image/png");
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      resolve();
    }, 120_000);

    function listener(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      }
      if (delta.error) {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(delta.error.current || "Download failed"));
      }
    }
    chrome.downloads.onChanged.addListener(listener);
  });
}

let creatingOffscreen = null;

async function setupOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["BLOBS"],
    justification: "Run local WASM/ONNX background removal on image blobs",
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function waitForOffscreenProcessor(maxMs = 30_000) {
  await setupOffscreenDocument();
  const deadline = Date.now() + maxMs;
  let lastError = "Processor not ready";
  while (Date.now() < deadline) {
    try {
      const reply = await chrome.runtime.sendMessage({ type: "PING_OFFSCREEN" });
      if (reply?.ready) return;
      lastError = reply?.error || "Processor not ready";
    } catch (e) {
      lastError = e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `${lastError}. Run "npm run build" in the extension folder, then reload the extension.`
  );
}

async function removeBackgroundLocally(imageUrl, mode) {
  const requestId = crypto.randomUUID();
  await waitForOffscreenProcessor();
  const ack = await chrome.runtime.sendMessage({
    type: "REMOVE_BACKGROUND",
    requestId,
    imageUrl,
    mode,
  });
  if (!ack) {
    throw new Error("No response from processor (offscreen document closed)");
  }
  if (ack.error) throw new Error(ack.error);
  if (!ack.base64) throw new Error("Empty PNG from processor");
  lastBackend = ack.backend || lastBackend;
  return { base64: ack.base64, mimeType: ack.mimeType || "image/png" };
}

let lastBackend = "?";

async function removeBackgroundViaApi(imageUrl) {
  if (!REMOVE_BG_API_KEY || REMOVE_BG_API_KEY.includes("PASTE_YOUR")) {
    throw new Error("Set REMOVE_BG_API_KEY in background.js for API mode");
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Could not fetch image (${imageResponse.status})`);
  }
  const imageBlob = await imageResponse.blob();

  const form = new FormData();
  form.append("image_file", imageBlob, "image.png");
  form.append("size", "auto");

  const apiResponse = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": REMOVE_BG_API_KEY },
    body: form,
  });

  if (!apiResponse.ok) {
    const text = await apiResponse.text().catch(() => "");
    throw new Error(`remove.bg error ${apiResponse.status}: ${text}`);
  }

  return apiResponse.blob();
}
