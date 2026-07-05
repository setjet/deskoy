import brandLogoUrl from '../assets/logo.png';
import { mountUpdatesPanel, refreshUpdatesPanel } from './components/UpdatesPanel';

let deskoyUiAttached = false;

export function attachDeskoyUi(): void {
if (deskoyUiAttached) return;
deskoyUiAttached = true;

/** Matches `saveSettings` / store `coverMode` in `global.d.ts`. */
type DeskoyCoverMode = 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
type DeskoyBuiltInCover = Exclude<DeskoyCoverMode, 'url' | 'file'>;

type DeskoySaveSettingsPatch = Parameters<Window['deskoy']['saveSettings']>[0];
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const brandLogoImg = el<HTMLImageElement>('brandLogoImg');
brandLogoImg.src = brandLogoUrl;

const upgradeOverlay = el<HTMLElement>('upgradeOverlay');
const upgradeStatus = el<HTMLElement>('upgradeStatus');
const btnUpgrade = el<HTMLButtonElement>('btnUpgrade');
const upgradeModalSubtitle = el<HTMLElement>('upgradeModalSubtitle');

/** Opens in the default browser (see `deskoy:openExternal` in main). */
const HELP_URL = 'https://www.deskoy.com/docs/support';
const CHANGELOG_URL = 'https://www.deskoy.com/changelog';
/** Public uptime / incidents page for Deskoy online services. */
const STATUS_PAGE_URL = 'https://www.deskoy.com/status';
const TERMS_OF_SERVICE_URL = 'https://www.deskoy.com/terms';
const DESKOY_DOWNLOAD_URL = 'https://www.deskoy.com/download';

document.body.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a.lic-link');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  void window.deskoy.openExternal(href);
});

el<HTMLAnchorElement>('spFeedbackTermsLink').setAttribute('href', TERMS_OF_SERVICE_URL);
el<HTMLAnchorElement>('spBugTermsLink').setAttribute('href', TERMS_OF_SERVICE_URL);

let upgradeDownloadUrl = DESKOY_DOWNLOAD_URL;
btnUpgrade.addEventListener('click', () => void window.deskoy.openExternal(upgradeDownloadUrl));

let upgradeRequiredActive = false;

function showUpgradeRequired(payload: { message: string; downloadUrl: string; minimumVersion?: string }) {
  upgradeRequiredActive = true;
  upgradeDownloadUrl = payload.downloadUrl || DESKOY_DOWNLOAD_URL;
  upgradeModalSubtitle.textContent = payload.minimumVersion
    ? `This version is discontinued. Update to ${payload.minimumVersion} or newer.`
    : 'This version is discontinued.';
  upgradeStatus.textContent = payload.message || 'Please install the latest Deskoy to keep using it.';
  upgradeOverlay.classList.add('show');
  document.documentElement.classList.add('upgrade-required');
  // Ensure the settings side panel can't be opened behind the overlay.
  closeSettingsPanel();
}

const hotkeyRow = el<HTMLElement>('hotkeyRow');
const hotkeyCapture = el<HTMLElement>('hotkeyCapture');
const hotkeyBadges = el<HTMLElement>('hotkeyBadges');
const hotkeyHint = el<HTMLElement>('hotkeyHint');
const sourceModeUrl = el<HTMLButtonElement>('sourceModeUrl');
const sourceModeFile = el<HTMLButtonElement>('sourceModeFile');
const customSourceInput = el<HTMLInputElement>('customSourceInput');
const btnPickCoverFile = el<HTMLButtonElement>('btnPickCoverFile');
const customSourceHint = el<HTMLElement>('customSourceHint');
const coverMode = el<HTMLInputElement>('coverMode');
const coverDropdown = el<HTMLElement>('coverDropdown');
const coverTrigger = el<HTMLButtonElement>('coverTrigger');
const coverMenu = el<HTMLElement>('coverMenu');
const coverLockChip = el<HTMLElement>('coverLockChip');
const coverLabel = el<HTMLElement>('coverLabel');
const urlWrap = el<HTMLElement>('urlWrap');
const fileWrap = el<HTMLElement>('fileWrap');
const filePathDisplay = el<HTMLInputElement>('filePathDisplay');
const coverUrl = el<HTMLInputElement>('coverUrl');
const coverFilePath = el<HTMLInputElement>('coverFilePath');
const btnSave = el<HTMLButtonElement>('btnSave');
const settingsStatus = el<HTMLElement>('settingsStatus');
const btnToggle = el<HTMLButtonElement>('btnToggle');
const btnMinimize = el<HTMLButtonElement>('btnMinimize');
const btnClose = el<HTMLButtonElement>('btnClose');
const stateText = el<HTMLElement>('stateText');
const toggleMuteAudio = el<HTMLButtonElement>('toggleMuteAudio');
const toggleUseCustom = el<HTMLButtonElement>('toggleUseCustom');
const toggleAutoBlocked = el<HTMLButtonElement>('toggleAutoBlocked');
const blockedWebsites = el<HTMLTextAreaElement>('blockedWebsites');
const blockedKeywords = el<HTMLTextAreaElement>('blockedKeywords');
// Active window debug panel removed from UI.
const customSourcePanel = el<HTMLElement>('customSourcePanel');
const blockedPanel = el<HTMLElement>('blockedPanel');
const appVersion = el<HTMLElement>('appVersion');
const btnHelp = el<HTMLButtonElement>('btnHelp');
const btnChangelog = el<HTMLButtonElement>('btnChangelog');

