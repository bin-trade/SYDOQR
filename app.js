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
    try {
      const response = await fetch(`${apiUrl}?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      renderResult(payload);
    } catch (_) { showError("Vérification indisponible", "Impossible de joindre le registre DGDA. Vérifiez la connexion puis réessayez."); }
  }

  function renderResult(data) {
    const valid = data && data.valid === true && data.result === "VALID";
    const title = valid ? "Rapport valide" : data?.result === "REVOKED" ? "Rapport révoqué" : data?.result === "INVALID" ? "Rapport invalidé" : data?.result === "UNKNOWN" ? "Rapport introuvable" : "Rapport non conforme";
    const detail = valid ? "Ce rapport correspond à un enregistrement actif du registre DGDA." : data?.result === "UNKNOWN" ? "Aucun rapport correspondant n’a été trouvé." : "Les données du QR ne correspondent pas à la version actuellement enregistrée.";
    result.hidden = false; result.className = `result-card${valid ? "" : " invalid"}`;
    result.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="result-meta"><div><small>Code du rapport</small><strong>${escapeHtml(data?.report_id || "—")}</strong></div><div><small>Agence</small><strong>${escapeHtml(data?.agency_name || data?.agency_id || "—")}</strong></div><div><small>Bureau</small><strong>${escapeHtml(data?.bureau_code || "—")}</strong></div><div><small>Période</small><strong>${escapeHtml(data?.month || "—")}</strong></div><div><small>Statut</small><strong>${escapeHtml(data?.status || data?.result || "—")}</strong></div><div><small>Mis à jour</small><strong>${escapeHtml(data?.updated_at || "—")}</strong></div></div>`;
  }
  function showError(title, detail) { result.hidden = false; result.className = "result-card invalid"; result.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>`; }

  async function scanLoop() {
    if (!scanning || !detector) return;
    try { const codes = await detector.detect(video); if (codes.length && codes[0].rawValue && codes[0].rawValue !== lastRaw) { lastRaw = codes[0].rawValue; await verify(lastRaw); } } catch (_) {}
    if (scanning) requestAnimationFrame(scanLoop);
  }
  startButton.addEventListener("click", async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return message.textContent = "La caméra nécessite une connexion HTTPS.";
    if (!("BarcodeDetector" in window)) return message.textContent = "Ce navigateur ne propose pas le scan intégré. Utilisez la saisie manuelle du code du rapport.";
    try { detector = new BarcodeDetector({ formats: ["qr_code"] }); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); video.srcObject = stream; await video.play(); placeholder.hidden = true; scanning = true; startButton.hidden = true; stopButton.hidden = false; message.textContent = "Cadrez le code QR dans la zone."; scanLoop(); } catch (_) { message.textContent = "Caméra inaccessible. Autorisez-la ou utilisez la saisie manuelle."; }
  });
  stopButton.addEventListener("click", () => { stopCamera(); message.textContent = "Caméra arrêtée."; });
  form.addEventListener("submit", event => { event.preventDefault(); lastRaw = ""; verify(reportIdInput.value); });
  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstall = event; document.querySelector("#installButton").hidden = false; });
  document.querySelector("#installButton").addEventListener("click", async () => { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; document.querySelector("#installButton").hidden = true; } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
