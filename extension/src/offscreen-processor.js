/**
 * Offscreen processor (runs in the offscreen document = real extension origin,
 * so WebGPU adapters are available). Uses transformers.js + RMBG-1.4.
 *
 * No sandbox needed: transformers.js is eval-free; it only needs
 * 'wasm-unsafe-eval', which extension pages allow.
 */

import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "@huggingface/transformers";

// Fetch models/weights from the Hugging Face hub (cached after first run).
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = false;
// Extensions can't load remote scripts → use the locally bundled ONNX runtime.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("dist/ort/");

const MODEL_ID = "briaai/RMBG-1.4";
const PROCESSOR_CONFIG = {
  config: {
    do_normalize: true,
    do_pad: false,
    do_rescale: true,
    do_resize: true,
    image_mean: [0.5, 0.5, 0.5],
    feature_extractor_type: "ImageFeatureExtractor",
    image_std: [1, 1, 1],
    resample: 2,
    rescale_factor: 0.00392156862745098,
    size: { width: 1024, height: 1024 },
  },
};

let loadPromise = null;
let backend = "loading";
let model = null;
let processor = null;

async function detectWebGPU() {
  try {
    if (typeof navigator === "undefined" || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (e) {
    console.warn("[bg-remover] WebGPU adapter check failed:", e?.message || e);
    return false;
  }
}

async function loadModel() {
  processor = await AutoProcessor.from_pretrained(MODEL_ID, PROCESSOR_CONFIG);

  const device = (await detectWebGPU()) ? "webgpu" : "wasm";
  console.info("[bg-remover] Selected device:", device);

  model = await AutoModel.from_pretrained(MODEL_ID, {
    config: { model_type: "custom" },
    device,
    dtype: "fp32",
  });
  backend = device;
  console.info("[bg-remover] Model ready on backend:", backend);
  return backend;
}

function ensureLoaded() {
  if (!loadPromise) loadPromise = loadModel().catch((e) => {
    loadPromise = null;
    throw e;
  });
  return loadPromise;
}

async function removeBg(imageUrl) {
  await ensureLoaded();

  const image = await RawImage.fromURL(imageUrl);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });

  // output: [1,1,1024,1024] alpha logits in [0,1]; resize to source size.
  const mask = await RawImage.fromTensor(
    output[0].mul(255).to("uint8")
  ).resize(image.width, image.height);

  // Composite original RGB + predicted alpha → RGBA PNG.
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const rgba = image.rgba();
  const imgData = new ImageData(
    new Uint8ClampedArray(rgba.data),
    image.width,
    image.height
  );
  for (let i = 0; i < mask.data.length; i++) {
    imgData.data[i * 4 + 3] = mask.data[i];
  }
  ctx.putImageData(imgData, 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return { base64, mimeType: "image/png", backend };
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING_OFFSCREEN") {
    (async () => {
      try {
        const b = await ensureLoaded();
        sendResponse({ ready: true, backend: b });
      } catch (e) {
        sendResponse({ ready: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message?.type !== "REMOVE_BACKGROUND") return false;

  (async () => {
    try {
      const result = await removeBg(message.imageUrl);
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({ error: err?.message || String(err) });
    }
  })();
  return true;
});

// Warm up as soon as the document loads.
ensureLoaded().catch((e) =>
  console.error("[bg-remover] Model load failed:", e?.message || e)
);
