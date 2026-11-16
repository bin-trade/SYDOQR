(() => {
  const config = window.EXTRACTOR_QR_CONFIG || {};
  const apiUrl = String(config.reportsApiUrl || '').trim();
  const CACHE_KEY = 'dgda_qr_reports_v1';
  const CACHE_TIME_KEY = 'dgda_qr_reports_updated_at_v1';
  const video = document.querySelector('#camera');
  const scanDialog = document.querySelector('#scanDialog');
  const scannerSection = document.querySelector('#scannerSection');
  const loadingSection = document.querySelector('#loadingSection');
  const placeholder = document.querySelector('#cameraPlaceholder');
  const startButton = document.querySelector('#startScan');
  const stopButton = document.querySelector('#stopScan');
  const refreshButton = document.querySelector('#refreshData');
  const yearSelect = document.querySelector('#yearSelect');
  const monthSelect = document.querySelector('#monthSelect');
  const bureauInput = document.querySelector('#bureauInput');
  const bureauSuggestions = document.querySelector('#bureauSuggestions');
  const bureauLocation = document.querySelector('#bureauLocation');
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
  const BUREAUX_KEY = 'dgda_qr_bureaux_v1';
  const readBureaux = () => { try { const data = JSON.parse(localStorage.getItem(BUREAUX_KEY) || '[]'); return Array.isArray(data) ? data : []; } catch (_) { return []; } };
  const bureauMatch = () => readBureaux().find(item => normalise(item.bureau_code) === normalise(bureauInput.value));
  function renderBureaux(items) {
    const unique = new Map();
    (items || []).forEach(item => { if (item?.bureau_code) unique.set(normalise(item.bureau_code), {bureau_code:String(item.bureau_code).toUpperCase(), location:String(item.location || '')}); });
    const bureaux = [...unique.values()].sort((a, b) => a.bureau_code.localeCompare(b.bureau_code));
    localStorage.setItem(BUREAUX_KEY, JSON.stringify(bureaux));
    bureauSuggestions.replaceChildren(...bureaux.map(item => { const option = document.createElement('option'); option.value = item.bureau_code; option.label = item.location ? `${item.bureau_code} — ${item.location}` : item.bureau_code; return option; }));
    updateBureauLocation();
  }
  function updateBureauLocation() {
    const item = bureauMatch();
    bureauLocation.textContent = item ? `Lieu associé : ${item.location || 'non renseigné'}` : 'Saisissez ou choisissez un bureau proposé.';
    bureauLocation.classList.toggle('selected', Boolean(item));
  }
  const setCacheState = text => { cacheState.textContent = text; };
  const formatDate = value => { try { return new Intl.DateTimeFormat('fr-FR', {dateStyle:'short', timeStyle:'short'}).format(new Date(value)); } catch (_) { return value || '—'; } };

  function showLoading(show) { loadingSection.hidden = !show; }
  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null; scannerSection.hidden = true;
    if (scanDialog?.open) scanDialog.close();
  }
  function vibrate() { if (navigator.vibrate) navigator.vibrate([120, 60, 180]); }

  function parsePayload(raw) {
    const text = String(raw || '').trim();
    try {
      const rawData = JSON.parse(text);
      const id = rawData.report_id || rawData.reportId || rawData.i || '';
      // Accepte le nouveau QR compact et les anciens QR détaillés.
      const data = {
        ...rawData,
        report_id: id,
        agency_id: rawData.agency_id ?? rawData.a ?? '',
        bureau_code: rawData.bureau_code ?? rawData.b ?? '',
        location: rawData.location ?? rawData.l ?? '',
        month: rawData.month ?? rawData.period ?? rawData.m ?? '',
        report_year: rawData.report_year ?? rawData.y ?? '',
        control_code: rawData.control_code ?? rawData.c ?? '',
      };
      return {id, data};
    } catch (_) {}
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
      renderBureaux(payload.bureaux || payload.reports.map(item => ({bureau_code:item.bureau_code, location:item.location})));
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
    result.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="result-meta"><div><small>Code du rapport</small><strong>${escapeHtml(data?.report_id || '—')}</strong></div><div><small>Agence</small><strong>${escapeHtml(data?.agency_name || data?.agency_id || '—')}</strong></div><div><small>Bureau</small><strong>${escapeHtml(data?.bureau_code || '—')}</strong></div><div><small>Lieu</small><strong>${escapeHtml(data?.location || '—')}</strong></div><div><small>Période</small><strong>${escapeHtml(data?.month || '—')} ${escapeHtml(data?.report_year || '')}</strong></div><div><small>Statut</small><strong>${escapeHtml(data?.status || (valid ? 'VALID' : 'INCONNU'))}</strong></div><div><small>Actualisé le</small><strong>${escapeHtml(formatDate(lastUpdated()))}</strong></div></div>`;
    if (typeof resultDialog.showModal === 'function') resultDialog.showModal(); else resultDialog.setAttribute('open', '');
  }

  async function verifyLocally(raw) {
    showLoading(true);
    // Laisser le navigateur afficher l'écran de recherche, même si la base est locale.
    await new Promise(requestAnimationFrame);
    const parsed = parsePayload(raw); const reports = readCache();
    const found = reports.find(item => String(item.report_id || '') === String(parsed.id || ''));
    const selectedBureau = bureauMatch();
    let valid = Boolean(found);
    if (valid) {
      for (const key of ['agency_id','bureau_code','location','month','report_year','control_code']) {
        if (!parsed.data[key] || normalise(parsed.data[key]) !== normalise(found[key])) valid = false;
      }
      if (normalise(monthSelect.value) !== normalise(parsed.data.month) || normalise(monthSelect.value) !== normalise(found.month)) valid = false;
      if (normalise(yearSelect.value) !== normalise(parsed.data.report_year) || normalise(yearSelect.value) !== normalise(found.report_year)) valid = false;
      if (!selectedBureau || normalise(selectedBureau.bureau_code) !== normalise(parsed.data.bureau_code) || normalise(selectedBureau.bureau_code) !== normalise(found.bureau_code) || normalise(selectedBureau.location) !== normalise(parsed.data.location) || normalise(selectedBureau.location) !== normalise(found.location)) valid = false;
      if (normalise(found.status) !== 'VALID') valid = false;
    }
    showLoading(false);
    const periodMismatch = found && (normalise(monthSelect.value) !== normalise(parsed.data.month) || normalise(yearSelect.value) !== normalise(parsed.data.report_year));
    renderResult(found || {report_id: parsed.id}, valid, periodMismatch ? 'Le mois ou l’année choisis ne correspondent pas au rapport.' : (parsed.id ? 'Ce rapport n’est pas présent ou ne correspond pas aux données locales.' : 'Code QR non reconnu.'));
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
    if (!yearSelect.value || !monthSelect.value) { setCacheState('Sélectionnez d’abord l’année et le mois du rapport.'); return; }
    if (!readCache().length) { setCacheState('Actualisez d’abord les données DGDA.'); await refreshData(); if (!readCache().length) return; }
    if (!bureauMatch()) { setCacheState('Choisissez un bureau proposé avant de vérifier.'); bureauInput.focus(); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { cameraMessage.textContent = 'La caméra nécessite HTTPS ou localhost.'; return; }
    try {
      detector = null; useJsQr = false;
      if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({formats:['qr_code']}); } catch (_) {} }
      if (!detector) { if (typeof window.jsQR !== 'function') throw new Error('Lecteur QR indisponible.'); useJsQr = true; }
      scannerSection.hidden = false; if (typeof scanDialog.showModal === 'function') scanDialog.showModal(); else scanDialog.setAttribute('open', '');
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
      video.srcObject = stream; await video.play(); placeholder.hidden = true; scanning = true; lastRaw = ''; cameraMessage.textContent = 'Cadrez le code QR dans la zone.'; requestAnimationFrame(scanLoop);
    } catch (error) { stopCamera(); cameraMessage.textContent = error?.name === 'NotAllowedError' ? 'Accès à la caméra refusé.' : 'Caméra inaccessible.'; }
  });
  stopButton.addEventListener('click', stopCamera);
  refreshButton.addEventListener('click', refreshData);
  document.querySelector('#closeResult').addEventListener('click', () => resultDialog.close?.());
  window.addEventListener('beforeunload', stopCamera);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; document.querySelector('#installButton').hidden = false; });
  document.querySelector('#installButton').addEventListener('click', async () => { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; document.querySelector('#installButton').hidden = true; } });
  const months = ['JANVIER','FEVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOUT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DECEMBRE'];
  const now = new Date();
  for (let year = now.getFullYear() - 1; year <= now.getFullYear() + 2; year++) yearSelect.add(new Option(String(year), String(year)));
  months.forEach(month => monthSelect.add(new Option(month, month)));
  yearSelect.value = String(now.getFullYear());
  monthSelect.value = months[now.getMonth()];
  bureauInput.addEventListener('input', updateBureauLocation);
  renderBureaux(readBureaux());
  const cached = readCache();
  if (cached.length) setCacheState(`${cached.length} rapport(s) disponibles localement · dernière actualisation : ${formatDate(lastUpdated())}`);
  else refreshData();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('./service-worker.js', {updateViaCache:'none'}).catch(console.error);
})();
