const DEFAULT_OPACITY = 0.22;
const DEFAULT_SCALE = 1;
const DEFAULT_ROTATION = 0;
const DEFAULT_TOAST_DURATION = 2000;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const TRACE_EDGE_THRESHOLD = 48;
const BACKGROUND_BRIGHTNESS_THRESHOLD = 236;
const BACKGROUND_COLOR_TOLERANCE = 18;
const PROCESSING_MAX_DIMENSION = 1600;

const state = {
  stream: null,
  videoTrack: null,
  overlayUrl: "",
  overlaySourceImage: null,
  opacity: DEFAULT_OPACITY,
  scale: DEFAULT_SCALE,
  rotation: DEFAULT_ROTATION,
  x: 0,
  y: 0,
  cameraFacingMode: "environment",
  userMirrorEnabled: false,
  locked: false,
  torchOn: false,
  torchSupported: false,
  wakeLock: null,
  activePanel: "uploadPanel",
  panelCollapsed: false,
  toastTimer: null,
  toastHideTimer: null,
  traceMode: false,
  reduceBackground: false,
};

const elements = {
  cameraFeed: document.getElementById("cameraFeed"),
  cameraFallback: document.getElementById("cameraFallback"),
  cameraMessage: document.getElementById("cameraMessage"),
  retryCameraButton: document.getElementById("retryCameraButton"),
  resetButton: document.getElementById("resetButton"),
  overlayWrapper: document.getElementById("overlayWrapper"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  overlayStage: document.getElementById("overlayStage"),
  imageInput: document.getElementById("imageInput"),
  controlPanel: document.getElementById("controlPanel"),
  panelTitle: document.getElementById("panelTitle"),
  panelMeta: document.getElementById("panelMeta"),
  panelToggleButton: document.getElementById("panelToggleButton"),
  statusText: document.getElementById("statusText"),
  toast: document.getElementById("toast"),
  opacityRange: document.getElementById("opacityRange"),
  opacityValue: document.getElementById("opacityValue"),
  scaleRange: document.getElementById("scaleRange"),
  scaleValue: document.getElementById("scaleValue"),
  rotateRange: document.getElementById("rotateRange"),
  rotateValue: document.getElementById("rotateValue"),
  lockButton: document.getElementById("lockButton"),
  mirrorButton: document.getElementById("mirrorButton"),
  torchButton: document.getElementById("torchButton"),
  traceModeButton: document.getElementById("traceModeButton"),
  backgroundReduceButton: document.getElementById("backgroundReduceButton"),
  toolButtons: [...document.querySelectorAll(".tool-button[data-panel]")],
  panelContents: [...document.querySelectorAll(".panel-content")],
};

const panelCopy = {
  uploadPanel: {
    title: "Upload an image to begin",
    meta: "Choose a reference and line it up over your paper.",
  },
  opacityPanel: {
    title: "Opacity control",
    meta: "Keep the guide faint so the paper texture and pencil tip stay clear.",
  },
  tracePanel: {
    title: "Trace treatment",
    meta: "Switch to line art and soften white backgrounds for cleaner tracing.",
  },
  scalePanel: {
    title: "Scale control",
    meta: "Resize the reference image until it matches your page.",
  },
  rotatePanel: {
    title: "Rotation control",
    meta: "Rotate the overlay to line up with your paper orientation.",
  },
};

const gestureState = {
  pointers: new Map(),
  mode: null,
  dragPointerId: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  startScale: DEFAULT_SCALE,
  startRotation: DEFAULT_ROTATION,
  startDistance: 0,
  startAngle: 0,
  startMidpoint: null,
};

async function init() {
  bindEvents();
  syncControls();
  updateOverlayTransform();
  showToast("Starting camera…", { duration: 1200 });
  await startCamera();
  requestWakeLock();
}

function bindEvents() {
  elements.retryCameraButton.addEventListener("click", startCamera);
  elements.resetButton.addEventListener("click", resetApp);
  elements.panelToggleButton.addEventListener("click", togglePanelCollapsed);
  elements.imageInput.addEventListener("change", handleImageUpload);

  elements.opacityRange.addEventListener("input", (event) => {
    state.opacity = Number(event.target.value) / 100;
    updateOverlayTransform();
    syncControls();
  });

  elements.scaleRange.addEventListener("input", (event) => {
    state.scale = clamp(Number(event.target.value) / 100, MIN_SCALE, MAX_SCALE);
    updateOverlayTransform();
    syncControls();
  });

  elements.rotateRange.addEventListener("input", (event) => {
    state.rotation = Number(event.target.value);
    updateOverlayTransform();
    syncControls();
  });

  elements.traceModeButton.addEventListener("click", () => {
    state.traceMode = !state.traceMode;
    reprocessOverlay();
    syncControls();
    showToast(state.traceMode ? "Trace Mode enabled." : "Trace Mode disabled.");
  });

  elements.backgroundReduceButton.addEventListener("click", () => {
    state.reduceBackground = !state.reduceBackground;
    reprocessOverlay();
    syncControls();
    showToast(
      state.reduceBackground ? "White background reduction enabled." : "White background reduction disabled."
    );
  });

  elements.toolButtons.forEach((button) => {
    button.addEventListener("click", () => setActivePanel(button.dataset.panel, true));
  });

  elements.lockButton.addEventListener("click", toggleLock);
  elements.mirrorButton.addEventListener("click", toggleMirror);
  elements.torchButton.addEventListener("click", toggleTorch);

  elements.overlayWrapper.addEventListener("pointerdown", beginGesture);
  elements.overlayWrapper.addEventListener("pointermove", handleGestureMove);
  elements.overlayWrapper.addEventListener("pointerup", endGesture);
  elements.overlayWrapper.addEventListener("pointercancel", endGesture);
  elements.overlayWrapper.addEventListener("pointerleave", endGesture);

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await requestWakeLock();
    }
  });
}

