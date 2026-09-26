import { escapeHtml } from './dom';
import { mountThinkingOrb } from './thinking-orb';

export const defenderResultLabels: Record<DefenderScanLog['result'], string> = {
  clean: 'No threats detected',
  threat: 'Threat detected',
  remediated: 'Remediation confirmed',
  failed: 'Scan failed',
  incomplete: 'Scan incomplete / cancelled',
};

type ErrorTarget = 'scan' | 'auto' | 'notifications' | 'folders';
type ScanViewState = 'checking' | 'queued' | 'scanning' | 'checking-result' | 'timeout' | DefenderScanLog['result'];

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'The Defender action could not be completed. Try again or open Windows Security.';
}

function pluralFolders(count: number): string {
  return `${count} ${count === 1 ? 'folder' : 'folders'}`;
}

export function bindDefender(
  section: HTMLElement,
  onAttention: (message: string) => void,
  onViewLogs: () => void,
  settingsSection?: HTMLElement,
): { refresh: () => Promise<void>; dispose: () => void } {
  section.innerHTML = `
    <div class="section-label defender-section-head">
      <span>Protection</span>
      <button type="button" class="defender-link" data-defender="logs">Activity</button>
    </div>
    <div class="group defender-group">
      <div class="row defender-feature-row">
        <div class="row-left">
          <span class="row-label with-icon">
            <span class="row-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M14 3l5 5m-5-5v5h5m-1.5 6.5 3 3m0-3-3 3M14 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            Scan File
          </span>
          <span class="row-sub">Check a file for potential malware/virus</span>
        </div>
        <div class="row-right"><button type="button" class="browse-btn" data-defender="scan" aria-haspopup="dialog" disabled>Choose file</button></div>
      </div>

      <div class="row defender-feature-row defender-auto-row">
        <div class="row-left">
          <span class="row-label with-icon" id="defenderAutoLabel">
            <span class="row-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4.5 6v5.4c0 4.8 3.2 8 7.5 9.6 4.3-1.6 7.5-4.8 7.5-9.6V6L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            Auto Protect
          </span>
          <span class="row-sub defender-auto-copy" id="defenderAutoSummary">
            <span>Real-time protection companion</span><span class="defender-watching" data-defender="auto-status" hidden></span>
          </span>
        </div>
        <div class="row-right"><button type="button" class="toggle" data-defender="toggle" aria-labelledby="defenderAutoLabel" aria-describedby="defenderAutoSummary" aria-pressed="false" disabled></button></div>
      </div>
      <div class="defender-inline-error" data-defender="auto-error" hidden>
        <span class="defender-error-mark" aria-hidden="true">!</span>
        <span data-defender="auto-error-message" role="alert"></span>
      </div>
    </div>

    <div class="defender-settings-controls" data-defender="settings-controls">
      <div class="section-label defender-section-head"><span>Auto Protect settings</span></div>
      <div class="defender-settings-stack">
      <div class="group defender-group defender-settings-group defender-settings-card">
        <div class="row defender-setting-row">
          <div class="row-left">
            <span class="row-label">Microsoft Defender</span>
            <span class="row-sub defender-protection-detail" data-defender="protection-detail">Turn on Auto Protect to verify protection.</span>
          </div>
          <div class="row-right">
            <span class="defender-protection-state" data-defender="protection-state">Off</span>
            <button type="button" class="defender-link" data-defender="protection-security">Review</button>
          </div>
        </div>
      </div>
      <div class="group defender-group defender-settings-group defender-settings-card">
        <div class="row defender-setting-row">
          <div class="row-left">
            <span class="row-label" id="defenderNotificationsLabel">Deskoy threat alerts</span>
            <span class="row-sub" id="defenderNotificationsSummary">Notify for threats and actionable automatic-check failures</span>
          </div>
          <div class="row-right"><button type="button" class="toggle" data-defender="notifications" aria-labelledby="defenderNotificationsLabel" aria-describedby="defenderNotificationsSummary" aria-pressed="false" disabled></button></div>
        </div>
        <div class="defender-inline-error" data-defender="notifications-error" hidden>
          <span class="defender-error-mark" aria-hidden="true">!</span>
          <span data-defender="notifications-error-message" role="alert"></span>
        </div>
      </div>
      <div class="group defender-group defender-settings-group defender-settings-card">
        <div class="row defender-setting-row">
          <div class="row-left">
            <span class="row-label">Threat handling</span>
            <span class="row-sub">Quarantine and remediation follow Microsoft Defender’s configured safeguards</span>
          </div>
          <div class="row-right"><span class="defender-managed-label">Defender managed</span></div>
        </div>
      </div>
      <div class="group defender-group defender-settings-group defender-settings-card defender-downloads-card">
        <div class="defender-disclosure-bar">
        <button type="button" class="defender-disclosure-button" data-defender="folders-toggle" aria-controls="defenderFoldersPanel" aria-expanded="false">
          <span>Download folders</span><span class="defender-count" data-defender="folder-count">0 folders</span>
          <svg class="defender-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6.5 8 10.5l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="defender-disclosure-button defender-how-button" data-defender="how-toggle" aria-controls="defenderHowPanel" aria-expanded="false">
          <span>How it works</span>
          <svg class="defender-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6.5 8 10.5l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        </div>

      <div class="defender-collapsible" id="defenderFoldersPanel" data-defender="folders-disclosure" data-open="false">
        <div class="defender-collapse-panel"><div class="defender-collapse-inner defender-folders-inner">
          <div data-defender="folders"></div>
          <div class="defender-folder-footer">
            <div class="defender-inline-error" data-defender="folders-error" hidden>
              <span class="defender-error-mark" aria-hidden="true">!</span>
              <span data-defender="folders-error-message" role="alert"></span>
            </div>
            <button type="button" class="browse-btn" data-defender="add" disabled>Add</button>
          </div>
        </div></div>
      </div>

      <div class="defender-collapsible" id="defenderHowPanel" data-defender="how-disclosure" data-open="false">
        <div class="defender-collapse-panel"><div class="defender-collapse-inner defender-how-copy" id="defenderScope">
          <p>Microsoft Defender—not Deskoy—provides device-wide real-time, behavior, on-access and download protection for threats such as malware, ransomware and crypto-mining activity. Auto Protect verifies those layers and adds completed-download checks in folders you choose; it does not train a separate detector or guarantee prevention.</p>
          <p>Deskoy checks recognized temporary-to-final downloads up to 512 MiB. Subfolders and direct-to-final downloads are not watched; use Scan File for those. Checks run one at a time with reduced process priority, although large or complex files may take longer on lower-powered PCs.</p>
          <p>Microsoft Defender keeps control of quarantine and remediation. Deskoy reports an action only after Defender confirms it, never moves a file itself, and does not change exclusions or security policy. Deskoy threat alerts are optional and separate from Windows Security notifications.</p>
          <p>Turning Auto Protect or Developer Mode off stops status monitoring, folder watchers and new automatic checks. A Defender scan already in progress may finish.</p>
        </div></div>
      </div>
      </div>
      </div>
    </div>

    <span class="sr-only" data-defender="announcement" role="status" aria-live="polite" aria-atomic="true"></span>

    <div class="modal-overlay defender-scan-overlay" data-defender="scan-overlay">
      <div class="lic-modal defender-scan-dialog t-modal" role="dialog" aria-modal="true" aria-labelledby="defenderScanTitle" aria-describedby="defenderPickerNote">
        <div class="lic-modal__header defender-scan-header">
          <h2 id="defenderScanTitle" class="lic-modal__title" data-defender="popup-title">File Scan</h2>
          <button type="button" class="defender-popup-close" data-defender="popup-close" aria-label="Close scan popup">
            <svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 1 9 9M9 1 1 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="lic-modal__body defender-popup-body">
          <div class="defender-scan-picker" data-defender="scan-picker">
            <div class="defender-drop-zone" data-defender="drop-zone" data-active="false">
              <span class="defender-drop-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <strong>Drag &amp; drop a file</strong>
              <span class="defender-drop-or">or</span>
              <button type="button" class="browse-btn" data-defender="select-file">Select file</button>
            </div>
            <p id="defenderPickerNote" class="defender-picker-note">Deskoy will scan file using Microsoft Defender. <a class="lic-link defender-picker-learn" href="https://www.deskoy.com/docs">Learn more</a></p>
          </div>
          <div class="defender-scan-status" data-defender="scan-status" data-state="checking" hidden>
            <span class="defender-scan-orb" data-defender="indicator" aria-hidden="true">
              <span class="defender-orb-host" data-defender="orb-host"></span>
              <span class="defender-orb-mark" data-defender="orb-mark"></span>
            </span>
            <p id="defenderScanMessage" class="defender-scan-message"><span data-defender="popup-prefix">Deskoy is scanning </span><span class="defender-scan-filename" data-defender="filename"></span></p>
            <span class="defender-status-phase" data-defender="phase"></span>
            <button type="button" class="defender-link defender-details-link" data-defender="result-toggle" aria-controls="defenderResultDetails" aria-expanded="false" hidden>Details</button>
          </div>
          <div class="defender-inline-error" data-defender="scan-error" hidden>
            <span class="defender-error-mark" aria-hidden="true">!</span>
            <span data-defender="scan-error-message" role="alert"></span>
            <button type="button" class="defender-link" data-defender="scan-security">Open Windows Security</button>
          </div>
          <div class="defender-collapsible defender-result-details" id="defenderResultDetails" data-defender="result-details" data-open="false" hidden>
            <div class="defender-collapse-panel"><div class="defender-collapse-inner">
              <p data-defender="result-detail"></p>
              <p data-defender="result-action" hidden></p>
              <div class="defender-detail-actions">
                <button type="button" class="sp-action-btn" data-defender="retry" hidden>Retry</button>
                <button type="button" class="sp-action-btn" data-defender="security" hidden>Open Windows Security</button>
              </div>
            </div></div>
          </div>
          <p class="defender-popup-note" data-defender="popup-note">Please don’t close Deskoy until the scan is complete.</p>
        </div>
      </div>
    </div>`;

  const get = <T extends HTMLElement>(name: string) => section.querySelector<T>(`[data-defender="${name}"]`)!;
  const scan = get<HTMLButtonElement>('scan');
  const toggle = get<HTMLButtonElement>('toggle');
  const notifications = get<HTMLButtonElement>('notifications');
  const add = get<HTMLButtonElement>('add');
  const folders = get<HTMLElement>('folders');
  const folderCount = get<HTMLElement>('folder-count');
  const scanPicker = get<HTMLElement>('scan-picker');
  const dropZone = get<HTMLElement>('drop-zone');
  const selectFile = get<HTMLButtonElement>('select-file');
  const scanStatus = get<HTMLElement>('scan-status');
  const indicator = get<HTMLElement>('indicator');
  const orbHost = get<HTMLElement>('orb-host');
  const orbMark = get<HTMLElement>('orb-mark');
  const popupPrefix = get<HTMLElement>('popup-prefix');
  const filename = get<HTMLElement>('filename');
  const phase = get<HTMLElement>('phase');
  const autoStatus = get<HTMLElement>('auto-status');
  const protectionState = get<HTMLElement>('protection-state');
  const protectionDetail = get<HTMLElement>('protection-detail');
  const protectionSecurity = get<HTMLButtonElement>('protection-security');
  const announcement = get<HTMLElement>('announcement');
  const resultToggle = get<HTMLButtonElement>('result-toggle');
  const resultDetails = get<HTMLElement>('result-details');
  const resultDetail = get<HTMLElement>('result-detail');
  const resultAction = get<HTMLElement>('result-action');
  const retry = get<HTMLButtonElement>('retry');
  const security = get<HTMLButtonElement>('security');
  const scanSecurity = get<HTMLButtonElement>('scan-security');
  const foldersToggle = get<HTMLButtonElement>('folders-toggle');
  const foldersDisclosure = get<HTMLElement>('folders-disclosure');
  const howToggle = get<HTMLButtonElement>('how-toggle');
  const howDisclosure = get<HTMLElement>('how-disclosure');
  const popupOverlay = get<HTMLElement>('scan-overlay');
  const popupDialog = popupOverlay.querySelector<HTMLElement>('.defender-scan-dialog')!;
  const popupTitle = get<HTMLElement>('popup-title');
  const popupNote = get<HTMLElement>('popup-note');
  const popupClose = get<HTMLButtonElement>('popup-close');
  const settingsControls = get<HTMLElement>('settings-controls');
  const ownerDocument = section.ownerDocument;
  const events = new AbortController();
  let state: DefenderState | null = null;
  let pending = false;
  let loading = false;
  let revision = 0;
  let disposed = false;
  let foldersOpen = false;
  let howOpen = false;
  let resultOpen = false;
  let lastLog: DefenderScanLog | null = null;
  let activeScanId: string | null = null;
  let activeFilename = '';
  let startingManualScan = false;
  let trackedScanObserved = false;
  let resultRecoveryPending = false;
  const pendingManualResults = new Map<string, DefenderScanLog>();
  let lastAnnouncement = '';
  let scanActionFailed = false;
  let scanPickerVisible = false;
  let scanPopupVisible = false;
  let scanPopupCloseTimer: number | null = null;
  let scanPopupReturnFocus: HTMLElement | null = null;

  const errors = {
    scan: { root: get<HTMLElement>('scan-error'), message: get<HTMLElement>('scan-error-message') },
    auto: { root: get<HTMLElement>('auto-error'), message: get<HTMLElement>('auto-error-message') },
    notifications: { root: get<HTMLElement>('notifications-error'), message: get<HTMLElement>('notifications-error-message') },
    folders: { root: get<HTMLElement>('folders-error'), message: get<HTMLElement>('folders-error-message') },
  };
  if (settingsSection) settingsSection.append(settingsControls);
  if (ownerDocument?.body) ownerDocument.body.append(popupOverlay);
  const thinkingOrb = mountThinkingOrb(orbHost);

  function setDisclosure(root: HTMLElement, button: HTMLButtonElement, open: boolean) {
    root.dataset.open = String(open);
    button.setAttribute('aria-expanded', String(open));
    const panel = root.querySelector<HTMLElement>('.defender-collapse-panel');
    if (panel) {
      panel.setAttribute('aria-hidden', String(!open));
      panel.inert = !open;
    }
  }

  function announce(text: string) {
    if (!text || text === lastAnnouncement) return;
    lastAnnouncement = text;
    announcement.textContent = text;
  }

  function popupCloseMs() {
    if (
      ownerDocument?.documentElement.getAttribute('data-motion') === 'reduced'
      || ownerDocument?.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return 0;
    const value = ownerDocument?.defaultView
      ?.getComputedStyle(ownerDocument.documentElement)
      .getPropertyValue('--modal-close-dur');
    return Number.parseFloat(value || '') || 150;
  }

  function openScanPopup() {
    if (scanPopupVisible) return;
    scanPopupVisible = true;
    if (scanPopupCloseTimer !== null && ownerDocument?.defaultView) {
      ownerDocument.defaultView.clearTimeout(scanPopupCloseTimer);
      scanPopupCloseTimer = null;
    }
    scanPopupReturnFocus = (ownerDocument?.activeElement as HTMLElement | null) || scan;
    popupDialog.classList.toggle('is-closing', false);
    popupOverlay.classList.toggle('show', true);
    void popupDialog.offsetWidth;
    popupDialog.classList.toggle('is-open', true);
    if (typeof popupClose.focus === 'function') popupClose.focus();
  }

  function closeScanPopup() {
    if (!scanPopupVisible || scanPopupCloseTimer !== null) return;
    scanPopupVisible = false;
    dropZone.dataset.active = 'false';
    popupDialog.classList.toggle('is-open', false);
    popupDialog.classList.toggle('is-closing', true);
    const finish = () => {
      popupOverlay.classList.toggle('show', false);
      popupDialog.classList.toggle('is-closing', false);
      scanPopupCloseTimer = null;
      if (typeof scanPopupReturnFocus?.focus === 'function') scanPopupReturnFocus.focus();
      scanPopupReturnFocus = null;
    };
    if (!ownerDocument?.defaultView) {
      finish();
      return;
    }
    scanPopupCloseTimer = ownerDocument.defaultView.setTimeout(finish, popupCloseMs());
  }

  function clearError(target: ErrorTarget) {
    errors[target].root.hidden = true;
    errors[target].message.textContent = '';
    if (target === 'scan') scanActionFailed = false;
  }

  function showError(target: ErrorTarget, error: unknown) {
    if (disposed) return;
    const text = errorMessage(error);
    errors[target].message.textContent = text;
    errors[target].root.hidden = false;
    if (target === 'scan') {
      scanActionFailed = true;
      scanSecurity.hidden = !/defender|windows security|antivirus/i.test(text);
      openScanPopup();
      renderScanStatus();
    }
    onAttention('Defender needs attention. See Settings → Developer Mode or Logs for details.');
  }

  function applyManualResult(log: DefenderScanLog) {
    activeScanId = log.id;
    lastLog = log;
    activeFilename = log.filename;
    resultOpen = false;
    scanActionFailed = false;
    openScanPopup();
  }

  function reconcileCompletedScan() {
    if (!activeScanId || lastLog) return;
    const completed = state?.lastCompleted;
    if (completed?.source === 'manual' && completed.id === activeScanId) {
      applyManualResult(completed);
      return;
    }
    const pendingResult = pendingManualResults.get(activeScanId);
    if (pendingResult) applyManualResult(pendingResult);
  }

  function trackedScanIsPending() {
    if (!activeScanId) return false;
    return state?.activeScan?.id === activeScanId
      || Boolean(state?.queuedScans?.some((job) => job.id === activeScanId));
  }

  async function recoverCompletedScan() {
    if (!activeScanId || lastLog || !trackedScanObserved || trackedScanIsPending() || resultRecoveryPending || disposed) return;
    resultRecoveryPending = true;
    try {
      const logs = await window.deskoy.getDefenderLogs();
      if (disposed || lastLog || !activeScanId) return;
      const completed = logs.find((log) => log.source === 'manual' && log.id === activeScanId);
      if (completed) {
        applyManualResult(completed);
      } else {
        showError('scan', 'The scan stopped, but Deskoy could not load its result. Check Activity or retry the file.');
      }
    } catch (error) {
      showError('scan', error);
    } finally {
      resultRecoveryPending = false;
      render();
    }
  }

  function renderScanStatus() {
    reconcileCompletedScan();
    const activeScan = activeScanId && state?.activeScan?.id === activeScanId
      ? state.activeScan
      : null;
    const queuedScan = activeScanId
      ? state?.queuedScans?.find((job) => job.id === activeScanId)
      : null;
    const progress = activeScan?.phase || '';
    const normalized = progress.toLowerCase();
    let view: ScanViewState | null = null;
    let label = '';
    let mark = '';
    let spinning = false;

    if (activeScan || queuedScan) trackedScanObserved = true;
    if (lastLog) {
      view = lastLog.result;
      label = defenderResultLabels[lastLog.result];
      mark = lastLog.result === 'clean' || lastLog.result === 'remediated' ? '✓' : lastLog.result === 'failed' ? '×' : '!';
    } else if (scanActionFailed) {
      view = 'failed';
      label = 'Scan failed';
      mark = '×';
    } else if (loading && !state && activeScanId) {
      view = 'checking';
      label = '';
      spinning = true;
    } else if (activeScan) {
      if (normalized === 'timeout' || normalized.includes('still running') || normalized.includes('result is incomplete')) {
        view = 'timeout';
        label = 'Scan timed out; waiting for Defender to finish.';
        mark = '!';
      } else if (normalized === 'checking-result' || normalized.includes('verifying')) {
        view = 'checking-result';
        label = 'Checking result…';
        spinning = true;
      } else if (normalized === 'scanning' || normalized.includes('scanning')) {
        view = 'scanning';
        label = '';
        spinning = true;
      } else {
        view = 'checking';
        label = '';
        spinning = true;
      }
    } else if (queuedScan) {
      view = 'queued';
      label = 'Queued';
      mark = '•';
    } else if (activeScanId && !scanActionFailed && !trackedScanObserved) {
      view = 'queued';
      label = 'Queued';
      mark = '•';
    } else if (activeScanId && !scanActionFailed) {
      view = 'checking-result';
      label = 'Loading result…';
      spinning = true;
      void recoverCompletedScan();
    }

    const stillRunning = view === 'checking' || view === 'queued' || view === 'scanning'
      || view === 'checking-result' || view === 'timeout';
    scanPicker.hidden = !scanPickerVisible;
    popupNote.hidden = scanPickerVisible || !stillRunning;
    popupDialog.setAttribute('aria-describedby', scanPickerVisible ? 'defenderPickerNote' : 'defenderScanMessage');
    scanStatus.hidden = scanPickerVisible || !view;
    if (!view) {
      indicator.classList.toggle('is-active', false);
      thinkingOrb.setActive(false);
      orbMark.textContent = '';
      popupPrefix.textContent = '';
      filename.textContent = '';
      phase.textContent = '';
      resultToggle.hidden = true;
      return;
    }
    scanStatus.dataset.state = view;
    const shownFilename = lastLog?.filename || activeScan?.filename || activeFilename || 'Selected file';
    filename.textContent = shownFilename;
    filename.setAttribute('title', shownFilename);
    phase.textContent = label;
    phase.hidden = !label;
    indicator.classList.toggle('is-active', spinning);
    thinkingOrb.setActive(spinning);
    orbMark.textContent = spinning ? '' : mark;
    const hasResult = Boolean(lastLog);
    resultToggle.hidden = !hasResult;
    resultToggle.setAttribute('aria-expanded', String(hasResult && resultOpen));
    popupTitle.textContent = 'File Scan';
    popupPrefix.textContent = view === 'queued'
      ? 'Deskoy is preparing '
      : view === 'checking-result'
        ? 'Deskoy is checking '
        : stillRunning
          ? 'Deskoy is scanning '
          : view === 'failed' && !hasResult
            ? 'Deskoy couldn’t scan '
            : 'Deskoy scanned ';
    announce(`${shownFilename}: ${label || 'Scanning'}`);
  }

  function renderResultDetails() {
    resultDetails.hidden = !lastLog;
    setDisclosure(resultDetails, resultToggle, Boolean(lastLog && resultOpen));
    if (!lastLog) return;
    resultDetail.textContent = lastLog.detail;
    resultAction.textContent = lastLog.action ? `Defender action: ${lastLog.action}` : '';
    resultAction.hidden = !lastLog.action;
    retry.hidden = !lastLog.retryAvailable || lastLog.result === 'clean' || lastLog.result === 'remediated';
    retry.dataset.scanId = lastLog.id;
    security.hidden = lastLog.result === 'clean';
  }

  function renderFolders(unavailable: boolean) {
    const folderList = state?.folders || [];
    folderCount.textContent = pluralFolders(folderList.length);
    folders.innerHTML = folderList.length
      ? folderList.map((folder) => `<div class="defender-folder">
          <span class="defender-folder-name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</span>
          <div class="defender-folder-controls">
            <details class="defender-path-details">
              <summary aria-label="Show full path for ${escapeHtml(folder.name)}">Path</summary>
              <span title="${escapeHtml(folder.path)}">${escapeHtml(folder.path)}</span>
            </details>
            <button type="button" class="defender-link defender-remove" data-remove-folder="${escapeHtml(folder.id)}" aria-label="Remove ${escapeHtml(folder.name)}" ${unavailable ? 'disabled' : ''}>Remove</button>
          </div>
        </div>`).join('')
      : '<p class="defender-empty">No folders yet. Downloads is a good place to start.</p>';
  }

  function render() {
    if (disposed) return;
    const unavailable = pending || !state?.developerMode;
    scan.disabled = unavailable;
    selectFile.disabled = pending || !state?.developerMode;
    dropZone.dataset.disabled = String(pending || !state?.developerMode);
    add.disabled = unavailable;
    toggle.disabled = unavailable;
    notifications.disabled = unavailable;
    toggle.classList.toggle('on', Boolean(state?.enabled));
    toggle.setAttribute('aria-pressed', String(Boolean(state?.enabled)));
    notifications.classList.toggle('on', Boolean(state?.notificationsEnabled));
    notifications.setAttribute('aria-pressed', String(Boolean(state?.notificationsEnabled)));
    renderFolders(unavailable);
    renderScanStatus();
    renderResultDetails();
    const paused = Boolean(state?.enabled && state.progress?.toLowerCase().includes('automatic checks paused'));
    const protection = state?.protection;
    autoStatus.hidden = !state?.enabled;
    autoStatus.dataset.state = paused || protection?.state === 'attention' || protection?.state === 'unavailable'
      ? 'paused'
      : 'watching';
    autoStatus.textContent = !state?.enabled
      ? ''
      : paused
        ? ' · Download checks paused'
        : protection?.state === 'protected'
          ? ' · Protected'
          : protection?.state === 'attention'
            ? ' · Needs attention'
            : protection?.state === 'unavailable'
              ? ' · Status unavailable'
              : ' · Checking Defender…';
    protectionState.dataset.state = !state?.enabled ? 'off' : protection?.state || 'checking';
    protectionState.textContent = !state?.enabled
      ? 'Off'
      : protection?.state === 'protected'
        ? 'Protected'
        : protection?.state === 'attention'
          ? 'Needs attention'
          : protection?.state === 'unavailable'
            ? 'Unavailable'
            : 'Checking…';
    protectionDetail.textContent = !state?.enabled
      ? 'Turn on Auto Protect to verify protection.'
      : protection?.detail || 'Checking Microsoft Defender protection…';
    setDisclosure(foldersDisclosure, foldersToggle, foldersOpen);
    setDisclosure(howDisclosure, howToggle, howOpen);
  }

  async function refresh() {
    const request = ++revision;
    if (!state) {
      loading = true;
      render();
    }
    try {
      const next = await window.deskoy.getDefenderState();
      if (disposed || request !== revision) return;
      state = next;
      loading = false;
      reconcileCompletedScan();
      render();
    } catch (error) {
      if (disposed || request !== revision) return;
      loading = false;
      render();
      showError('scan', error);
    }
  }

  async function action(run: () => Promise<unknown>, target: ErrorTarget, preserveError = false) {
    if (pending || disposed) return;
    pending = true;
    if (!preserveError) clearError(target);
    render();
    try {
      await run();
      await refresh();
    } catch (error) {
      showError(target, error);
    } finally {
      pending = false;
      render();
    }
  }

  function resetManualScan() {
    lastLog = null;
    activeScanId = null;
    activeFilename = '';
    trackedScanObserved = false;
    resultOpen = false;
  }

  async function queueManualScan(run: () => ReturnType<typeof window.deskoy.pickDefenderScan>) {
    resetManualScan();
    startingManualScan = true;
    try {
      const response = await run();
      if (response.queued && response.scanId) {
        activeScanId = response.scanId;
        activeFilename = response.filename || 'Selected file';
        scanPickerVisible = false;
        reconcileCompletedScan();
        openScanPopup();
      }
    } finally {
      startingManualScan = false;
    }
  }

  scan.addEventListener('click', () => {
    resetManualScan();
    clearError('scan');
    scanPickerVisible = true;
    dropZone.dataset.active = 'false';
    render();
    openScanPopup();
  }, { signal: events.signal });
  selectFile.addEventListener('click', () => void action(
    () => queueManualScan(() => window.deskoy.pickDefenderScan()),
    'scan',
  ), { signal: events.signal });
  toggle.addEventListener('click', () => void action(() => window.deskoy.setDefenderEnabled(!state?.enabled), 'auto'), { signal: events.signal });
  notifications.addEventListener('click', () => void action(() => window.deskoy.setDefenderNotifications(!state?.notificationsEnabled), 'notifications'), { signal: events.signal });
  add.addEventListener('click', () => void action(() => window.deskoy.pickDefenderFolder(), 'folders'), { signal: events.signal });
  folders.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-folder]');
    if (button?.dataset.removeFolder && !button.disabled) void action(() => window.deskoy.removeDefenderFolder(button.dataset.removeFolder!), 'folders');
  }, { signal: events.signal });
  get('logs').addEventListener('click', onViewLogs, { signal: events.signal });
  foldersToggle.addEventListener('click', () => {
    foldersOpen = !foldersOpen;
    render();
  }, { signal: events.signal });
  howToggle.addEventListener('click', () => {
    howOpen = !howOpen;
    render();
  }, { signal: events.signal });
  resultToggle.addEventListener('click', () => {
    resultOpen = !resultOpen;
    renderResultDetails();
  }, { signal: events.signal });
  retry.addEventListener('click', () => {
    const id = retry.dataset.scanId;
    if (!id) return;
    void action(async () => {
      scanPickerVisible = false;
      await queueManualScan(() => window.deskoy.retryDefenderScan(id));
    }, 'scan');
  }, { signal: events.signal });
  security.addEventListener('click', () => void action(() => window.deskoy.openWindowsSecurity(), 'scan', true), { signal: events.signal });
  scanSecurity.addEventListener('click', () => void action(() => window.deskoy.openWindowsSecurity(), 'scan', true), { signal: events.signal });
  protectionSecurity.addEventListener('click', () => void action(() => window.deskoy.openWindowsSecurity(), 'auto', true), { signal: events.signal });
  popupClose.addEventListener('click', closeScanPopup, { signal: events.signal });
  popupOverlay.addEventListener('click', (event) => {
    if (event.target === popupOverlay) closeScanPopup();
  }, { signal: events.signal });
  ownerDocument?.addEventListener('keydown', (event) => {
    if (!scanPopupVisible) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeScanPopup();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      popupClose,
      ...(scanPickerVisible ? [selectFile] : []),
      ...(resultToggle.hidden ? [] : [resultToggle]),
      ...(resultOpen && !retry.hidden ? [retry] : []),
      ...(resultOpen && !security.hidden ? [security] : []),
      ...(!errors.scan.root.hidden && !scanSecurity.hidden ? [scanSecurity] : []),
    ].filter((element) => !element.disabled);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, { signal: events.signal });

  const unlistenState = window.deskoy.onDefenderChanged((next) => {
    revision += 1;
    state = next;
    loading = false;
    reconcileCompletedScan();
    render();
  });
  const unlistenScan = window.deskoy.onDefenderScan(({ log, notify }) => {
    if (disposed) return;
    if (log.source === 'manual') {
      pendingManualResults.set(log.id, log);
      if (pendingManualResults.size > 8) {
        pendingManualResults.delete(pendingManualResults.keys().next().value!);
      }
      if (activeScanId === log.id || (!activeScanId && !startingManualScan)) {
        applyManualResult(log);
        render();
      }
    }
    if (!notify) return;
    onAttention(`${defenderResultLabels[log.result]}. See Settings → Developer Mode or Logs for details.`);
  });
  const unlistenDrop = window.deskoy.onFileDrop((event) => {
    if (disposed || !scanPopupVisible || !scanPickerVisible) return;
    if (event.type === 'enter' || event.type === 'over') {
      dropZone.dataset.active = 'true';
      return;
    }
    dropZone.dataset.active = 'false';
    if (event.type !== 'drop') return;
    if (event.paths.length !== 1) {
      showError('scan', 'Drop one file at a time.');
      return;
    }
    void action(
      () => queueManualScan(() => window.deskoy.scanDefenderPath(event.paths[0])),
      'scan',
    );
  });

  return {
    refresh,
    dispose: () => {
      disposed = true;
      events.abort();
      unlistenState();
      unlistenScan();
      unlistenDrop();
      thinkingOrb.dispose();
      if (scanPopupCloseTimer !== null && ownerDocument?.defaultView) {
        ownerDocument.defaultView.clearTimeout(scanPopupCloseTimer);
      }
      popupOverlay.remove?.();
    },
  };
}