const btnGear = el<HTMLButtonElement>('btnGear');
const spPanel = el<HTMLElement>('spPanel');
const spBackdrop = el<HTMLElement>('spBackdrop');
const spClose = el<HTMLButtonElement>('spClose');
const spHeaderTitle = el<HTMLElement>('spHeaderTitle');
const spNavGeneral = el<HTMLButtonElement>('spNavGeneral');
const spNavAppearance = el<HTMLButtonElement>('spNavAppearance');
const spNavFeedback = el<HTMLButtonElement>('spNavFeedback');
const spNavBug = el<HTMLButtonElement>('spNavBug');
const spNavLogs = el<HTMLButtonElement>('spNavLogs');
const spNavUpdates = el<HTMLButtonElement>('spNavUpdates');
const spNavAbout = el<HTMLButtonElement>('spNavAbout');
const spPageGeneral = el<HTMLElement>('spPageGeneral');
const spPageAppearance = el<HTMLElement>('spPageAppearance');
const spPageFeedback = el<HTMLElement>('spPageFeedback');
const spPageBug = el<HTMLElement>('spPageBug');
const spPageLogs = el<HTMLElement>('spPageLogs');
const spPageUpdates = el<HTMLElement>('spPageUpdates');
const spPageAbout = el<HTMLElement>('spPageAbout');
const spThemeTrack = el<HTMLElement>('spThemeTrack');
const spGeneralHotkey = el<HTMLElement>('spGeneralHotkey');
const spGeneralVersion = el<HTMLElement>('spGeneralVersion');
const spGoHotkey = el<HTMLButtonElement>('spGoHotkey');

const spFeedbackEmail = el<HTMLInputElement>('spFeedbackEmail');
const spFeedbackText = el<HTMLTextAreaElement>('spFeedbackText');
const spFeedbackSend = el<HTMLButtonElement>('spFeedbackSend');
const spFeedbackStatus = el<HTMLElement>('spFeedbackStatus');
const spBugEmail = el<HTMLInputElement>('spBugEmail');
const spBugSteps = el<HTMLTextAreaElement>('spBugSteps');
const spBugDiag = el<HTMLInputElement>('spBugDiag');
const spBugText = el<HTMLTextAreaElement>('spBugText');
const spBugSend = el<HTMLButtonElement>('spBugSend');
const spBugStatus = el<HTMLElement>('spBugStatus');
const spBugFileInput = el<HTMLInputElement>('spBugFileInput');
const spBugAttachPrompt = el<HTMLElement>('spBugAttachPrompt');
const spBugPreview = el<HTMLElement>('spBugPreview');
const spBugPreviewImg = el<HTMLImageElement>('spBugPreviewImg');
const spBugRemoveImg = el<HTMLButtonElement>('spBugRemoveImg');
const spChangelog = el<HTMLButtonElement>('spChangelog');
const spHelp = el<HTMLButtonElement>('spHelp');
const spAboutStatus = el<HTMLButtonElement>('spAboutStatus');
const spStatusPageGeneral = el<HTMLButtonElement>('spStatusPageGeneral');
const spAppVersion = el<HTMLElement>('spAppVersion');
const spLogsList = el<HTMLElement>('spLogsList');
const spClearLogs = el<HTMLButtonElement>('spClearLogs');
const spLogsStatus = el<HTMLElement>('spLogsStatus');

const statusTimers = new WeakMap<HTMLElement, number>();
let hasUnsavedChanges = false;
let savedSnapshot = '';
let currentTheme: 'dark' | 'light' | 'system' = 'dark';
let muteAudioOn = false;
let whitelistApps: string[] = [];
/** Mirrors settings.enabled — global hotkey only works when true; hotkey capture UI only when true. */
let deskoyArmed = false;
/** When true, custom URL/file overrides the Cover mode dropdown. */
let useCustomCover = false;
let customSourceMode: 'url' | 'file' = 'url';
let recordingHotkey = false;
let currentHotkey = '';
let autoBlockedOn = false;
let blockedWebsiteRules: string[] = [];
let blockedTitleKeywords: string[] = [];

