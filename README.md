# Background-Removed PNG Downloader

A Chromium/Vivaldi browser extension that adds a right-click menu on any image:
**"Download as Background-Removed PNG."** It removes the background locally in your
browser using AI (no servers, no uploads, no API keys) and saves a transparent PNG
to your Downloads folder. Optimized for Pinterest, works on any site.

- 🖱️ **Right-click any image** → get a clean transparent PNG
- 🔒 **100% local & private** — the image never leaves your machine
- ⚡ **GPU-accelerated** via WebGPU when available (falls back to CPU automatically)
- 🆓 **Free & unlimited** — no API keys, no monthly caps, no watermarks

> Powered by [transformers.js](https://github.com/huggingface/transformers.js) running
> the [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) model with ONNX Runtime Web.

---

## Requirements

- A Chromium-based browser: **Vivaldi, Chrome, Edge, Brave, or Opera** (Manifest V3).
- For GPU speed: **hardware acceleration enabled** (see [Performance](#performance)).
- Internet on **first use only** — the AI model (~44 MB) is downloaded once from
  Hugging Face and cached by the browser. After that it works offline.

---

## Install

### Option A — Easy (no tools needed)

1. Download this repo: **Code → Download ZIP**, then unzip it.
   (Or `git clone https://github.com/<your-username>/<your-repo>.git`)
2. Open your browser's extensions page:
   - Vivaldi: `vivaldi://extensions`
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the **`extension`** folder (the one with
   `manifest.json`).
5. Done. Right-click any image to use it.

The prebuilt files are committed, so no build step is required for this option.

### Option B — From source (for developers)

```bash
cd extension
npm install
npm run build
```

Then load the `extension` folder as an unpacked extension (steps 2–4 above).

---

## How to use

1. Right-click an image (e.g. on Pinterest).
2. Choose **Download as Background-Removed PNG**.
3. A notification shows progress, then **"Done in X.Xs"**.
4. The transparent PNG lands in your **Downloads** folder, e.g.
   `pinterest_pin123_no_bg.png`.

The first run is slower (it downloads the model and compiles GPU shaders once).
Later runs are fast.

---

## Performance

The extension uses your **GPU via WebGPU** when the browser exposes it, and
automatically falls back to **CPU (WASM)** otherwise. The completion notification
tells you which ran: `Done in X.Xs (webgpu)` or `(wasm)`.

**To get GPU speed, make sure hardware acceleration is on:**

1. Open settings, e.g. `vivaldi://settings/` (or `chrome://settings`).
2. Search **"hardware acceleration"** and enable
   **"Use hardware acceleration when available."**
3. **Fully restart the browser.**
4. Verify at `vivaldi://gpu` (or `chrome://gpu`) — the **WebGPU** line should say
   *"Hardware accelerated."*

If `vivaldi://gpu` shows everything as *"Software only,"* the GPU isn't being used by
the browser at all — enabling hardware acceleration fixes this.

---

## Privacy

Images are processed **entirely on your device**. Nothing is uploaded. The only
network request is a one-time download of the open-source AI model from Hugging Face
on first use (then cached). No telemetry, no accounts, no API keys.

---

## How it works

```
Right-click image
      │
      ▼
background.js (service worker)        ← context menu, notifications, download
      │  chrome.runtime message
      ▼
offscreen.html → dist/offscreen.js    ← runs in the extension's offscreen document
      │                                  (real origin → WebGPU adapters available)
      ├─ transformers.js + RMBG-1.4    ← AI background removal (WebGPU, CPU fallback)
      └─ local ONNX Runtime (dist/ort) ← extensions can't load remote scripts
      │
      ▼
Transparent PNG → chrome.downloads → your Downloads folder
```

| File | Role |
|------|------|
| `extension/manifest.json` | Manifest V3 config |
| `extension/background.js` | Service worker: menu, notifications, downloads |
| `extension/offscreen.html` + `dist/offscreen.js` | AI processing (built from `src/offscreen-processor.js`) |
| `extension/dist/ort/` | Locally bundled ONNX Runtime (wasm + loader) |
| `extension/modes.js` | Context-menu definitions |
| `extension/scripts/build.mjs` | Build script (esbuild + asset bundling) |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Menu item missing | Reload the extension; right-click directly on an image |
| Stuck / very slow first run | First use downloads the model (~44 MB) — wait, needs internet once |
| Always says `(wasm)`, never `(webgpu)` | Enable hardware acceleration and restart (see [Performance](#performance)) |
| "No available adapters" | Hardware acceleration is off in the browser — enable it |
| Nothing downloads | Check the extension's **service worker** console via the extensions page → Inspect |

---

## Tech stack

- **Manifest V3** Chromium extension
- [**transformers.js**](https://github.com/huggingface/transformers.js) (Hugging Face)
- [**RMBG-1.4**](https://huggingface.co/briaai/RMBG-1.4) background-removal model
- **ONNX Runtime Web** (WebGPU + WASM)
- **esbuild** for bundling

---

## License

The extension **code** in this repository is released under the [MIT License](LICENSE).

> ⚠️ **Important — model license:** This extension downloads and uses the
> **RMBG-1.4** model by BRIA AI, which is licensed for **non-commercial use** under
> [CC BY-NC 4.0](https://huggingface.co/briaai/RMBG-1.4). The model weights are **not**
> included in this repository; they are fetched from Hugging Face at runtime. If you
> intend to use background removal **commercially**, you must obtain a commercial
> license from [BRIA AI](https://bria.ai/) or swap in a model with suitable licensing.