async function startCamera() {
  stopCamera();
  hideCameraFallback();
  showToast("Requesting rear camera…", { duration: 1200 });

  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraFallback(
      "This browser does not support live camera access. Open the app in a current version of Safari or Chrome on your phone."
    );
    showToast("Camera API unavailable", { duration: 2200 });
    return;
  }

  const constraintsOptions = [
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    {
      audio: false,
      video: {
        facingMode: "environment",
      },
    },
    { audio: false, video: true },
  ];

  try {
    let stream = null;

    for (const constraints of constraintsOptions) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (error) {
        if (error.name === "NotAllowedError" || error.name === "SecurityError") {
          throw error;
        }
      }
    }

    if (!stream) {
      throw new Error("Unable to access a compatible camera stream.");
    }

    state.stream = stream;
    state.videoTrack = stream.getVideoTracks()[0] || null;
    updateCameraFacingMode();
    updateCameraPreviewTransform();
    elements.cameraFeed.srcObject = stream;

    try {
      await elements.cameraFeed.play();
    } catch (error) {
      console.warn("Video playback could not start automatically:", error);
    }

    await detectTorchSupport();
    showToast("Camera ready. Upload an image to start tracing.");
  } catch (error) {
    console.error("Camera start failed:", error);
    handleCameraError(error);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }

  state.stream = null;
  state.videoTrack = null;
  state.cameraFacingMode = "environment";
  state.torchOn = false;
  state.torchSupported = false;
  elements.cameraFeed.srcObject = null;
  updateCameraPreviewTransform();
  syncControls();
}

function handleCameraError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    showCameraFallback(
      "Camera access was denied. Allow camera permission in your browser settings, then tap Enable Camera."
    );
    showToast("Camera permission denied", { duration: 2200 });
    return;
  }

  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    showCameraFallback(
      "No rear camera was found. Try another device or switch to a browser with camera support."
    );
    showToast("No compatible camera found", { duration: 2200 });
    return;
  }

  showCameraFallback(
    "The camera could not start. Make sure the page is loaded over HTTPS or on localhost and try again."
  );
  showToast("Unable to start camera", { duration: 2200 });
}

function showCameraFallback(message) {
  elements.cameraMessage.textContent = message;
  elements.cameraFallback.classList.remove("hidden");
}

function hideCameraFallback() {
  elements.cameraFallback.classList.add("hidden");
}

async function detectTorchSupport() {
  if (!state.videoTrack || typeof state.videoTrack.getCapabilities !== "function") {
    state.torchSupported = false;
    syncControls();
    return;
  }

  try {
    const capabilities = state.videoTrack.getCapabilities();
    state.torchSupported = Boolean(capabilities.torch);
  } catch (error) {
    console.warn("Torch capability check failed:", error);
    state.torchSupported = false;
  }

  syncControls();
}

function updateCameraFacingMode() {
  const facingMode = state.videoTrack?.getSettings?.().facingMode;
  state.cameraFacingMode = facingMode === "user" ? "user" : "environment";
}

