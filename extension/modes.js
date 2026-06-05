/** Shared quality presets — ONNX model always runs at 1024px internally. */
const QUALITY_MODES = {
  fast: {
    key: "fast",
    label: "Fast",
    model: "small",
    maxPx: 512,
    refine: false,
    eta: "~6–10 sec",
  },
  balanced: {
    key: "balanced",
    label: "Balanced",
    model: "small",
    maxPx: 768,
    refine: true,
    eta: "~8–14 sec",
  },
  quality: {
    key: "quality",
    label: "Best quality",
    model: "medium",
    maxPx: 1280,
    refine: true,
    eta: "~15–35 sec",
  },
};

const MENU_PARENT = "bg-removed-parent";

function createQualityMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PARENT,
      title: "Download as Background-Removed PNG",
      contexts: ["image"],
    });
    for (const mode of Object.values(QUALITY_MODES)) {
      chrome.contextMenus.create({
        id: `bg-removed-${mode.key}`,
        parentId: MENU_PARENT,
        title: `${mode.label} (${mode.eta})`,
        contexts: ["image"],
      });
    }
  });
}

function modeFromMenuId(menuItemId) {
  if (!menuItemId?.startsWith("bg-removed-")) return null;
  const key = menuItemId.slice("bg-removed-".length);
  return QUALITY_MODES[key] || null;
}