function markUnsaved() {
  const current = JSON.stringify(buildSettingsPatch());
  if (current === savedSnapshot) {
    hasUnsavedChanges = false;
    settingsStatus.classList.remove('show');
    return;
  }
  hasUnsavedChanges = true;
  setStatus(settingsStatus, 'Unsaved changes', 'muted', true);
}
const coverOptions: Record<
  string,
  { iconHtml: string; label: string; cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' }
> = {
  excel: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M4.75 4A3.25 3.25 0 0 1 8 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 32 39.25H8A3.25 3.25 0 0 1 4.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M24 .5V8a4 4 0 0 0 4 4h7.5"/><path stroke="#079455" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.9 24.9h16.2m-16.2 0v-3.6a1.8 1.8 0 0 1 1.8-1.8h3.6m-5.4 5.4v3.6a1.8 1.8 0 0 0 1.8 1.8h3.6m10.8-5.4v3.6a1.8 1.8 0 0 1-1.8 1.8h-9m10.8-5.4v-3.6a1.8 1.8 0 0 0-1.8-1.8h-9m0 0v10.8"/></svg></span>`,
    label: 'Excel Spreadsheet',
    cover: 'excel',
  },
  vscode: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M4.75 4A3.25 3.25 0 0 1 8 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 32 39.25H8A3.25 3.25 0 0 1 4.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M24 .5V8a4 4 0 0 0 4 4h7.5"/><path stroke="#444CE7" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M23.75 27.75 27.5 24l-3.75-3.75m-7.5 0L12.5 24l3.75 3.75m5.25-10.5-3 13.5"/></svg></span>`,
    label: 'VS Code',
    cover: 'vscode',
  },
  docs: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M7.75 4A3.25 3.25 0 0 1 11 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 35 39.25H11A3.25 3.25 0 0 1 7.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M27 .5V8a4 4 0 0 0 4 4h7.5"/><rect width="29" height="16" x="1" y="18" fill="#155EEF" rx="2"/><path fill="#fff" d="M7.402 30H4.824v-7.273h2.599q1.096 0 1.89.437.79.433 1.217 1.246.43.814.43 1.947 0 1.136-.43 1.953a2.95 2.95 0 0 1-1.225 1.253Q8.509 30 7.402 30m-1.04-1.317h.976q.682 0 1.147-.242.468-.244.703-.756.237-.516.238-1.328 0-.807-.238-1.318a1.54 1.54 0 0 0-.7-.753q-.465-.24-1.147-.241h-.98zm12.42-2.32q0 1.19-.45 2.025a3.13 3.13 0 0 1-1.222 1.275 3.45 3.45 0 0 1-1.733.436 3.44 3.44 0 0 1-1.74-.44 3.14 3.14 0 0 1-1.219-1.275q-.447-.834-.447-2.02 0-1.19.447-2.024a3.1 3.1 0 0 1 1.219-1.272 3.44 3.44 0 0 1 1.74-.44q.962 0 1.733.44.774.437 1.221 1.271.45.835.451 2.025m-1.559 0q0-.77-.23-1.3-.228-.529-.643-.802a1.73 1.73 0 0 0-.973-.273 1.73 1.73 0 0 0-.973.273q-.416.274-.647.803-.227.53-.227 1.3t.227 1.3q.231.529.647.802.415.273.973.273.557 0 .973-.273t.642-.803q.231-.528.231-1.3m9.115-1.09h-1.555a1.5 1.5 0 0 0-.174-.536 1.4 1.4 0 0 0-.338-.405 1.5 1.5 0 0 0-.476-.255 1.8 1.8 0 0 0-.578-.09q-.566 0-.984.282-.42.276-.65.81-.23.528-.23 1.285 0 .777.23 1.306.234.53.654.8.419.27.969.27.308 0 .572-.082.266-.082.472-.238.205-.16.34-.387.14-.228.193-.519l1.555.007q-.06.501-.302.966a2.9 2.9 0 0 1-.643.828 3 3 0 0 1-.958.575q-.554.21-1.254.21-.974 0-1.74-.44a3.13 3.13 0 0 1-1.207-1.276q-.44-.834-.44-2.02 0-1.19.447-2.024t1.214-1.272a3.4 3.4 0 0 1 1.726-.44q.632 0 1.172.177.543.179.962.519.42.337.682.827.267.49.341 1.122"/></svg></span>`,
    label: 'Google Docs',
    cover: 'docs',
  },
  jira: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M7.75 4A3.25 3.25 0 0 1 11 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 35 39.25H11A3.25 3.25 0 0 1 7.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M27 .5V8a4 4 0 0 0 4 4h7.5"/><rect width="26" height="16" x="1" y="18" fill="#444CE7" rx="2"/><path fill="#fff" d="M4.935 30v-7.273h4.9v1.268H6.472v1.733h3.111v1.268h-3.11v1.736H9.85V30zm7.565-7.273 1.466 2.479h.057l1.474-2.479h1.736l-2.22 3.637L17.284 30h-1.768l-1.492-2.482h-.057L12.475 30h-1.762l2.277-3.636-2.234-3.637zM18.206 30v-7.273h4.9v1.268h-3.362v1.733h3.11v1.268h-3.11v1.736h3.377V30z"/></svg></span>`,
    label: 'Jira Board',
    cover: 'jira',
  },
  bi: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M7.75 4A3.25 3.25 0 0 1 11 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 35 39.25H11A3.25 3.25 0 0 1 7.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M27 .5V8a4 4 0 0 0 4 4h7.5"/><rect width="27" height="16" x="1" y="18" fill="#444CE7" rx="2"/><path fill="#fff" d="M9.053 24.819a.9.9 0 0 0-.366-.668q-.323-.238-.877-.238-.376 0-.636.107a.9.9 0 0 0-.397.288.7.7 0 0 0-.135.419.6.6 0 0 0 .081.34.85.85 0 0 0 .253.253q.16.103.369.18.21.075.447.129l.654.156q.476.106.873.284.397.177.69.437.29.259.45.61.165.353.167.807-.004.667-.34 1.157-.334.487-.967.757-.628.266-1.516.266-.88 0-1.534-.27a2.25 2.25 0 0 1-1.016-.799q-.362-.533-.38-1.317h1.488q.026.366.21.61.188.242.5.366.317.12.714.12.39 0 .679-.113a1.04 1.04 0 0 0 .45-.316.73.73 0 0 0 .16-.465q0-.244-.145-.412a1.1 1.1 0 0 0-.42-.284 4 4 0 0 0-.67-.213l-.792-.199q-.92-.224-1.453-.7-.532-.475-.529-1.282-.003-.66.352-1.154.359-.493.983-.77.625-.277 1.42-.277.81 0 1.414.277.607.276.945.77t.348 1.144zm5.352 2.653h1.307l.657.845.646.753 1.219 1.527h-1.435l-.838-1.03-.43-.611zm3.939-1.108q0 1.189-.451 2.024a3.13 3.13 0 0 1-1.222 1.275 3.45 3.45 0 0 1-1.733.436 3.44 3.44 0 0 1-1.74-.44 3.13 3.13 0 0 1-1.218-1.275q-.447-.834-.447-2.02 0-1.19.447-2.024a3.1 3.1 0 0 1 1.218-1.272 3.44 3.44 0 0 1 1.74-.44q.963 0 1.733.44.774.437 1.222 1.271.45.835.45 2.025m-1.56 0q0-.77-.23-1.3-.228-.529-.643-.803a1.73 1.73 0 0 0-.973-.273 1.73 1.73 0 0 0-.973.273q-.415.274-.646.803-.228.53-.228 1.3t.228 1.3q.231.529.646.802t.973.273.973-.273.643-.803q.23-.528.23-1.3M19.484 30v-7.273h1.537v6.005h3.118V30z"/></svg></span>`,
    label: 'BI Dashboard',
    cover: 'bi',
  },
  black: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.57181 21C8.90661 20.3598 10.41 20 12 20C13.59 20 15.0934 20.3598 16.4282 21M6.8 17H17.2C18.8802 17 19.7202 17 20.362 16.673C20.9265 16.3854 21.3854 15.9265 21.673 15.362C22 14.7202 22 13.8802 22 12.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V12.2C2 13.8802 2 14.7202 2.32698 15.362C2.6146 15.9265 3.07354 16.3854 3.63803 16.673C4.27976 17 5.11984 17 6.8 17Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`,
    label: 'Blank Black Screen',
    cover: 'black',
  },
};

function hotkeyHintIdleText(): string {
  if (!deskoyArmed) return 'Toggle Deskoy first';
  if (!currentHotkey.trim()) return 'Click to set a hotkey';
  return 'Click to change';
}

function setActiveState(active: boolean) {
  deskoyArmed = active;
  if (!active && recordingHotkey) {
    recordingHotkey = false;
    hotkeyCapture.classList.remove('recording');
    renderHotkeyBadges(currentHotkey);
  }
  stateText.textContent = active ? 'Active' : 'Inactive';
  const pill = document.getElementById('pillState');
  if (!pill) return;
  pill.classList.toggle('inactive', !active);
  pill.classList.toggle('active', active);
  hotkeyRow.classList.toggle('clickable', active);
  if (!recordingHotkey) hotkeyHint.textContent = hotkeyHintIdleText();
  if (isSettingsPanelOpen()) refreshGeneralPanel();
}

function setStatus(target: HTMLElement, msg: string, kind: 'ok' | 'error' | 'muted' = 'muted', persistent = false) {
  target.classList.remove('ok', 'error');
  if (kind === 'ok') target.classList.add('ok');
  if (kind === 'error') target.classList.add('error');
  target.textContent = msg;
  target.classList.add('show');
  const existing = statusTimers.get(target);
  if (existing) window.clearTimeout(existing);
  if (!persistent) {
    const duration = kind === 'error' ? 5500 : 3000;
    const timer = window.setTimeout(() => {
      target.classList.remove('show');
      window.setTimeout(() => {
        if (!target.classList.contains('show')) {
          target.textContent = '';
          target.classList.remove('ok', 'error');
        }
      }, 220);
    }, duration);
    statusTimers.set(target, timer);
  }
}

function setToggle(elm: HTMLButtonElement, on: boolean) {
  elm.classList.toggle('on', on);
  elm.setAttribute('aria-pressed', String(on));
}

function setMaximizedUi(): void {
  // Window is fixed-size; maximize is disabled/hidden.
}

function normalizeTypedHotkey(raw: string): string {
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const mapped = parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === 'control' || lower === 'ctrl') return 'Ctrl';
    if (lower === 'alt' || lower === 'option') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') return 'Meta';
    return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
  });
  return mapped.join('+');
}

function renderHotkeyBadges(value: string, placeholder = false) {
  hotkeyBadges.innerHTML = '';
  if (placeholder) {
    const badge = document.createElement('span');
    badge.className = 'key';
    badge.textContent = '…';
    hotkeyBadges.appendChild(badge);
    return;
  }
  if (!value.trim()) {
    const badge = document.createElement('span');
    badge.className = 'key key--unset';
    badge.textContent = 'Not set';
    hotkeyBadges.appendChild(badge);
    return;
  }
  const parts = value.split('+').map((p) => p.trim()).filter(Boolean);
  parts.forEach((part, idx) => {
    if (idx > 0) {
      const plus = document.createElement('span');
      plus.className = 'key-sep';
      plus.textContent = '+';
      hotkeyBadges.appendChild(plus);
    }
    const badge = document.createElement('span');
    badge.className = 'key';
    badge.textContent = part;
    hotkeyBadges.appendChild(badge);
  });
}


function normalizeCombo(e: KeyboardEvent): string {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push('Ctrl');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');
  if (e.metaKey) keys.push('Meta');
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(k)) keys.push(k);
  return keys.join('+');
}

function isDisallowedHotkey(combo: string): boolean {
  // Prevent keys Electron can't reliably register globally (or would break UX).
  // Arrow keys are the main culprit: users can get stuck with an invalid accelerator.
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(last);
}

function beginHotkeyCapture() {
  recordingHotkey = true;
  hotkeyCapture.classList.add('recording');
  hotkeyHint.textContent = 'Press keys…';
  renderHotkeyBadges('', true);
}

// Presentation hotkey removed

function setCoverMode(modeRaw: string) {
  const mode = coverOptions[modeRaw] ? modeRaw : 'excel';
  coverMode.value = mode;
  const opt = coverOptions[mode];
  coverLabel.innerHTML = `${opt.iconHtml}<span>${opt.label}</span>`;
  coverMenu.querySelectorAll<HTMLElement>('.dd-opt').forEach((o) => {
    o.classList.toggle('sel', o.dataset.cover === mode);
  });
}

/** Built-in Cover mode is ignored whenever custom override is on (URL/file may still be empty). */
function isCoverModeLocked(): boolean {
  return useCustomCover;
}

function refreshCoverModeUi() {
  const locked = isCoverModeLocked();
  coverDropdown.classList.toggle('panel-muted', locked);
  coverTrigger.disabled = locked;
  coverTrigger.setAttribute('aria-disabled', locked ? 'true' : 'false');
  coverTrigger.title = locked ? 'Turn off custom override to change the built-in preset.' : '';
  coverLockChip.hidden = !locked;
  if (locked) coverMenu.classList.remove('open');
}

function updateCustomSourceHintText() {
  if (!useCustomCover) {
    customSourceHint.textContent = 'Turn on override above to edit.';
    return;
  }
  customSourceHint.textContent =
    'If empty, the built-in preset (above) is used, turn off override to change that preset.';
}

function refreshCustomCoverUi() {
  updateCustomSourceHintText();
  const on = useCustomCover;
  customSourcePanel.classList.toggle('collapsed', !on);
  customSourcePanel.classList.toggle('panel-muted', !on);
  sourceModeUrl.disabled = !on;
  sourceModeFile.disabled = !on;
  customSourceInput.disabled = !on;
  filePathDisplay.disabled = !on;
  btnPickCoverFile.disabled = !on;

  // Mute audio is for built-in cover presets only. If custom cover override is on, disable it.
  toggleMuteAudio.disabled = on;
  toggleMuteAudio.setAttribute('aria-disabled', on ? 'true' : 'false');

  refreshCoverModeUi();
}

function setCustomSourceMode(mode: 'url' | 'file') {
  customSourceMode = mode;
  const isUrl = mode === 'url';
  sourceModeUrl.classList.toggle('active', isUrl);
  sourceModeFile.classList.toggle('active', !isUrl);
  sourceModeUrl.setAttribute('aria-pressed', String(isUrl));
  sourceModeFile.setAttribute('aria-pressed', String(!isUrl));
  urlWrap.style.display = isUrl ? 'block' : 'none';
  fileWrap.style.display = isUrl ? 'none' : 'block';
  customSourceInput.value = coverUrl.value;
  filePathDisplay.value = coverFilePath.value;
  refreshCustomCoverUi();
}

function buildSettingsPatch(): DeskoySaveSettingsPatch {
  const newHotkey = normalizeTypedHotkey(currentHotkey);
  const selectedBuiltInMode = (coverMode.value as DeskoyBuiltInCover) || 'excel';
  const trimmedUrl = coverUrl.value.trim();
  const trimmedFilePath = coverFilePath.value.trim();
  const mode: DeskoyCoverMode = !useCustomCover
    ? selectedBuiltInMode
    : customSourceMode === 'file'
      ? trimmedFilePath
        ? 'file'
        : selectedBuiltInMode
      : trimmedUrl
        ? 'url'
        : selectedBuiltInMode;
  const newCover: DeskoyBuiltInCover =
    selectedBuiltInMode === 'vscode'
      ? 'vscode'
      : selectedBuiltInMode === 'docs'
        ? 'docs'
        : selectedBuiltInMode === 'jira'
          ? 'jira'
          : selectedBuiltInMode === 'bi'
            ? 'bi'
            : selectedBuiltInMode === 'black'
              ? 'black'
              : 'excel';
  return {
    hotkey: newHotkey,
    coverMode: mode,
    cover: newCover,
    coverUrl: trimmedUrl,
    coverFilePath: trimmedFilePath,
    audioMute: muteAudioOn,
    whitelist: [...whitelistApps],
    useCustomCover,
    autoCoverBlocked: autoBlockedOn,
    blockedWebsites: [...blockedWebsiteRules],
    blockedTitleKeywords: [...blockedTitleKeywords],
  };
}

async function refresh() {
  const [state, settings] = await Promise.all([window.deskoy.getState(), window.deskoy.getSettings()]);

  setActiveState(state.active);
  setMaximizedUi();
  currentHotkey = typeof settings.hotkey === 'string' ? settings.hotkey : '';
  renderHotkeyBadges(currentHotkey);
  coverUrl.value = settings.coverUrl ?? '';
  coverFilePath.value = settings.coverFilePath ?? '';
  useCustomCover = Boolean(settings.useCustomCover);
  setToggle(toggleUseCustom, useCustomCover);
  const builtInCovers = ['excel', 'vscode', 'docs', 'jira', 'bi', 'black'] as const;
  const builtIn =
    builtInCovers.includes(settings.coverMode as (typeof builtInCovers)[number])
      ? settings.coverMode
      : (settings.cover ?? 'excel');
  setCoverMode(builtIn);
  whitelistApps = [...settings.whitelist];
  setCustomSourceMode(settings.coverMode === 'file' ? 'file' : 'url');
  muteAudioOn = Boolean(settings.audioMute);
  setToggle(toggleMuteAudio, muteAudioOn);
  autoBlockedOn = Boolean(settings.autoCoverBlocked);
  setToggle(toggleAutoBlocked, autoBlockedOn);
  blockedPanel.classList.toggle('collapsed', !autoBlockedOn);
  blockedWebsiteRules = Array.isArray(settings.blockedWebsites)
    ? settings.blockedWebsites
    : [];
  blockedTitleKeywords = Array.isArray(settings.blockedTitleKeywords)
    ? settings.blockedTitleKeywords
    : [];
  blockedWebsites.value = blockedWebsiteRules.join('\n');
  blockedKeywords.value = blockedTitleKeywords.join('\n');
  applyTheme(settings.theme ?? 'dark');

  hasUnsavedChanges = false;
  savedSnapshot = JSON.stringify(buildSettingsPatch());
}

window.deskoy.onUpgradeRequired((payload) => {
  showUpgradeRequired(payload);
});

// Webhooks are configured in the main process (not user-editable).

window.addEventListener('click', (e) => {
  if (!hotkeyRow.contains(e.target as Node) && recordingHotkey) {
    recordingHotkey = false;
    hotkeyCapture.classList.remove('recording');
    renderHotkeyBadges(currentHotkey);
    hotkeyHint.textContent = hotkeyHintIdleText();
  }
  if (!coverDropdown.contains(e.target as Node)) {
    coverMenu.classList.remove('open');
  }
});

hotkeyRow.addEventListener('click', () => {
  if (!deskoyArmed) {
    setStatus(settingsStatus, 'Arm Deskoy first', 'error');
    return;
  }
  beginHotkeyCapture();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && coverMenu.classList.contains('open')) {
    coverMenu.classList.remove('open');
    return;
  }
  if (!recordingHotkey) return;
  e.preventDefault();
  e.stopPropagation();
  const combo = normalizeCombo(e);
  if (!combo) return;
  if (recordingHotkey) {
    if (isDisallowedHotkey(combo)) {
      recordingHotkey = false;
      hotkeyCapture.classList.remove('recording');
      renderHotkeyBadges(currentHotkey);
      hotkeyHint.textContent = hotkeyHintIdleText();
      setStatus(settingsStatus, 'Arrow keys can’t be used as hotkeys. Try a letter/number key.', 'error');
      return;
    }
    currentHotkey = combo;
    renderHotkeyBadges(combo);
    recordingHotkey = false;
    hotkeyCapture.classList.remove('recording');
    hotkeyHint.textContent = hotkeyHintIdleText();
    markUnsaved();
    return;
  }
});

coverTrigger.addEventListener('click', (ev) => {
  if (coverTrigger.disabled || isCoverModeLocked()) return;
  ev.stopPropagation();
  coverMenu.classList.toggle('open');
});

coverMenu.querySelectorAll<HTMLElement>('.dd-opt').forEach((opt) => {
  opt.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    setCoverMode(opt.dataset.cover ?? 'excel');
    refreshCustomCoverUi();
    coverMenu.classList.remove('open');
    markUnsaved();
  });
});

sourceModeUrl.addEventListener('click', () => {
  if (!useCustomCover) return;
  setCustomSourceMode('url');
  markUnsaved();
});
sourceModeFile.addEventListener('click', () => {
  if (!useCustomCover) return;
  setCustomSourceMode('file');
  markUnsaved();
});
customSourceInput.addEventListener('input', () => {
  if (!useCustomCover || customSourceMode !== 'url') return;
  coverUrl.value = customSourceInput.value;
  refreshCustomCoverUi();
  markUnsaved();
});
btnPickCoverFile.addEventListener('click', async () => {
  if (!useCustomCover) return;
  const res = await window.deskoy.pickCoverFile();
  if (res.ok && res.path) {
    setCustomSourceMode('file');
    coverFilePath.value = res.path;
    filePathDisplay.value = res.path;
    refreshCustomCoverUi();
    markUnsaved();
  }
});

toggleMuteAudio.addEventListener('click', async () => {
  if (toggleMuteAudio.disabled) return;
  muteAudioOn = !muteAudioOn;
  setToggle(toggleMuteAudio, muteAudioOn);
  markUnsaved();
});

toggleAutoBlocked.addEventListener('click', async () => {
  autoBlockedOn = !autoBlockedOn;
  setToggle(toggleAutoBlocked, autoBlockedOn);
  blockedPanel.classList.toggle('collapsed', !autoBlockedOn);
  markUnsaved();
});

function normalizeKeywordLines(raw: string): string[] {
  return raw
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .map((s) => {
      const m = s.match(/^["']([\s\S]*)["']$/);
      return m ? m[1].trim() : s;
    })
    .filter((s) => s.length > 0);
}

blockedKeywords.addEventListener('input', () => {
  blockedTitleKeywords = normalizeKeywordLines(blockedKeywords.value);
  markUnsaved();
});
blockedWebsites.addEventListener('input', () => {
  blockedWebsiteRules = normalizeKeywordLines(blockedWebsites.value);
  markUnsaved();
});

// (active window debug timer removed)

toggleUseCustom.addEventListener('click', async () => {
  useCustomCover = !useCustomCover;
  setToggle(toggleUseCustom, useCustomCover);
  if (useCustomCover && muteAudioOn) {
    muteAudioOn = false;
    setToggle(toggleMuteAudio, muteAudioOn);
  }
  refreshCustomCoverUi();
  markUnsaved();
});

btnSave.addEventListener('click', async () => {
  if (btnSave.disabled) return;
  btnSave.disabled = true;
  try {
    const res = await window.deskoy.saveSettings(buildSettingsPatch());
    if (res.ok) {
      setStatus(settingsStatus, 'Saved', 'ok');
      hasUnsavedChanges = false;
      savedSnapshot = JSON.stringify(buildSettingsPatch());
    } else {
      const msg =
        res.error === 'hotkey_unavailable'
          ? 'That hotkey can’t be used, try again.'
          : 'Something went wrong';
      setStatus(settingsStatus, msg, 'error');
    }
  } finally {
    btnSave.disabled = false;
  }
});

btnToggle.addEventListener('click', async () => {
  if (hasUnsavedChanges) {
    setStatus(settingsStatus, 'Save changes first', 'error');
    return;
  }
  if (btnToggle.disabled) return;
  btnToggle.disabled = true;
  try {
    const res = await window.deskoy.toggle();
    if (!res.ok) {
      const err = res.error ?? 'Toggle failed.';
      const errLabel =
        err === 'hotkey_unavailable' ? 'That hotkey is in use.' : err;
      setStatus(settingsStatus, errLabel, 'error');
    } else {
      setStatus(settingsStatus, res.active ? 'Deskoy activated' : 'Deskoy deactivated', 'ok');
      setActiveState(res.active);
    }
  } finally {
    btnToggle.disabled = false;
  }
});

btnMinimize.addEventListener('click', async () => {
  await window.deskoy.windowMinimize();
});

// Maximize removed (fixed-size window).

btnClose.addEventListener('click', async () => {
  await window.deskoy.windowClose();
});

window.deskoy.onStateChanged((s: { active: boolean; paused?: boolean }) => {
  setActiveState(s.active);
});

// Maximize removed (fixed-size window).

window.deskoy.onCoverFallback((info: { reason: string }) => {
  setStatus(settingsStatus, info.reason, 'error');
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (recordingHotkey) return;
    btnSave.click();
  }
});
  void refresh();
  void window.deskoy.getAppVersion().then((meta) => {
  const vText = `v${meta.version}`;
  appVersion.textContent = vText;
  spAppVersion.textContent = vText;
});

btnHelp.addEventListener('click', () => {
  void window.deskoy.openExternal(HELP_URL);
});

btnChangelog.addEventListener('click', () => {
  void window.deskoy.openExternal(CHANGELOG_URL);
});

/* ── Settings side panel ──────────────────────────── */
// Feedback/bug reports: main process → API relay → Discord (see deskoy-relay/ in this repo).

function openSettingsPanel() {
  if (upgradeRequiredActive) return;
  spPanel.classList.remove('closing');
  spBackdrop.classList.add('open');
  spPanel.classList.add('open');
  spAppVersion.textContent = appVersion.textContent || '—';
  setSettingsPage('general');
  refreshGeneralPanel();
}

function closeSettingsPanel() {
  if (!spPanel.classList.contains('open')) return;
  spPanel.classList.remove('open');
  spPanel.classList.add('closing');
  spBackdrop.classList.remove('open');
  const onEnd = () => {
    spPanel.removeEventListener('transitionend', onEnd);
    spPanel.classList.remove('closing');
  };
  spPanel.addEventListener('transitionend', onEnd);
}

function isSettingsPanelOpen() {
  return spPanel.classList.contains('open');
}

btnGear.addEventListener('click', () => {
  if (upgradeRequiredActive) return;
  if (isSettingsPanelOpen()) closeSettingsPanel();
  else openSettingsPanel();
});
spClose.addEventListener('click', closeSettingsPanel);
spBackdrop.addEventListener('click', closeSettingsPanel);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSettingsPanelOpen()) {
    e.stopPropagation();
    closeSettingsPanel();
  }
});

/* Theme switching */
function resolveTheme(pref: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

function applyTheme(pref: 'dark' | 'light' | 'system') {
  currentTheme = pref;
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);

  spThemeTrack.querySelectorAll<HTMLButtonElement>('.sp-seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === pref);
  });
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (currentTheme === 'system') applyTheme('system');
});

spThemeTrack.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sp-seg-btn');
  if (!btn || !btn.dataset.theme) return;
  const theme = btn.dataset.theme as 'dark' | 'light' | 'system';
  applyTheme(theme);
  void window.deskoy.saveSettings({ theme });
});

/* ── Feedback form ──────────────────────────────── */
function setFormStatus(statusEl: HTMLElement, msg: string, type: 'ok' | 'error' | '') {
  statusEl.textContent = msg;
  statusEl.classList.remove('ok', 'error');
  if (type) statusEl.classList.add(type);
  if (msg) setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('ok', 'error'); }, 4000);
}

function isValidEmail(email: string): boolean {
  // Practical validation: disallow spaces, require one "@", and a dot in domain part.
  // (We avoid over-strict RFC validation to reduce false negatives.)
  if (!email) return true;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function flashInputError(elm: HTMLInputElement) {
  elm.classList.add('sp-input--error');
  window.setTimeout(() => elm.classList.remove('sp-input--error'), 1200);
}

async function collectDiagnostics() {
  try {
    const diagnostics = await window.deskoy.getDiagnostics();
    if (diagnostics.ok && diagnostics.data) return diagnostics.data;
  } catch {
    // Fall back to the minimal payload used before the native diagnostics exporter existed.
  }
  return { version: appVersion.textContent || null, theme: currentTheme, armed: deskoyArmed };
}

spFeedbackSend.addEventListener('click', async () => {
  const text = spFeedbackText.value.trim();
  if (!text) { setFormStatus(spFeedbackStatus, 'Please enter your feedback.', 'error'); return; }
  spFeedbackSend.disabled = true;
  try {
    const email = spFeedbackEmail.value.trim();
    if (email && !isValidEmail(email)) {
      flashInputError(spFeedbackEmail);
      setFormStatus(spFeedbackStatus, 'Please enter a valid email address.', 'error');
      return;
    }
    const diagnostics = await collectDiagnostics();
    const res = await window.deskoy.sendFeedback({ message: text, email: email || undefined, diagnostics });
    if (res.ok) {
      setFormStatus(spFeedbackStatus, 'Sent! Thank you.', 'ok');
      spFeedbackText.value = '';
      spFeedbackEmail.value = '';
    } else if (res.error === 'rate_limited') {
      setFormStatus(spFeedbackStatus, 'You can send feedback again after five hours.', 'error');
    } else {
      setFormStatus(spFeedbackStatus, 'Failed to send. Try again.', 'error');
    }
  } catch {
    setFormStatus(spFeedbackStatus, 'Network error. Check your connection.', 'error');
  } finally {
    spFeedbackSend.disabled = false;
  }
});

/* ── Bug report form with image attach ────────────── */
let bugImageBase64: string | null = null;

spBugAttachPrompt.addEventListener('click', () => spBugFileInput.click());

spBugFileInput.addEventListener('change', () => {
  const file = spBugFileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    bugImageBase64 = reader.result as string;
    spBugPreviewImg.src = bugImageBase64;
    spBugPreview.hidden = false;
    spBugAttachPrompt.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

spBugRemoveImg.addEventListener('click', () => {
  bugImageBase64 = null;
  spBugFileInput.value = '';
  spBugPreviewImg.src = '';
  spBugPreview.hidden = true;
  spBugAttachPrompt.style.display = '';
});

spBugSend.addEventListener('click', async () => {
  const text = spBugText.value.trim();
  if (!text) { setFormStatus(spBugStatus, 'Please describe the bug.', 'error'); return; }
  spBugSend.disabled = true;
  try {
    const includeDiagnostics = spBugDiag.checked;
    const email = spBugEmail.value.trim();
    if (email && !isValidEmail(email)) {
      flashInputError(spBugEmail);
      setFormStatus(spBugStatus, 'Please enter a valid email address.', 'error');
      return;
    }
    const steps = spBugSteps.value.trim();
    const diagnostics = includeDiagnostics
      ? await collectDiagnostics()
      : undefined;
    const res = await window.deskoy.sendBugReport({
      message: text,
      steps: steps || undefined,
      email: email || undefined,
      screenshot: bugImageBase64 || undefined,
      diagnostics,
    });
    if (res.ok) {
      setFormStatus(spBugStatus, 'Report sent! Thank you.', 'ok');
      spBugText.value = '';
      spBugSteps.value = '';
      spBugEmail.value = '';
      bugImageBase64 = null;
      spBugFileInput.value = '';
      spBugPreviewImg.src = '';
      spBugPreview.hidden = true;
      spBugAttachPrompt.style.display = '';
    } else if (res.error === 'rate_limited') {
      setFormStatus(spBugStatus, 'You can send another report after five hours.', 'error');
    } else {
      setFormStatus(spBugStatus, 'Failed to send. Try again later.', 'error');
    }
  } catch {
    setFormStatus(spBugStatus, 'Network error. Check your connection.', 'error');
  } finally {
    spBugSend.disabled = false;
  }
});

spChangelog.addEventListener('click', () => {
  void window.deskoy.openExternal(CHANGELOG_URL);
});

spHelp.addEventListener('click', () => {
  void window.deskoy.openExternal(HELP_URL);
});

mountUpdatesPanel(el<HTMLElement>('spUpdatesRoot'));

function openDeskoyStatusPage() {
  void window.deskoy.openExternal(STATUS_PAGE_URL);
}
spAboutStatus.addEventListener('click', openDeskoyStatusPage);
spStatusPageGeneral.addEventListener('click', openDeskoyStatusPage);

type SettingsPage = 'general' | 'appearance' | 'feedback' | 'bug' | 'logs' | 'updates' | 'about';

function setSettingsPage(page: SettingsPage) {
  const nav: Array<[HTMLButtonElement, SettingsPage]> = [
    [spNavGeneral, 'general'],
    [spNavAppearance, 'appearance'],
    [spNavFeedback, 'feedback'],
    [spNavBug, 'bug'],
    [spNavLogs, 'logs'],
    [spNavUpdates, 'updates'],
    [spNavAbout, 'about'],
  ];
  nav.forEach(([btn, p]) => btn.classList.toggle('active', p === page));

  const pages: Array<[HTMLElement, SettingsPage]> = [
    [spPageGeneral, 'general'],
    [spPageAppearance, 'appearance'],
    [spPageFeedback, 'feedback'],
    [spPageBug, 'bug'],
    [spPageLogs, 'logs'],
    [spPageUpdates, 'updates'],
    [spPageAbout, 'about'],
  ];
  pages.forEach(([elm, p]) => elm.classList.toggle('active', p === page));

  const titleMap: Record<SettingsPage, string> = {
    general: 'Settings',
    appearance: 'Appearance',
    feedback: 'Feedback',
    bug: 'Bug Report',
    logs: 'Logs',
    updates: 'Updates',
    about: 'About',
  };
  spHeaderTitle.textContent = titleMap[page];

  if (page === 'general') refreshGeneralPanel();
  if (page === 'logs') void refreshLogsPanel();
  if (page === 'updates') void refreshUpdatesPanel();
}

function bindNav(btn: HTMLButtonElement, page: SettingsPage) {
  btn.addEventListener('click', () => setSettingsPage(page));
}
bindNav(spNavGeneral, 'general');
bindNav(spNavAppearance, 'appearance');
bindNav(spNavFeedback, 'feedback');
bindNav(spNavBug, 'bug');
bindNav(spNavLogs, 'logs');
bindNav(spNavUpdates, 'updates');
bindNav(spNavAbout, 'about');

function refreshGeneralPanel() {
  spGeneralVersion.textContent = appVersion.textContent || '—';
  spGeneralHotkey.textContent = currentHotkey.trim() ? currentHotkey : 'Not set';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLogTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function refreshLogsPanel() {
  try {
    const logs = await window.deskoy.getProtectionLogs();
    spClearLogs.disabled = logs.length === 0;
    if (!logs.length) {
      spLogsList.innerHTML = '<p class="sp-logs-empty">No auto-protect events yet.</p>';
      return;
    }
    spLogsList.innerHTML = logs
      .map((log) => {
        const processName = escapeHtml(log.processName || 'Unknown process');
        const title = escapeHtml(log.title || 'Untitled window');
        const action = escapeHtml(log.action || 'Protected');
        return `<div class="sp-log-row">
          <div class="sp-log-top">
            <span class="sp-log-process">${processName}</span>
            <span class="sp-log-time">${formatLogTime(log.timestamp)}</span>
          </div>
          <div class="sp-log-title">${title}</div>
          <div class="sp-log-action">${action}</div>
        </div>`;
      })
      .join('');
  } catch {
    spClearLogs.disabled = true;
    spLogsList.innerHTML = '<p class="sp-logs-empty">Could not load logs.</p>';
  }
}

spClearLogs.addEventListener('click', async () => {
  spClearLogs.disabled = true;
  spLogsStatus.textContent = '';
  try {
    const result = await window.deskoy.clearProtectionLogs();
    if (!result.ok) throw new Error(result.error || 'Unable to clear logs.');
    setStatus(spLogsStatus, 'Logs cleared.', 'ok');
    await refreshLogsPanel();
  } catch {
    setStatus(spLogsStatus, 'Could not clear logs.', 'error');
    spClearLogs.disabled = false;
  }
});

spGoHotkey.addEventListener('click', () => {
  closeSettingsPanel();
  setTimeout(() => {
    const row = document.getElementById('hotkeyRow');
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row?.classList.add('clickable'); // keep existing hover affordance
  }, 220);
});
spHelp.addEventListener('click', () => {
  void window.deskoy.openExternal(HELP_URL);
});
}