function updateCameraPreviewTransform() {
  const shouldMirrorPreview = state.userMirrorEnabled || state.cameraFacingMode === "user";
  elements.cameraFeed.classList.toggle("is-mirrored", shouldMirrorPreview);
}

async function toggleTorch() {
  if (!state.videoTrack || !state.torchSupported) {
    showToast("Flashlight control is not supported on this device/browser.");
    return;
  }

  const nextTorchState = !state.torchOn;

  try {
    await state.videoTrack.applyConstraints({
      advanced: [{ torch: nextTorchState }],
    });
    state.torchOn = nextTorchState;
    syncControls();
    showToast(state.torchOn ? "Flashlight enabled." : "Flashlight disabled.");
  } catch (error) {
    console.error("Torch toggle failed:", error);
    showToast("Flashlight control is unavailable for the current camera session.");
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch (error) {
    console.warn("Wake lock is unavailable:", error);
    showToast("Screen sleep prevention is unavailable here, so keep the display awake manually if needed.", {
      duration: 2600,
    });
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) {
    return;
  }

  try {
    await state.wakeLock.release();
  } catch (error) {
    console.warn("Wake lock release failed:", error);
  } finally {
    state.wakeLock = null;
  }
}

async function handleImageUpload(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  if (state.overlayUrl) {
    URL.revokeObjectURL(state.overlayUrl);
  }

  state.overlayUrl = URL.createObjectURL(file);
  state.opacity = DEFAULT_OPACITY;
  state.scale = DEFAULT_SCALE;
  state.rotation = DEFAULT_ROTATION;
  state.x = 0;
  state.y = 0;
  state.traceMode = true;
  state.reduceBackground = !file.type.includes("png");

  try {
    state.overlaySourceImage = await loadImage(state.overlayUrl);
    processOverlayImage();
    elements.overlayWrapper.classList.remove("hidden");
    updateOverlayTransform();
    syncControls();
    setActivePanel("tracePanel");
    showToast("Overlay ready in Trace Mode.");
  } catch (error) {
    console.error("Image upload failed:", error);
    showToast("That image could not be loaded.", { duration: 2400 });
  }
}

function reprocessOverlay() {
  if (!state.overlaySourceImage) {
    return;
  }

  processOverlayImage();
  updateOverlayTransform();
}

function processOverlayImage() {
  const sourceImage = state.overlaySourceImage;
  if (!sourceImage) {
    return;
  }

  const scaledSize = getProcessingSize(sourceImage.naturalWidth || sourceImage.width, sourceImage.naturalHeight || sourceImage.height);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = scaledSize.width;
  sourceCanvas.height = scaledSize.height;

  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceContext.clearRect(0, 0, scaledSize.width, scaledSize.height);
  sourceContext.drawImage(sourceImage, 0, 0, scaledSize.width, scaledSize.height);

  const sourceImageData = sourceContext.getImageData(0, 0, scaledSize.width, scaledSize.height);
  const processedImageData = state.traceMode
    ? buildTraceImageData(sourceImageData, scaledSize.width, scaledSize.height, state.reduceBackground)
    : buildSoftGuideImageData(sourceImageData, state.reduceBackground);

  const outputContext = elements.overlayCanvas.getContext("2d", { willReadFrequently: true });
  elements.overlayCanvas.width = scaledSize.width;
  elements.overlayCanvas.height = scaledSize.height;
  outputContext.clearRect(0, 0, scaledSize.width, scaledSize.height);
  outputContext.putImageData(processedImageData, 0, 0);
}

function buildSoftGuideImageData(sourceImageData, reduceBackground) {
  const output = new ImageData(
    new Uint8ClampedArray(sourceImageData.data),
    sourceImageData.width,
    sourceImageData.height
  );
  const { data } = output;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];

    const luminance = getLuminance(red, green, blue);
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const hasNearWhiteBackground =
      reduceBackground &&
      luminance >= BACKGROUND_BRIGHTNESS_THRESHOLD &&
      chroma <= BACKGROUND_COLOR_TOLERANCE;

    const grayscale = Math.round(luminance * 0.72 + 48);

    data[index] = grayscale;
    data[index + 1] = grayscale;
    data[index + 2] = grayscale;
    data[index + 3] = hasNearWhiteBackground ? 0 : Math.round(alpha * 0.52);
  }

  return output;
}

