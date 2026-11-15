(() => {
  const config = window.EXTRACTOR_QR_CONFIG || {};
  const apiUrl = String(config.reportsApiUrl || '').trim();
  const CACHE_KEY = 'dgda_qr_reports_v1';
  const CACHE_TIME_KEY = 'dgda_qr_reports_updated_at_v1';
  const video = document.querySelector('#camera');
  const scannerSection = document.querySelector('#scannerSection');
  const loadingSection = document.querySelector('#loadingSection');
  const placeholder = document.querySelector('#cameraPlaceholder');
  const startButton = document.querySelector('#startScan');
  const stopButton = document.querySelector('#stopScan');
  const refreshButton = document.querySelector('#refreshData');
  const cameraMessage = document.querySelector('#cameraMessage');
  const cacheState = document.querySelector('#cacheState');
  const resultDialog = document.querySelector('#resultDialog');
  const result = document.querySelector('#result');
  let stream = null, scanning = false, detector = null, useJsQr = false, lastRaw = '', lastTick = 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  let deferredInstall = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const normalise = value => String(value ?? '').trim().toUpperCase();
  const readCache = () => { try { const data = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); return Array.isArray(data) ? data : []; } catch (_) { return []; } };
  const lastUpdated = () => localStorage.getItem(CACHE_TIME_KEY) || '';
  const setCacheState = text => { cacheState.textContent = text; };
  const formatDate = value => { try { return new Intl.DateTimeFormat('fr-FR', {dateStyle:'short', timeStyle:'short'}).format(new Date(value)); } catch (_) { return value || '—'; } };

  function showLoading(show) { loadingSection.hidden = !show; if (show) { scannerSection.hidden = true; } }
  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null; scannerSection.hidden = true;
  }
  function vibrate() { if (navigator.vibrate) navigator.vibrate([120, 60, 180]); }

  function parsePayload(raw) {
    const text = String(raw || '').trim();
    try { const data = JSON.parse(text); return {id: data.report_id || data.reportId || '', data}; } catch (_) {}
    try { const url = new URL(text); const id = url.searchParams.get('report_id') || url.searchParams.get('id'); if (id) return {id, data:{}}; } catch (_) {}
    return {id: text.startsWith('EX-') ? text : '', data:{}};
  }

  async function refreshData() {
    if (!apiUrl) { setCacheState('Service DGDA non configuré.'); return; }
    refreshButton.disabled = true; setCacheState('Actualisation de la base DGDA…');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const url = `${apiUrl}?action=syncReports&_t=${Date.now()}`;
      const response = await fetch(url, {cache:'no-store', signal:ctl.signal});
      const payload = await response.json();
      if (!response.ok || payload.ok !== true || !Array.isArray(payload.reports)) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload.reports));
      const now = new Date().toISOString(); localStorage.setItem(CACHE_TIME_KEY, now);
      setCacheState(`${payload.reports.length} rapport(s) disponibles localement · dernière actualisation : ${formatDate(now)}`);
    } catch (error) {
      const cached = readCache(); const when = lastUpdated();
      setCacheState(cached.length ? `${cached.length} rapport(s) locaux · dernière actualisation : ${formatDate(when)}` : 'Base locale indisponible. Actualisez avec une connexion Internet.');
      console.error('[DGDA QR] actualisation :', error);
    } finally { clearTimeout(timer); refreshButton.disabled = false; }
  }

  function renderResult(data, valid, reason) {
    const title = valid ? 'Rapport authentique' : 'Vérification non aboutie';
    const detail = valid ? 'Le rapport correspond aux données conservées dans la base DGDA.' : (reason || 'Aucun rapport correspondant n’a été trouvé dans la base locale.');
    result.className = `result-card${valid ? '' : ' invalid'}`;
    result.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="result-meta"><div><small>Code du rapport</small><strong>${escapeHtml(data?.report_id || '—')}</strong></div><div><small>Agence</small><strong>${escapeHtml(data?.agency_name || data?.agency_id || '—')}</strong></div><div><small>Bureau</small><strong>${escapeHtml(data?.bureau_code || '—')}</strong></div><div><small>Période</small><strong>${escapeHtml(data?.month || '—')} ${escapeHtml(data?.report_year || '')}</strong></div><div><small>Statut</small><strong>${escapeHtml(data?.status || (valid ? 'VALID' : 'INCONNU'))}</strong></div><div><small>Actualisé le</small><strong>${escapeHtml(formatDate(lastUpdated()))}</strong></div></div>`;
    if (typeof resultDialog.showModal === 'function') resultDialog.showModal(); else resultDialog.setAttribute('open', '');
  }

  async function verifyLocally(raw) {
    showLoading(true);
    // Laisser le navigateur afficher l'écran de recherche, même si la base est locale.
    await new Promise(requestAnimationFrame);
    const parsed = parsePayload(raw); const reports = readCache();
    const found = reports.find(item => String(item.report_id || '') === String(parsed.id || ''));
    let valid = Boolean(found);
    if (valid) {
      for (const key of ['agency_id','bureau_code','month','control_code']) {
        if (parsed.data[key] !== undefined && normalise(parsed.data[key]) !== normalise(found[key])) valid = false;
      }
      if (normalise(found.status) !== 'VALID') valid = false;
    }
    showLoading(false);
    renderResult(found || {report_id: parsed.id}, valid, parsed.id ? 'Ce rapport n’est pas présent ou ne correspond pas aux données locales.' : 'Code QR non reconnu.');
  }

  function decodeWithJsQr() {
    if (!video.videoWidth || typeof window.jsQR !== 'function') return '';
    const width = 720, height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth));
    canvas.width = width; canvas.height = height; ctx.drawImage(video, 0, 0, width, height);
    const hit = window.jsQR(ctx.getImageData(0, 0, width, height).data, width, height, {inversionAttempts:'dontInvert'});
    return hit?.data || '';
  }
  async function scanLoop(now) {
    if (!scanning) return;
    try {
      let raw = '';
      if (!useJsQr && detector) { const codes = await detector.detect(video); raw = codes.length ? codes[0].rawValue : ''; }
      else if (now - lastTick > 120) { lastTick = now; raw = decodeWithJsQr(); }
      if (raw && raw !== lastRaw) { lastRaw = raw; vibrate(); stopCamera(); verifyLocally(raw); return; }
    } catch (error) { console.warn('[DGDA QR] lecture caméra :', error); }
    if (scanning) requestAnimationFrame(scanLoop);
  }

  startButton.addEventListener('click', async () => {
    if (!readCache().length) { setCacheState('Actualisez d’abord les données DGDA.'); await refreshData(); if (!readCache().length) return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { cameraMessage.textContent = 'La caméra nécessite HTTPS ou localhost.'; return; }
    try {
      detector = null; useJsQr = false;
      if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({formats:['qr_code']}); } catch (_) {} }
      if (!detector) { if (typeof window.jsQR !== 'function') throw new Error('Lecteur QR indisponible.'); useJsQr = true; }
      scannerSection.hidden = false; stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
      video.srcObject = stream; await video.play(); placeholder.hidden = true; scanning = true; lastRaw = ''; cameraMessage.textContent = 'Cadrez le code QR dans la zone.'; requestAnimationFrame(scanLoop);
    } catch (error) { stopCamera(); cameraMessage.textContent = error?.name === 'NotAllowedError' ? 'Accès à la caméra refusé.' : 'Caméra inaccessible.'; }
  });
  stopButton.addEventListener('click', stopCamera);
  refreshButton.addEventListener('click', refreshData);
  document.querySelector('#closeResult').addEventListener('click', () => resultDialog.close?.());
  window.addEventListener('beforeunload', stopCamera);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; document.querySelector('#installButton').hidden = false; });
  document.querySelector('#installButton').addEventListener('click', async () => { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; document.querySelector('#installButton').hidden = true; } });
  const cached = readCache();
  if (cached.length) setCacheState(`${cached.length} rapport(s) disponibles localement · dernière actualisation : ${formatDate(lastUpdated())}`);
  else refreshData();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('./service-worker.js', {updateViaCache:'none'}).catch(console.error);
})();
