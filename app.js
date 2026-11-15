(() => {
  const config = window.EXTRACTOR_QR_CONFIG || {};
  const apiUrl = String(config.reportsApiUrl || "").trim();
  const video = document.querySelector("#camera");
  const frame = document.querySelector("#scannerFrame");
  const placeholder = document.querySelector("#cameraPlaceholder");
  const startButton = document.querySelector("#startScan");
  const stopButton = document.querySelector("#stopScan");
  const message = document.querySelector("#cameraMessage");
  const result = document.querySelector("#result");
  const form = document.querySelector("#manualForm");
  const reportIdInput = document.querySelector("#reportId");
  const connection = document.querySelector("#connectionState");
  let stream = null;
  let scanning = false;
  let detector = null;
  let useJsQr = false;
  const canvas = document.createElement("canvas");
  const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
  let lastTick = 0;
  let lastRaw = "";
  let deferredInstall = null;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  const stopCamera = () => { scanning = false; if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; startButton.hidden = false; stopButton.hidden = true; };

  function parsePayload(raw) {
    const text = String(raw || "").trim();
    try { const data = JSON.parse(text); return { id: data.report_id || data.reportId || "", data }; } catch (_) {}
    try { const url = new URL(text); const id = url.searchParams.get("report_id") || url.searchParams.get("id"); if (id) return { id, data: {} }; } catch (_) {}
    return { id: text.startsWith("EX-") ? text : "", data: {} };
  }

  async function verify(raw) {
    const parsed = parsePayload(raw);
    if (!parsed.id) return showError("QR non reconnu", "Le code scanné ne contient pas un identifiant de rapport EXTRACTOR.");
    if (!apiUrl) return showError("Service non configuré", "L’adresse de vérification n’est pas configurée.");
    result.hidden = false; result.className = "result-card"; result.innerHTML = "<h2>Vérification en cours…</h2><p>Recherche du rapport dans le registre DGDA.</p>";
    const params = new URLSearchParams({ action: "verifyReport", report_id: parsed.id });
    ["agency_id", "bureau_code", "control_code"].forEach(key => { if (parsed.data[key] !== undefined) params.set(key, parsed.data[key]); });
    if (parsed.data.month !== undefined || parsed.data.period !== undefined) params.set("month", parsed.data.month ?? parsed.data.period);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
    try {
      params.set("_t", String(Date.now()));   // évite tout cache ; aucun en-tête personnalisé => pas de pré-vérification CORS
      const response = await fetch(`${apiUrl}?${params.toString()}`, { method: "GET", redirect: "follow", signal: ctl.signal });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); }
      catch (e) {
        console.error("[QR] réponse non JSON (HTTP " + response.status + ") :", text.slice(0, 300));
        return showError("Réponse invalide", "Le service de vérification n’a pas renvoyé de JSON. Vérifiez l’URL /exec et que le déploiement Apps Script est à jour et public.");
      }
      if (!response.ok) { console.error("[QR] HTTP", response.status, payload); return showError("Vérification indisponible", "Le registre a répondu avec le statut HTTP " + response.status + "."); }
      renderResult(payload);
    } catch (e) {
      console.error("[QR] appel Apps Script impossible :", e);
      if (e && e.name === "AbortError") showError("Délai dépassé", "Le registre DGDA n’a pas répondu en 20 secondes. Réessayez.");
      else showError("Vérification indisponible", navigator.onLine ? "Impossible de joindre le registre DGDA (réseau, CORS ou déploiement non public). Détail : " + ((e && e.message) || e) : "Vous êtes hors connexion.");
    } finally { clearTimeout(timer); }
  }

  function renderResult(data) {
    const valid = data && data.valid === true && data.result === "VALID";
    const title = valid ? "Rapport valide" : data?.result === "REVOKED" ? "Rapport révoqué" : data?.result === "INVALID" ? "Rapport invalidé" : data?.result === "UNKNOWN" ? "Rapport introuvable" : "Rapport non conforme";
    const detail = valid ? "Ce rapport correspond à un enregistrement actif du registre DGDA." : data?.result === "UNKNOWN" ? "Aucun rapport correspondant n’a été trouvé." : "Les données du QR ne correspondent pas à la version actuellement enregistrée.";
    result.hidden = false; result.className = `result-card${valid ? "" : " invalid"}`;
    result.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="result-meta"><div><small>Code du rapport</small><strong>${escapeHtml(data?.report_id || "—")}</strong></div><div><small>Agence</small><strong>${escapeHtml(data?.agency_name || data?.agency_id || "—")}</strong></div><div><small>Bureau</small><strong>${escapeHtml(data?.bureau_code || "—")}</strong></div><div><small>Période</small><strong>${escapeHtml(data?.month || "—")}</strong></div><div><small>Statut</small><strong>${escapeHtml(data?.status || data?.result || "—")}</strong></div><div><small>Mis à jour</small><strong>${escapeHtml(data?.updated_at || "—")}</strong></div></div>`;
  }
  function showError(title, detail) { result.hidden = false; result.className = "result-card invalid"; result.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>`; }

  function decodeWithJsQr() {
    if (!video.videoWidth || typeof window.jsQR !== "function") return "";
    const w = 640, h = Math.max(1, Math.round(video.videoHeight * w / video.videoWidth));
    canvas.width = w; canvas.height = h;
    ctx2d.drawImage(video, 0, 0, w, h);
    const img = ctx2d.getImageData(0, 0, w, h);
    const hit = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
    return hit && hit.data ? hit.data : "";
  }
  async function scanLoop(now) {
    if (!scanning) return;
    try {
      let raw = "";
      if (!useJsQr && detector) { const codes = await detector.detect(video); raw = codes.length ? codes[0].rawValue : ""; }
      else if (now - lastTick > 120) { lastTick = now; raw = decodeWithJsQr(); }   // ~8 lectures/s en mode de secours
      if (raw && raw !== lastRaw) { lastRaw = raw; await verify(raw); }
    } catch (e) { console.warn("[QR] lecture de frame :", e); }
    if (scanning) requestAnimationFrame(scanLoop);
  }
  startButton.addEventListener("click", async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return message.textContent = "La caméra nécessite une connexion HTTPS (ou localhost).";
    try {
      if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); useJsQr = false; } catch (_) { detector = null; } }
      if (!detector) { if (typeof window.jsQR !== "function") return message.textContent = "Lecteur QR indisponible. Utilisez la saisie manuelle du code du rapport."; useJsQr = true; }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream; video.setAttribute("playsinline", ""); await video.play();
      placeholder.hidden = true; scanning = true; startButton.hidden = true; stopButton.hidden = false;
      message.textContent = "Cadrez le code QR dans la zone."; requestAnimationFrame(scanLoop);
    } catch (e) {
      console.error("[QR] caméra :", e); stopCamera();
      message.textContent = e && e.name === "NotAllowedError" ? "Accès à la caméra refusé. Autorisez-la dans le navigateur ou utilisez la saisie manuelle." : "Caméra inaccessible. Autorisez-la ou utilisez la saisie manuelle.";
    }
  });
  stopButton.addEventListener("click", () => { stopCamera(); message.textContent = "Caméra arrêtée."; });
  form.addEventListener("submit", event => { event.preventDefault(); lastRaw = ""; verify(reportIdInput.value); });
  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstall = event; document.querySelector("#installButton").hidden = false; });
  document.querySelector("#installButton").addEventListener("click", async () => { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; document.querySelector("#installButton").hidden = true; } });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    const had = Boolean(navigator.serviceWorker.controller); let done = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !done) { done = true; location.reload(); } });
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then(reg => {
      const chk = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (!document.hidden) chk(); }); setInterval(chk, 30 * 60 * 1000);
    }).catch(e => console.error("[QR] service worker non enregistré :", e));
  }
})();