function buildTraceImageData(sourceImageData, width, height, reduceBackground) {
  const luminance = new Float32Array(width * height);
  const outputData = new Uint8ClampedArray(sourceImageData.data.length);
  const source = sourceImageData.data;

  for (let index = 0, pixel = 0; index < source.length; index += 4, pixel += 1) {
    luminance[pixel] = getLuminance(source[index], source[index + 1], source[index + 2]);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const dataIndex = pixelIndex * 4;
      const edgeStrength = getEdgeStrength(luminance, width, height, x, y);
      const sourceAlpha = source[dataIndex + 3];
      const nearWhiteBackground =
        reduceBackground &&
        luminance[pixelIndex] >= BACKGROUND_BRIGHTNESS_THRESHOLD &&
        getChroma(source[dataIndex], source[dataIndex + 1], source[dataIndex + 2]) <= BACKGROUND_COLOR_TOLERANCE;

      if (nearWhiteBackground || sourceAlpha === 0) {
        outputData[dataIndex] = 0;
        outputData[dataIndex + 1] = 0;
        outputData[dataIndex + 2] = 0;
        outputData[dataIndex + 3] = 0;
        continue;
      }

      const edgeAlpha = clamp((edgeStrength - TRACE_EDGE_THRESHOLD) * 3.4, 0, 255);
      const toneFallback = clamp((170 - luminance[pixelIndex]) * 0.22, 0, 40);
      const finalAlpha = Math.max(edgeAlpha, toneFallback);
      const lineTone = edgeAlpha > 0 ? 18 : 40;

      outputData[dataIndex] = lineTone;
      outputData[dataIndex + 1] = lineTone;
      outputData[dataIndex + 2] = lineTone;
      outputData[dataIndex + 3] = Math.round(finalAlpha * (sourceAlpha / 255));
    }
  }

  return new ImageData(outputData, width, height);
}

function getEdgeStrength(luminance, width, height, x, y) {
  const a00 = getLuminanceAt(luminance, width, height, x - 1, y - 1);
  const a01 = getLuminanceAt(luminance, width, height, x, y - 1);
  const a02 = getLuminanceAt(luminance, width, height, x + 1, y - 1);
  const a10 = getLuminanceAt(luminance, width, height, x - 1, y);
  const a12 = getLuminanceAt(luminance, width, height, x + 1, y);
  const a20 = getLuminanceAt(luminance, width, height, x - 1, y + 1);
  const a21 = getLuminanceAt(luminance, width, height, x, y + 1);
  const a22 = getLuminanceAt(luminance, width, height, x + 1, y + 1);

  const gradientX = -a00 + a02 - 2 * a10 + 2 * a12 - a20 + a22;
  const gradientY = a00 + 2 * a01 + a02 - a20 - 2 * a21 - a22;
  return Math.sqrt(gradientX * gradientX + gradientY * gradientY);
}

function getLuminanceAt(luminance, width, height, x, y) {
  const clampedX = clamp(Math.round(x), 0, width - 1);
  const clampedY = clamp(Math.round(y), 0, height - 1);
  return luminance[clampedY * width + clampedX];
}

function getProcessingSize(width, height) {
  const largestDimension = Math.max(width, height);
  if (largestDimension <= PROCESSING_MAX_DIMENSION) {
    return { width, height };
  }

  const scale = PROCESSING_MAX_DIMENSION / largestDimension;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function updateOverlayTransform() {
  elements.overlayCanvas.style.opacity = String(state.opacity);
  elements.overlayCanvas.style.filter = state.traceMode ? "blur(0.2px)" : "saturate(0.75) brightness(1.08)";
  elements.overlayWrapper.style.transform = `translate(calc(-50% + ${state.x}px), calc(-50% + ${state.y}px)) rotate(${state.rotation}deg) scale(${state.scale})`;
  elements.overlayWrapper.classList.toggle("is-locked", state.locked);
}

function syncControls() {
  elements.opacityRange.value = String(Math.round(state.opacity * 100));
  elements.opacityValue.value = `${Math.round(state.opacity * 100)}%`;

  elements.scaleRange.value = String(Math.round(state.scale * 100));
  elements.scaleValue.value = `${Math.round(state.scale * 100)}%`;

  elements.rotateRange.value = String(Math.round(normalizeRotation(state.rotation)));
  elements.rotateValue.value = `${Math.round(normalizeRotation(state.rotation))}°`;

  elements.lockButton.setAttribute("aria-pressed", String(state.locked));
  elements.lockButton.classList.toggle("is-active", state.locked);
  elements.lockButton.querySelector("span").textContent = state.locked ? "Unlock" : "Lock";

  elements.mirrorButton.setAttribute("aria-pressed", String(state.userMirrorEnabled));
  elements.mirrorButton.classList.toggle("is-active", state.userMirrorEnabled);

  elements.torchButton.disabled = !state.torchSupported;
  elements.torchButton.setAttribute("aria-pressed", String(state.torchOn));
  elements.torchButton.classList.toggle("is-active", state.torchOn);

  elements.traceModeButton.setAttribute("aria-pressed", String(state.traceMode));
  elements.traceModeButton.classList.toggle("is-active", state.traceMode);

  elements.backgroundReduceButton.setAttribute("aria-pressed", String(state.reduceBackground));
  elements.backgroundReduceButton.classList.toggle("is-active", state.reduceBackground);

  elements.controlPanel.classList.toggle("is-collapsed", state.panelCollapsed);
  elements.panelToggleButton.setAttribute("aria-expanded", String(!state.panelCollapsed));
  elements.panelToggleButton.textContent = state.panelCollapsed ? "Show" : "Hide";
}

function setActivePanel(panelId, openPicker = false) {
  state.activePanel = panelId;
  state.panelCollapsed = false;

  elements.toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.panel === panelId);
  });

  elements.panelContents.forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === panelId);
  });

  const copy = panelCopy[panelId];
  if (copy) {
    elements.panelTitle.textContent = copy.title;
    elements.panelMeta.textContent = copy.meta;
  }

  syncControls();

  if (panelId === "uploadPanel" && openPicker) {
    elements.imageInput.click();
  }
}

function togglePanelCollapsed() {
  state.panelCollapsed = !state.panelCollapsed;
  syncControls();
}

function toggleLock() {
  state.locked = !state.locked;
  updateOverlayTransform();
  syncControls();
  resetGestureState();
  showToast(state.locked ? "Overlay locked in place." : "Overlay unlocked.");
}

function toggleMirror() {
  state.userMirrorEnabled = !state.userMirrorEnabled;
  updateCameraPreviewTransform();
  syncControls();
  showToast(state.userMirrorEnabled ? "Manual camera mirroring enabled." : "Manual camera mirroring disabled.");
}

function beginGesture(event) {
  if (state.locked || elements.overlayWrapper.classList.contains("hidden")) {
    return;
  }

  event.preventDefault();
  elements.overlayWrapper.setPointerCapture(event.pointerId);
  gestureState.pointers.set(event.pointerId, pointFromEvent(event));

  if (gestureState.pointers.size === 1) {
    startDragGesture(event.pointerId, pointFromEvent(event));
    return;
  }

  if (gestureState.pointers.size === 2) {
    startTransformGesture();
  }
}

function handleGestureMove(event) {
  if (!gestureState.pointers.has(event.pointerId) || state.locked) {
    return;
  }

  event.preventDefault();
  gestureState.pointers.set(event.pointerId, pointFromEvent(event));

  if (gestureState.mode === "transform" && gestureState.pointers.size >= 2) {
    updateTransformGesture();
    return;
  }

  if (gestureState.mode === "drag" && gestureState.dragPointerId === event.pointerId) {
    updateDragGesture(pointFromEvent(event));
  }
}

function endGesture(event) {
  if (!gestureState.pointers.has(event.pointerId)) {
    return;
  }

  gestureState.pointers.delete(event.pointerId);

  if (gestureState.pointers.size >= 2) {
    startTransformGesture();
    return;
  }

  if (gestureState.pointers.size === 1) {
    const [pointerId, point] = [...gestureState.pointers.entries()][0];
    startDragGesture(pointerId, point);
    return;
  }

  resetGestureState();
}

function startDragGesture(pointerId, point) {
  gestureState.mode = "drag";
  gestureState.dragPointerId = pointerId;
  gestureState.startX = point.x;
  gestureState.startY = point.y;
  gestureState.originX = state.x;
  gestureState.originY = state.y;
}

function updateDragGesture(point) {
  state.x = gestureState.originX + (point.x - gestureState.startX);
  state.y = gestureState.originY + (point.y - gestureState.startY);
  updateOverlayTransform();
}

function startTransformGesture() {
  const [firstPoint, secondPoint] = getPointerPair();
  if (!firstPoint || !secondPoint) {
    return;
  }

  gestureState.mode = "transform";
  gestureState.dragPointerId = null;
  gestureState.startScale = state.scale;
  gestureState.startRotation = state.rotation;
  gestureState.originX = state.x;
  gestureState.originY = state.y;
  gestureState.startDistance = getDistance(firstPoint, secondPoint);
  gestureState.startAngle = getAngle(firstPoint, secondPoint);
  gestureState.startMidpoint = getMidpoint(firstPoint, secondPoint);
}

function updateTransformGesture() {
  const [firstPoint, secondPoint] = getPointerPair();
  if (!firstPoint || !secondPoint) {
    return;
  }

  const nextDistance = getDistance(firstPoint, secondPoint);
  const nextAngle = getAngle(firstPoint, secondPoint);
  const nextMidpoint = getMidpoint(firstPoint, secondPoint);

  if (gestureState.startDistance > 0) {
    state.scale = clamp(
      gestureState.startScale * (nextDistance / gestureState.startDistance),
      MIN_SCALE,
      MAX_SCALE
    );
  }

  state.rotation = normalizeRotation(
    gestureState.startRotation + radiansToDegrees(nextAngle - gestureState.startAngle)
  );
  state.x = gestureState.originX + (nextMidpoint.x - gestureState.startMidpoint.x);
  state.y = gestureState.originY + (nextMidpoint.y - gestureState.startMidpoint.y);

  updateOverlayTransform();
  syncControls();
}

function resetGestureState() {
  gestureState.mode = null;
  gestureState.dragPointerId = null;
  gestureState.pointers.clear();
}

function getPointerPair() {
  return [...gestureState.pointers.values()].slice(0, 2);
}

function pointFromEvent(event) {
  return { x: event.clientX, y: event.clientY };
}

function getDistance(firstPoint, secondPoint) {
  return Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
}

function getAngle(firstPoint, secondPoint) {
  return Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x);
}

function getMidpoint(firstPoint, secondPoint) {
  return {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getLuminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function getChroma(red, green, blue) {
  return Math.max(red, green, blue) - Math.min(red, green, blue);
}

function radiansToDegrees(radians) {
  return radians * (180 / Math.PI);
}

function normalizeRotation(value) {
  let normalized = value % 360;

  if (normalized > 180) {
    normalized -= 360;
  }

  if (normalized < -180) {
    normalized += 360;
  }

  return normalized;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function showToast(message, options = {}) {
  const { duration = DEFAULT_TOAST_DURATION } = options;

  clearTimeout(state.toastTimer);
  clearTimeout(state.toastHideTimer);
  elements.statusText.textContent = message;
  elements.toast.classList.remove("hidden");

  requestAnimationFrame(() => {
    elements.toast.classList.add("is-visible");
  });

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    state.toastHideTimer = window.setTimeout(() => {
      if (!elements.toast.classList.contains("is-visible")) {
        elements.toast.classList.add("hidden");
      }
    }, 220);
  }, duration);
}

async function resetApp() {
  if (state.overlayUrl) {
    URL.revokeObjectURL(state.overlayUrl);
  }

  state.overlayUrl = "";
  state.overlaySourceImage = null;
  state.opacity = DEFAULT_OPACITY;
  state.scale = DEFAULT_SCALE;
  state.rotation = DEFAULT_ROTATION;
  state.x = 0;
  state.y = 0;
  state.userMirrorEnabled = false;
  state.locked = false;
  state.torchOn = false;
  state.traceMode = false;
  state.reduceBackground = false;
  state.panelCollapsed = false;

  elements.imageInput.value = "";
  const overlayContext = elements.overlayCanvas.getContext("2d");
  overlayContext.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
  elements.overlayCanvas.width = 0;
  elements.overlayCanvas.height = 0;
  elements.overlayWrapper.classList.add("hidden");

  if (state.videoTrack && state.torchSupported) {
    try {
      await state.videoTrack.applyConstraints({ advanced: [{ torch: false }] });
    } catch (error) {
      console.warn("Torch reset failed:", error);
    }
  }

  resetGestureState();
  updateCameraPreviewTransform();
  updateOverlayTransform();
  syncControls();
  setActivePanel("uploadPanel");
  showToast("Reset complete.");
}

window.addEventListener("beforeunload", () => {
  stopCamera();
  releaseWakeLock();
  if (state.overlayUrl) {
    URL.revokeObjectURL(state.overlayUrl);
  }
});

init();
