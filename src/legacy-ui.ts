import brandLogoUrl from '../assets/logo.png';
import { mountUpdatesPanel, refreshUpdatesPanel } from './components/UpdatesPanel';

let deskoyUiAttached = false;

export function attachDeskoyUi(): void {
if (deskoyUiAttached) return;
deskoyUiAttached = true;

/** Matches `saveSettings` / store `coverMode` in `global.d.ts`. */
type DeskoyCoverMode = 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
type DeskoyBuiltInCover = Exclude<DeskoyCoverMode, 'url' | 'file'>;
type DeskoyDisplay = Awaited<ReturnType<Window['deskoy']['getDisplays']>>['displays'][number];
type DeskoyFontSize = 'small' | 'default' | 'large';
type DeskoySettings = Awaited<ReturnType<Window['deskoy']['getSettings']>>;
type DeskoyProfile = DeskoySettings['profiles'][number];
type DeskoyProfileSettings = DeskoyProfile['settings'];
type DeskoyUpdatesPayload = {
  ok: true;
  visible?: boolean;
  title?: string;
  version?: string;
  notes?: string;
  downloadUrl?: string;
};
type NativeUpdatePayload = Awaited<ReturnType<Window['deskoy']['checkAppUpdate']>>;
type ProfileDialogResult = { confirmed: boolean; value?: string };
type ProfileDialogOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  input?: {
    label: string;
    placeholder?: string;
    value?: string;
  };
};

const PROFILE_DIALOG_ADD_ICON = `
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
const PROFILE_DIALOG_DELETE_ICON = `
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M16 6V5.2C16 4.0799 16 3.51984 15.782 3.09202C15.5903 2.71569 15.2843 2.40973 14.908 2.21799C14.4802 2 13.9201 2 12.8 2H11.2C10.0799 2 9.51984 2 9.09202 2.21799C8.71569 2.40973 8.40973 2.71569 8.21799 3.09202C8 3.51984 8 4.0799 8 5.2V6M3 6H21M19 6V17.2C19 18.8802 19 19.7202 18.673 20.362C18.3854 20.9265 17.9265 21.3854 17.362 21.673C16.7202 22 15.8802 22 14.2 22H9.8C8.11984 22 7.27976 22 6.63803 21.673C6.07354 21.3854 5.6146 20.9265 5.32698 20.362C5 19.7202 5 18.8802 5 17.2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

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

function parseVersionParts(version: string): number[] | null {
  const normalized = version.trim().replace(/^v/i, '').split(/[+-]/, 1)[0];
  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) return null;
  return normalized.split('.').map((part) => Number(part));
}

function compareVersions(a: string, b: string): number | null {
  const aParts = parseVersionParts(a);
  const bParts = parseVersionParts(b);
  if (!aParts || !bParts) return null;
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i += 1) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart !== bPart) return aPart > bPart ? 1 : -1;
  }
  return 0;
}

function updateVersionIsNewer(updateVersion: string, installedVersion: string): boolean {
  const comparison = compareVersions(updateVersion, installedVersion);
  return comparison === null || comparison > 0;
}

function nativeUpdateIsAvailable(native: NativeUpdatePayload, installedVersion: string): boolean {
  if (!native.ok || !native.available) return false;
  if (!native.version || !installedVersion) return true;
  return updateVersionIsNewer(native.version, installedVersion);
}

function displayUpdateVersion(version: string): string {
  const value = version.trim();
  if (!value) return '';
  return value.toLowerCase().startsWith('v') ? value : `v${value}`;
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
const statusPill = el<HTMLElement>('pillState');
const updateNotice = document.createElement('button');
updateNotice.type = 'button';
updateNotice.className = 'update-notice';
updateNotice.hidden = true;
updateNotice.innerHTML = `
  <span class="update-notice-icon" aria-hidden="true">📢</span>
  <span class="update-notice-sep" aria-hidden="true"></span>
  <span class="update-notice-text" id="updateNoticeText">Deskoy update is out</span>
  <span class="update-notice-action">Download</span>
  <svg class="update-notice-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
const profileDropdown = document.createElement('div');
profileDropdown.className = 'profile-dropdown';
profileDropdown.innerHTML = `
  <button type="button" class="profile-pill" id="profileTrigger" aria-haspopup="menu" aria-expanded="false">
    <span class="profile-label" id="profileLabel">Create profile</span>
    <svg class="profile-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <div class="profile-menu" id="profileMenu" role="menu"></div>
`;
statusPill.parentElement?.insertBefore(updateNotice, statusPill);
statusPill.parentElement?.insertBefore(profileDropdown, statusPill);
const updateNoticeText = updateNotice.querySelector<HTMLElement>('#updateNoticeText')!;
function setUpdateNoticeVisible(version: string) {
  const label = displayUpdateVersion(version);
  updateNoticeText.textContent = label ? `Deskoy ${label} is out` : 'Deskoy update is out';
  updateNotice.hidden = false;
}

function hideUpdateNotice() {
  updateNotice.hidden = true;
}

async function refreshUpdateNotice() {
  try {
    const [meta, res, native] = await Promise.all([
      window.deskoy.getAppVersion(),
      window.deskoy.getUpdates(),
      window.deskoy.checkAppUpdate().catch(
        (): NativeUpdatePayload => ({
          ok: false,
          configured: false,
          available: false,
          error: 'native_update_failed',
        }),
      ),
    ]);

    const data = res.ok ? (res.data as Partial<DeskoyUpdatesPayload> | undefined) : undefined;
    if (res.ok && (!data || data.ok !== true)) {
      hideUpdateNotice();
      return;
    }

    const currentAppVersion = meta.version.trim();
    const version = typeof data?.version === 'string' ? data.version.trim() : '';
    const visible = Boolean(data?.visible);
    const nativeAvailable = nativeUpdateIsAvailable(native, currentAppVersion);
    const feedAvailable =
      visible &&
      (!version || !currentAppVersion || updateVersionIsNewer(version, currentAppVersion));

    if (!feedAvailable && !nativeAvailable) {
      hideUpdateNotice();
      return;
    }

    setUpdateNoticeVisible(nativeAvailable && native.version ? native.version : version);
  } catch {
    hideUpdateNotice();
  }
}

const profileTrigger = profileDropdown.querySelector<HTMLButtonElement>('#profileTrigger')!;
const profileLabel = profileDropdown.querySelector<HTMLElement>('#profileLabel')!;
const profileMenu = profileDropdown.querySelector<HTMLElement>('#profileMenu')!;
const profileDialogOverlay = document.createElement('div');
profileDialogOverlay.className = 'modal-overlay profile-dialog-overlay';
profileDialogOverlay.innerHTML = `
  <div class="lic-modal profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profileDialogTitle" aria-describedby="profileDialogMessage">
    <div class="lic-modal__header profile-dialog-header">
      <div class="lic-modal__header-left">
        <span class="profile-dialog-icon" aria-hidden="true">
          ${PROFILE_DIALOG_ADD_ICON}
        </span>
        <div>
          <h2 id="profileDialogTitle" class="lic-modal__title profile-dialog-title"></h2>
          <p id="profileDialogMessage" class="lic-modal__subtitle profile-dialog-message"></p>
        </div>
      </div>
    </div>
    <div class="lic-modal__body profile-dialog-body">
      <label class="profile-dialog-field" id="profileDialogField" hidden>
        <span class="profile-dialog-label" id="profileDialogInputLabel"></span>
        <input class="sp-input profile-dialog-input" id="profileDialogInput" type="text" maxlength="40" autocomplete="off" />
        <span class="profile-dialog-error" id="profileDialogError"></span>
      </label>
      <div class="lic-btns profile-dialog-actions">
        <button type="button" class="btn btn-ghost" id="profileDialogCancel">Cancel</button>
        <button type="button" class="btn btn-primary profile-dialog-confirm" id="profileDialogConfirm">Save</button>
      </div>
    </div>
  </div>
`;
document.body.appendChild(profileDialogOverlay);
const profileDialogIcon = profileDialogOverlay.querySelector<HTMLElement>('.profile-dialog-icon')!;
const profileDialogTitle = profileDialogOverlay.querySelector<HTMLElement>('#profileDialogTitle')!;
const profileDialogMessage = profileDialogOverlay.querySelector<HTMLElement>('#profileDialogMessage')!;
const profileDialogField = profileDialogOverlay.querySelector<HTMLElement>('#profileDialogField')!;
const profileDialogInputLabel = profileDialogOverlay.querySelector<HTMLElement>('#profileDialogInputLabel')!;
const profileDialogInput = profileDialogOverlay.querySelector<HTMLInputElement>('#profileDialogInput')!;
const profileDialogError = profileDialogOverlay.querySelector<HTMLElement>('#profileDialogError')!;
const profileDialogCancel = profileDialogOverlay.querySelector<HTMLButtonElement>('#profileDialogCancel')!;
const profileDialogConfirm = profileDialogOverlay.querySelector<HTMLButtonElement>('#profileDialogConfirm')!;
const toggleMuteAudio = el<HTMLButtonElement>('toggleMuteAudio');
const toggleUseCustom = el<HTMLButtonElement>('toggleUseCustom');
const toggleAutoBlocked = el<HTMLButtonElement>('toggleAutoBlocked');
const blockedWebsites = el<HTMLTextAreaElement>('blockedWebsites');
const blockedKeywords = el<HTMLTextAreaElement>('blockedKeywords');
// Active window debug panel removed from UI.
const customSourcePanel = el<HTMLElement>('customSourcePanel');
const blockedPanel = el<HTMLElement>('blockedPanel');
const autoProtectCollapse = document.createElement('button');
autoProtectCollapse.type = 'button';
autoProtectCollapse.className = 'auto-protect-collapse-btn';
autoProtectCollapse.hidden = true;
autoProtectCollapse.setAttribute('aria-label', 'Collapse Auto Protect settings');
autoProtectCollapse.setAttribute('aria-expanded', 'true');
autoProtectCollapse.innerHTML = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
toggleAutoBlocked.parentElement?.insertBefore(autoProtectCollapse, toggleAutoBlocked);
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
const spLogsSubtitle = spPageLogs.querySelector<HTMLElement>('.sp-page-sub')!;
spLogsSubtitle.textContent = 'Recent cover activity and auto-protect events.';
const spPageUpdates = el<HTMLElement>('spPageUpdates');
const spPageAbout = el<HTMLElement>('spPageAbout');
const spThemeTrack = el<HTMLElement>('spThemeTrack');
const spAppearanceOptions = document.createElement('div');
spAppearanceOptions.className = 'sp-card sp-appearance-options';
spAppearanceOptions.innerHTML = `
  <div class="sp-list-row">
    <div class="sp-row-left">
      <div class="sp-row-title">Font size</div>
      <div class="sp-row-sub">Make Deskoy text smaller or larger.</div>
    </div>
    <div class="sp-row-right">
      <div class="sp-seg-track sp-font-size-track" id="spFontSizeTrack">
        <button type="button" class="sp-seg-btn" data-font-size="small">Small</button>
        <button type="button" class="sp-seg-btn active" data-font-size="default">Default</button>
        <button type="button" class="sp-seg-btn" data-font-size="large">Large</button>
      </div>
    </div>
  </div>
  <div class="sp-list-row">
    <div class="sp-row-left">
      <div class="sp-row-title">Compact mode</div>
      <div class="sp-row-sub">Use tighter spacing in Deskoy.</div>
    </div>
    <div class="sp-row-right">
      <button type="button" class="toggle" id="spToggleCompactMode" aria-label="Compact mode" aria-pressed="false"></button>
    </div>
  </div>
  <div class="sp-list-row">
    <div class="sp-row-left">
      <div class="sp-row-title">Reduce motion</div>
      <div class="sp-row-sub">Turn off extra animations.</div>
    </div>
    <div class="sp-row-right">
      <button type="button" class="toggle" id="spToggleReduceMotion" aria-label="Reduce motion" aria-pressed="false"></button>
    </div>
  </div>
`;
spPageAppearance.appendChild(spAppearanceOptions);
const spFontSizeTrack = spAppearanceOptions.querySelector<HTMLElement>('#spFontSizeTrack')!;
const spToggleCompactMode = spAppearanceOptions.querySelector<HTMLButtonElement>('#spToggleCompactMode')!;
const spToggleReduceMotion = spAppearanceOptions.querySelector<HTMLButtonElement>('#spToggleReduceMotion')!;
const spGeneralHotkey = el<HTMLElement>('spGeneralHotkey');
const spGeneralVersion = el<HTMLElement>('spGeneralVersion');
const spGoHotkey = el<HTMLButtonElement>('spGoHotkey');
spGeneralVersion.remove();

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
spPageGeneral.querySelector('.sp-general-split')?.remove();
const spGeneralStatusSection = document.createElement('section');
spGeneralStatusSection.className = 'sp-general-status-section';
spGeneralStatusSection.innerHTML = `
  <div class="sp-general-status-grid">
    <div class="sp-general-stat">
      <span class="sp-general-stat-label">Version</span>
      <span class="sp-general-stat-value" id="spGeneralStatusVersion">—</span>
    </div>
    <div class="sp-general-stat">
      <span class="sp-general-stat-label">Cover</span>
      <span class="sp-general-stat-value" id="spGeneralStatusCover">—</span>
    </div>
    <div class="sp-general-stat">
      <span class="sp-general-stat-label">Auto Protect</span>
      <span class="sp-general-stat-value" id="spGeneralStatusAutoProtect">Off</span>
    </div>
  </div>
`;
const spGeneralStatusVersion = spGeneralStatusSection.querySelector<HTMLElement>('#spGeneralStatusVersion')!;
const spGeneralStatusCover = spGeneralStatusSection.querySelector<HTMLElement>('#spGeneralStatusCover')!;
const spGeneralStatusAutoProtect = spGeneralStatusSection.querySelector<HTMLElement>('#spGeneralStatusAutoProtect')!;
const spCoverDisplaySection = document.createElement('section');
spCoverDisplaySection.className = 'sp-cover-display-section';
spCoverDisplaySection.innerHTML = `
  <div class="sp-cover-display-head">
    <div>
      <h3 class="sp-split-heading">Cover Display</h3>
      <p class="sp-cover-display-desc">Choose where the cover appears.</p>
    </div>
    <span class="sp-cover-display-chip" id="spCoverDisplayChip">Checking</span>
  </div>
  <div class="sp-cover-display-body" id="spCoverDisplayBody"></div>
`;
const spCoverDisplayBody = spCoverDisplaySection.querySelector<HTMLElement>('#spCoverDisplayBody')!;
const spCoverDisplayChip = spCoverDisplaySection.querySelector<HTMLElement>('#spCoverDisplayChip')!;
spPageGeneral.querySelector('.sp-page-head')?.after(spGeneralStatusSection);
spStatusPageGeneral.closest('.sp-status-section')?.before(spCoverDisplaySection);

const statusTimers = new WeakMap<HTMLElement, number>();
let hasUnsavedChanges = false;
let savedSnapshot = '';
let currentTheme: 'dark' | 'light' | 'system' = 'dark';
let compactModeOn = false;
let currentFontSize: DeskoyFontSize = 'default';
let reduceMotionOn = false;
let muteAudioOn = false;
let whitelistApps: string[] = [];
let blockedAppRules: string[] = [];
let activeProfileId = 'default';
let profiles: DeskoyProfile[] = [];
let profileDialogResolve: ((result: ProfileDialogResult) => void) | null = null;
let profileDialogHasInput = false;
let profileDialogReturnFocus: HTMLElement | null = null;
/** Mirrors settings.enabled — global hotkey only works when true; hotkey capture UI only when true. */
let deskoyArmed = false;
/** When true, custom URL/file overrides the Cover mode dropdown. */
let useCustomCover = false;
let customSourceMode: 'url' | 'file' = 'url';
let coverDisplay = 'all';
let availableDisplays: DeskoyDisplay[] = [];
let recordingHotkey = false;
let currentHotkey = '';
let autoBlockedOn = false;
let blockedPanelCollapsed = true;
let blockedWebsiteRules: string[] = [];
let blockedTitleKeywords: string[] = [];

function markUnsaved() {
  const current = JSON.stringify(buildSettingsPatch());
  if (current === savedSnapshot) {
    hasUnsavedChanges = false;
    settingsStatus.classList.remove('show');
    renderProfileTrigger();
    return;
  }
  hasUnsavedChanges = true;
  renderProfileTrigger();
  setStatus(settingsStatus, 'Unsaved changes', 'muted', true);
}

function normalizeCoverDisplayValue(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === 'all') return 'all';
  return /^monitor:\d+$/.test(trimmed) ? trimmed : 'all';
}

function displayLabel(display: DeskoyDisplay, index: number): string {
  const name = display.name.trim();
  return name || `Display ${index + 1}`;
}

function displaySummary(display: DeskoyDisplay): string {
  return `${display.width}x${display.height}${display.primary ? ' primary' : ''}`;
}

function activeCoverDisplayValue(): string {
  const match = coverDisplay.match(/^monitor:(\d+)$/);
  if (!match || availableDisplays.length === 0) return coverDisplay;
  const index = Number(match[1]);
  if (availableDisplays.some((display) => display.id === index)) return coverDisplay;
  return `monitor:${availableDisplays[Math.min(index, availableDisplays.length - 1)].id}`;
}

function renderCoverDisplayPicker() {
  if (!spCoverDisplayBody || !spCoverDisplayChip) return;
  if (!availableDisplays.length) {
    spCoverDisplayChip.textContent = 'Unavailable';
    spCoverDisplayBody.innerHTML = '<p class="sp-cover-display-empty">Display selection is unavailable right now.</p>';
    return;
  }

  if (availableDisplays.length === 1) {
    const display = availableDisplays[0];
    spCoverDisplayChip.textContent = '1 display';
    spCoverDisplayBody.innerHTML = `
      <div class="sp-cover-single-display">
        <div class="sp-cover-single-screen"><span>1</span></div>
        <div>
          <div class="sp-cover-single-title">Using your only display</div>
          <div class="sp-cover-single-sub">${escapeHtml(displaySummary(display))}</div>
        </div>
      </div>
    `;
    return;
  }

  spCoverDisplayChip.textContent = `${availableDisplays.length} displays`;
  const activeValue = activeCoverDisplayValue();
  const minX = Math.min(...availableDisplays.map((display) => display.x));
  const minY = Math.min(...availableDisplays.map((display) => display.y));
  const maxX = Math.max(...availableDisplays.map((display) => display.x + display.width));
  const maxY = Math.max(...availableDisplays.map((display) => display.y + display.height));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const monitorButtons = availableDisplays
    .map((display, index) => {
      const value = `monitor:${display.id}`;
      const selected = activeValue === value;
      const style = [
        `--display-left:${(((display.x - minX) / spanX) * 100).toFixed(2)}%`,
        `--display-top:${(((display.y - minY) / spanY) * 100).toFixed(2)}%`,
        `--display-width:${Math.max(15, (display.width / spanX) * 100).toFixed(2)}%`,
        `--display-height:${Math.max(24, (display.height / spanY) * 100).toFixed(2)}%`,
      ].join(';');
      return `<button type="button" class="sp-monitor-tile${selected ? ' active' : ''}" data-cover-display="${value}" style="${style}" aria-pressed="${selected}">
        <span class="sp-monitor-number">${index + 1}</span>
        <span class="sp-monitor-name">${escapeHtml(displayLabel(display, index))}</span>
        ${display.primary ? '<span class="sp-monitor-primary">Primary</span>' : ''}
      </button>`;
    })
    .join('');

  spCoverDisplayBody.innerHTML = `
    <div class="sp-cover-display-choice-row">
      <button type="button" class="sp-display-choice${coverDisplay === 'all' ? ' active' : ''}" data-cover-display="all" aria-pressed="${coverDisplay === 'all'}">
        <span class="sp-display-choice-title">All displays</span>
        <span class="sp-display-choice-sub">Cover every connected screen</span>
      </button>
      ${availableDisplays
        .map((display, index) => {
          const value = `monitor:${display.id}`;
          const selected = activeValue === value && coverDisplay !== 'all';
          return `<button type="button" class="sp-display-choice${selected ? ' active' : ''}" data-cover-display="${value}" aria-pressed="${selected}">
            <span class="sp-display-choice-title">Display ${index + 1}</span>
            <span class="sp-display-choice-sub">${escapeHtml(displaySummary(display))}</span>
          </button>`;
        })
        .join('')}
    </div>
    <div class="sp-monitor-map" aria-label="Connected displays">
      ${monitorButtons}
    </div>
  `;
}

async function refreshCoverDisplayList() {
  try {
    const result = await window.deskoy.getDisplays();
    availableDisplays = result.ok && Array.isArray(result.displays) ? result.displays : [];
  } catch {
    availableDisplays = [];
  }
  renderCoverDisplayPicker();
}

spCoverDisplaySection.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-cover-display]');
  if (!button || !spCoverDisplaySection.contains(button)) return;
  const next = normalizeCoverDisplayValue(button.dataset.coverDisplay);
  if (next === coverDisplay) return;
  coverDisplay = next;
  renderCoverDisplayPicker();
  markUnsaved();
});
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
const builtInCovers = ['excel', 'vscode', 'docs', 'jira', 'bi', 'black'] as const;
const defaultProfileId = 'default';

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

function setBlockedPanelCollapsed(collapsed: boolean) {
  blockedPanelCollapsed = collapsed;
  blockedPanel.classList.toggle('collapsed', collapsed);
  autoProtectCollapse.hidden = !autoBlockedOn;
  autoProtectCollapse.classList.toggle('is-collapsed', collapsed);
  autoProtectCollapse.setAttribute('aria-expanded', String(!collapsed));
  autoProtectCollapse.setAttribute(
    'aria-label',
    collapsed ? 'Expand Auto Protect settings' : 'Collapse Auto Protect settings',
  );
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
  refreshGeneralPanel();
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

function normalizeBuiltInCover(value: string | undefined): DeskoyBuiltInCover {
  return builtInCovers.includes(value as DeskoyBuiltInCover) ? (value as DeskoyBuiltInCover) : 'excel';
}

function normalizeProfileName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}

function makeProfileId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'profile';
  let id = slug === defaultProfileId ? 'profile-default' : slug;
  let suffix = 2;
  while (profiles.some((profile) => profile.id === id)) {
    id = `${slug}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function profileSettingsFromPatch(patch: DeskoySaveSettingsPatch): DeskoyProfileSettings {
  return {
    coverMode: (patch.coverMode ?? 'excel') as DeskoyProfileSettings['coverMode'],
    cover: (patch.cover ?? 'excel') as DeskoyProfileSettings['cover'],
    coverDisplay: patch.coverDisplay ?? 'all',
    coverUrl: patch.coverUrl ?? '',
    coverFilePath: patch.coverFilePath ?? '',
    audioMute: Boolean(patch.audioMute),
    whitelist: Array.isArray(patch.whitelist) ? [...patch.whitelist] : [],
    useCustomCover: Boolean(patch.useCustomCover),
    autoCoverBlocked: Boolean(patch.autoCoverBlocked),
    blockedApps: Array.isArray(patch.blockedApps) ? [...patch.blockedApps] : [],
    blockedWebsites: Array.isArray(patch.blockedWebsites) ? [...patch.blockedWebsites] : [],
    blockedTitleKeywords: Array.isArray(patch.blockedTitleKeywords) ? [...patch.blockedTitleKeywords] : [],
  };
}

function profileSettingsFromSettings(settings: DeskoySettings): DeskoyProfileSettings {
  return {
    coverMode: settings.coverMode,
    cover: settings.cover,
    coverDisplay: settings.coverDisplay,
    coverUrl: settings.coverUrl,
    coverFilePath: settings.coverFilePath,
    audioMute: settings.audioMute,
    whitelist: [...settings.whitelist],
    useCustomCover: settings.useCustomCover,
    autoCoverBlocked: settings.autoCoverBlocked,
    blockedApps: [...settings.blockedApps],
    blockedWebsites: [...settings.blockedWebsites],
    blockedTitleKeywords: [...settings.blockedTitleKeywords],
  };
}

function freshProfileSettings(): DeskoyProfileSettings {
  return {
    coverMode: 'excel',
    cover: 'excel',
    coverDisplay: 'all',
    coverUrl: '',
    coverFilePath: '',
    audioMute: false,
    whitelist: [],
    useCustomCover: false,
    autoCoverBlocked: false,
    blockedApps: [],
    blockedWebsites: [],
    blockedTitleKeywords: [],
  };
}

function patchFromProfileSettings(settings: DeskoyProfileSettings): DeskoySaveSettingsPatch {
  return {
    coverMode: settings.coverMode,
    cover: settings.cover,
    coverDisplay: settings.coverDisplay,
    coverUrl: settings.coverUrl,
    coverFilePath: settings.coverFilePath,
    audioMute: settings.audioMute,
    whitelist: [...settings.whitelist],
    useCustomCover: settings.useCustomCover,
    autoCoverBlocked: settings.autoCoverBlocked,
    blockedApps: [...settings.blockedApps],
    blockedWebsites: [...settings.blockedWebsites],
    blockedTitleKeywords: [...settings.blockedTitleKeywords],
  };
}

function normalizeProfilesFromSettings(settings: DeskoySettings): DeskoyProfile[] {
  const seen = new Set<string>();
  const normalized = (Array.isArray(settings.profiles) ? settings.profiles : [])
    .map((profile) => ({
      id: profile.id.trim(),
      name: normalizeProfileName(profile.name) || 'Untitled',
      settings: profile.settings,
    }))
    .filter((profile) => {
      if (!profile.id || seen.has(profile.id)) return false;
      seen.add(profile.id);
      return true;
    });

  if (!normalized.some((profile) => profile.id === defaultProfileId)) {
    normalized.unshift({
      id: defaultProfileId,
      name: 'Default',
      settings: profileSettingsFromSettings(settings),
    });
  }

  return normalized.sort((a, b) => {
    if (a.id === defaultProfileId) return -1;
    if (b.id === defaultProfileId) return 1;
    return a.name.localeCompare(b.name);
  });
}

function userProfiles(): DeskoyProfile[] {
  return profiles.filter((profile) => profile.id !== defaultProfileId);
}

function profileSettingsSignature(settings: DeskoyProfileSettings): string {
  return JSON.stringify({
    coverMode: settings.coverMode,
    cover: settings.cover,
    coverDisplay: settings.coverDisplay,
    coverUrl: settings.coverUrl,
    coverFilePath: settings.coverFilePath,
    audioMute: Boolean(settings.audioMute),
    whitelist: [...settings.whitelist],
    useCustomCover: Boolean(settings.useCustomCover),
    autoCoverBlocked: Boolean(settings.autoCoverBlocked),
    blockedApps: [...settings.blockedApps],
    blockedWebsites: [...settings.blockedWebsites],
    blockedTitleKeywords: [...settings.blockedTitleKeywords],
  });
}

function findMatchingUserProfile(settings: DeskoyProfileSettings): DeskoyProfile | undefined {
  const signature = profileSettingsSignature(settings);
  return userProfiles().find((profile) => profileSettingsSignature(profile.settings) === signature);
}

function activeUserProfile(): DeskoyProfile | undefined {
  return userProfiles().find((profile) => profile.id === activeProfileId);
}

function profilesWithDefaultSnapshot(
  sourceProfiles: DeskoyProfile[],
  patch: DeskoySaveSettingsPatch,
): DeskoyProfile[] {
  const settings = profileSettingsFromPatch(patch);
  let hasDefault = false;
  const nextProfiles = sourceProfiles.map((profile) => {
    if (profile.id !== defaultProfileId) return profile;
    hasDefault = true;
    return { ...profile, name: 'Default', settings };
  });

  if (!hasDefault) {
    nextProfiles.unshift({ id: defaultProfileId, name: 'Default', settings });
  }

  return nextProfiles;
}

function activeProfileIdForPatch(patch: DeskoySaveSettingsPatch): string {
  return activeUserProfile()?.id ?? findMatchingUserProfile(profileSettingsFromPatch(patch))?.id ?? defaultProfileId;
}

function profilesForSave(patch: DeskoySaveSettingsPatch): DeskoyProfile[] {
  const activeProfile = activeUserProfile();
  const nextProfiles = activeProfile
    ? profiles.map((profile) =>
        profile.id === activeProfile.id
          ? { ...profile, settings: profileSettingsFromPatch(patch) }
          : profile,
      )
    : profiles;
  return profilesWithDefaultSnapshot(nextProfiles, patch);
}

function buildCoreSettingsPatch(): DeskoySaveSettingsPatch {
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
    coverDisplay,
    coverUrl: trimmedUrl,
    coverFilePath: trimmedFilePath,
    audioMute: muteAudioOn,
    whitelist: [...whitelistApps],
    useCustomCover,
    autoCoverBlocked: autoBlockedOn,
    blockedApps: [...blockedAppRules],
    blockedWebsites: [...blockedWebsiteRules],
    blockedTitleKeywords: [...blockedTitleKeywords],
  };
}

function buildSettingsPatch(): DeskoySaveSettingsPatch {
  const patch = buildCoreSettingsPatch();
  return {
    ...patch,
    activeProfileId: activeProfileIdForPatch(patch),
    profiles: profilesForSave(patch),
  };
}

function renderProfileTrigger() {
  const savedPresets = userProfiles();
  const currentPreset = activeUserProfile() ?? findMatchingUserProfile(profileSettingsFromPatch(buildCoreSettingsPatch()));
  profileLabel.textContent =
    savedPresets.length === 0 ? 'Create profile' : currentPreset?.name ?? 'Custom';
  profileTrigger.classList.toggle('empty', savedPresets.length === 0);
  profileTrigger.setAttribute('aria-haspopup', savedPresets.length === 0 ? 'dialog' : 'menu');
}

function renderProfileMenu() {
  const currentPreset = activeUserProfile() ?? findMatchingUserProfile(profileSettingsFromPatch(buildCoreSettingsPatch()));
  const savedPresets = userProfiles();
  const profileItems = savedPresets
    .map(
      (profile) => `<button type="button" class="profile-menu-item${profile.id === currentPreset?.id ? ' active' : ''}" data-profile-id="${escapeHtml(profile.id)}" role="menuitem">
        <span>${escapeHtml(profile.name)}</span>
      </button>`,
    )
    .join('');
  const separator = savedPresets.length ? '<div class="profile-menu-sep"></div>' : '';
  const deleteAction = currentPreset
    ? `<button type="button" class="profile-menu-item danger" data-profile-action="delete" role="menuitem">Delete "${escapeHtml(currentPreset.name)}"</button>`
    : '';
  profileMenu.innerHTML = `
    ${profileItems}
    ${separator}
    <button type="button" class="profile-menu-item" data-profile-action="save" role="menuitem">${savedPresets.length === 0 ? 'Create profile' : 'Create new profile'}</button>
    ${deleteAction}
  `;
}

function setProfileMenuOpen(open: boolean) {
  profileMenu.classList.toggle('open', open);
  profileTrigger.setAttribute('aria-expanded', String(open));
}

function closeProfileDialog(result: ProfileDialogResult) {
  if (!profileDialogResolve) return;
  const resolve = profileDialogResolve;
  profileDialogResolve = null;
  profileDialogOverlay.classList.remove('show');
  profileDialogInput.classList.remove('sp-input--error');
  profileDialogError.textContent = '';
  profileDialogReturnFocus?.focus();
  profileDialogReturnFocus = null;
  resolve(result);
}

function confirmProfileDialog() {
  if (!profileDialogHasInput) {
    closeProfileDialog({ confirmed: true });
    return;
  }

  const value = normalizeProfileName(profileDialogInput.value);
  if (!value) {
    profileDialogInput.classList.add('sp-input--error');
    profileDialogError.textContent = 'Enter a profile name.';
    profileDialogInput.focus();
    return;
  }
  closeProfileDialog({ confirmed: true, value });
}

function showProfileDialog(options: ProfileDialogOptions): Promise<ProfileDialogResult> {
  if (profileDialogResolve) {
    closeProfileDialog({ confirmed: false });
  }

  profileDialogTitle.textContent = options.title;
  profileDialogMessage.textContent = options.message;
  profileDialogCancel.textContent = options.cancelLabel ?? 'Cancel';
  profileDialogConfirm.textContent = options.confirmLabel;
  profileDialogConfirm.classList.toggle('danger', Boolean(options.destructive));
  profileDialogIcon.innerHTML = options.destructive
    ? PROFILE_DIALOG_DELETE_ICON
    : PROFILE_DIALOG_ADD_ICON;
  profileDialogHasInput = Boolean(options.input);
  profileDialogField.hidden = !options.input;
  profileDialogInput.classList.remove('sp-input--error');
  profileDialogError.textContent = '';

  if (options.input) {
    profileDialogInputLabel.textContent = options.input.label;
    profileDialogInput.placeholder = options.input.placeholder ?? '';
    profileDialogInput.value = options.input.value ?? '';
  }

  profileDialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : profileTrigger;
  profileDialogOverlay.classList.add('show');

  window.requestAnimationFrame(() => {
    if (options.input) {
      profileDialogInput.focus();
      profileDialogInput.select();
      return;
    }
    profileDialogConfirm.focus();
  });

  return new Promise((resolve) => {
    profileDialogResolve = resolve;
  });
}

function applyProfileSettingsToUi(settings: DeskoyProfileSettings) {
  coverDisplay = normalizeCoverDisplayValue(settings.coverDisplay);
  renderCoverDisplayPicker();
  coverUrl.value = settings.coverUrl ?? '';
  coverFilePath.value = settings.coverFilePath ?? '';
  useCustomCover = Boolean(settings.useCustomCover);
  setToggle(toggleUseCustom, useCustomCover);
  const builtIn = builtInCovers.includes(settings.coverMode as DeskoyBuiltInCover)
    ? (settings.coverMode as DeskoyBuiltInCover)
    : normalizeBuiltInCover(settings.cover);
  setCoverMode(builtIn);
  setCustomSourceMode(settings.coverMode === 'file' ? 'file' : 'url');
  muteAudioOn = Boolean(settings.audioMute);
  setToggle(toggleMuteAudio, muteAudioOn);
  whitelistApps = Array.isArray(settings.whitelist) ? [...settings.whitelist] : [];
  blockedAppRules = Array.isArray(settings.blockedApps) ? [...settings.blockedApps] : [];
  autoBlockedOn = Boolean(settings.autoCoverBlocked);
  setToggle(toggleAutoBlocked, autoBlockedOn);
  setBlockedPanelCollapsed(!autoBlockedOn);
  blockedWebsiteRules = Array.isArray(settings.blockedWebsites) ? [...settings.blockedWebsites] : [];
  blockedTitleKeywords = Array.isArray(settings.blockedTitleKeywords) ? [...settings.blockedTitleKeywords] : [];
  blockedWebsites.value = blockedWebsiteRules.join('\n');
  blockedKeywords.value = blockedTitleKeywords.join('\n');
  refreshGeneralPanel();
}

async function applyProfile(profileId: string) {
  const currentPreset = activeUserProfile() ?? findMatchingUserProfile(profileSettingsFromPatch(buildCoreSettingsPatch()));
  if (profileId === currentPreset?.id && !hasUnsavedChanges) return;
  if (hasUnsavedChanges) {
    const switchResult = await showProfileDialog({
      title: 'Switch profile?',
      message: 'Unsaved changes will be lost.',
      confirmLabel: 'Switch',
    });
    if (!switchResult.confirmed) return;
  }
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile || profile.id === defaultProfileId) return;
  const profilePatch: DeskoySaveSettingsPatch = { ...profile.settings };
  const patch: DeskoySaveSettingsPatch = {
    ...profilePatch,
    activeProfileId: profile.id,
    profiles: profilesWithDefaultSnapshot(profiles, profilePatch),
  };
  const result = await window.deskoy.saveSettings(patch);
  if (!result.ok) {
    setStatus(settingsStatus, 'Could not switch profile.', 'error');
    return;
  }
  if (Array.isArray(patch.profiles)) profiles = patch.profiles;
  activeProfileId = profile.id;
  applyProfileSettingsToUi(profile.settings);
  hasUnsavedChanges = false;
  savedSnapshot = JSON.stringify(buildSettingsPatch());
  renderProfileTrigger();
  renderProfileMenu();
  setStatus(settingsStatus, `${profile.name} profile applied`, 'ok');
}

async function saveCurrentAsProfile() {
  const hasProfiles = userProfiles().length > 0;
  if (hasProfiles && hasUnsavedChanges) {
    const createResult = await showProfileDialog({
      title: 'Create new profile?',
      message: 'Unsaved changes in the current profile will be lost.',
      confirmLabel: 'Continue',
    });
    if (!createResult.confirmed) return;
  }
  const nameResult = await showProfileDialog({
    title: hasProfiles ? 'Create new profile' : 'Create profile',
    message: 'Name this profile so you can switch back to it later.',
    confirmLabel: 'Create',
    input: {
      label: 'Profile name',
      placeholder: 'Work',
    },
  });
  const name = normalizeProfileName(nameResult.value ?? '');
  if (!nameResult.confirmed) return;
  if (!name) return;
  if (name.toLowerCase() === defaultProfileId) {
    setStatus(settingsStatus, 'Use a different profile name.', 'error');
    return;
  }
  const currentPatch = buildCoreSettingsPatch();
  const settings = hasProfiles ? freshProfileSettings() : profileSettingsFromPatch(currentPatch);
  const profilePatch = hasProfiles ? patchFromProfileSettings(settings) : currentPatch;
  const existing = userProfiles().find((profile) => profile.name.toLowerCase() === name.toLowerCase());
  let nextProfiles: DeskoyProfile[];
  let nextActiveProfileId: string;

  if (existing) {
    setStatus(settingsStatus, 'A profile with that name already exists.', 'error');
    return;
  } else {
    const profile = { id: makeProfileId(name), name, settings };
    nextActiveProfileId = profile.id;
    nextProfiles = [...profiles, profile];
  }

  const patch: DeskoySaveSettingsPatch = {
    ...profilePatch,
    activeProfileId: nextActiveProfileId,
    profiles: profilesWithDefaultSnapshot(nextProfiles, profilePatch),
  };
  const result = await window.deskoy.saveSettings(patch);
  if (!result.ok) {
    setStatus(settingsStatus, 'Profile could not be created.', 'error');
    return;
  }
  if (Array.isArray(patch.profiles)) profiles = patch.profiles;
  activeProfileId = nextActiveProfileId;
  if (hasProfiles) applyProfileSettingsToUi(settings);
  hasUnsavedChanges = false;
  savedSnapshot = JSON.stringify(buildSettingsPatch());
  renderProfileTrigger();
  renderProfileMenu();
  setStatus(settingsStatus, 'Profile created', 'ok');
}

async function deleteActiveProfile() {
  const profile = activeUserProfile() ?? findMatchingUserProfile(profileSettingsFromPatch(buildCoreSettingsPatch()));
  if (!profile) return;
  const deleteResult = await showProfileDialog({
    title: 'Delete profile?',
    message: `"${profile.name}" will be removed. Your current cover settings will stay the same.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!deleteResult.confirmed) return;
  const currentPatch = buildCoreSettingsPatch();
  const nextProfiles = profiles.filter((item) => item.id !== profile.id);
  const patch: DeskoySaveSettingsPatch = {
    ...currentPatch,
    activeProfileId: defaultProfileId,
    profiles: profilesWithDefaultSnapshot(nextProfiles, currentPatch),
  };
  const result = await window.deskoy.saveSettings(patch);
  if (!result.ok) {
    setStatus(settingsStatus, 'Profile could not be deleted.', 'error');
    return;
  }
  if (Array.isArray(patch.profiles)) profiles = patch.profiles;
  activeProfileId = defaultProfileId;
  hasUnsavedChanges = false;
  savedSnapshot = JSON.stringify(buildSettingsPatch());
  renderProfileTrigger();
  renderProfileMenu();
  setStatus(settingsStatus, 'Profile deleted', 'ok');
}

async function refresh() {
  const [state, settings, displayResult] = await Promise.all([
    window.deskoy.getState(),
    window.deskoy.getSettings(),
    window.deskoy.getDisplays().catch(() => ({ ok: false, displays: [] as DeskoyDisplay[] })),
  ]);

  setActiveState(state.active);
  setMaximizedUi();
  currentHotkey = typeof settings.hotkey === 'string' ? settings.hotkey : '';
  coverDisplay = normalizeCoverDisplayValue(settings.coverDisplay);
  availableDisplays = displayResult.ok && Array.isArray(displayResult.displays) ? displayResult.displays : [];
  renderCoverDisplayPicker();
  renderHotkeyBadges(currentHotkey);
  coverUrl.value = settings.coverUrl ?? '';
  coverFilePath.value = settings.coverFilePath ?? '';
  useCustomCover = Boolean(settings.useCustomCover);
  setToggle(toggleUseCustom, useCustomCover);
  const builtIn =
    builtInCovers.includes(settings.coverMode as (typeof builtInCovers)[number])
      ? settings.coverMode
      : (settings.cover ?? 'excel');
  setCoverMode(builtIn);
  whitelistApps = [...settings.whitelist];
  blockedAppRules = Array.isArray(settings.blockedApps) ? [...settings.blockedApps] : [];
  setCustomSourceMode(settings.coverMode === 'file' ? 'file' : 'url');
  muteAudioOn = Boolean(settings.audioMute);
  setToggle(toggleMuteAudio, muteAudioOn);
  autoBlockedOn = Boolean(settings.autoCoverBlocked);
  setToggle(toggleAutoBlocked, autoBlockedOn);
  setBlockedPanelCollapsed(!autoBlockedOn);
  blockedWebsiteRules = Array.isArray(settings.blockedWebsites)
    ? settings.blockedWebsites
    : [];
  blockedTitleKeywords = Array.isArray(settings.blockedTitleKeywords)
    ? settings.blockedTitleKeywords
    : [];
  blockedWebsites.value = blockedWebsiteRules.join('\n');
  blockedKeywords.value = blockedTitleKeywords.join('\n');
  applyTheme(settings.theme ?? 'dark');
  applyCompactMode(Boolean(settings.compactMode));
  applyFontSize(settings.fontSize);
  applyReduceMotion(Boolean(settings.reduceMotion));
  profiles = normalizeProfilesFromSettings(settings);
  activeProfileId = profiles.some((profile) => profile.id === settings.activeProfileId)
    ? settings.activeProfileId
    : defaultProfileId;
  refreshGeneralPanel();

  hasUnsavedChanges = false;
  savedSnapshot = JSON.stringify(buildSettingsPatch());
  renderProfileTrigger();
  renderProfileMenu();
}

async function refreshActiveState() {
  try {
    const state = await window.deskoy.getState();
    setActiveState(state.active);
  } catch {
    // Leave the last known state visible if the backend is unavailable.
  }
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
  if (!profileDropdown.contains(e.target as Node)) {
    setProfileMenuOpen(false);
  }
});

profileTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  if (userProfiles().length === 0) {
    void saveCurrentAsProfile();
    return;
  }
  renderProfileMenu();
  setProfileMenuOpen(!profileMenu.classList.contains('open'));
});

profileMenu.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || !profileMenu.contains(button)) return;
  const profileId = button.dataset.profileId;
  const action = button.dataset.profileAction;
  setProfileMenuOpen(false);
  if (profileId) {
    void applyProfile(profileId);
    return;
  }
  if (action === 'save') {
    void saveCurrentAsProfile();
    return;
  }
  if (action === 'delete') {
    void deleteActiveProfile();
  }
});

profileDialogCancel.addEventListener('click', () => closeProfileDialog({ confirmed: false }));
profileDialogConfirm.addEventListener('click', confirmProfileDialog);
profileDialogInput.addEventListener('input', () => {
  profileDialogInput.classList.remove('sp-input--error');
  profileDialogError.textContent = '';
});
profileDialogOverlay.addEventListener('click', (e) => {
  if (e.target === profileDialogOverlay) {
    closeProfileDialog({ confirmed: false });
  }
});

hotkeyRow.addEventListener('click', () => {
  if (!deskoyArmed) {
    setStatus(settingsStatus, 'Toggle Deskoy first', 'error');
    return;
  }
  beginHotkeyCapture();
});

document.addEventListener('keydown', (e) => {
  if (profileDialogOverlay.classList.contains('show')) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeProfileDialog({ confirmed: false });
      return;
    }
    if (e.key === 'Enter' && document.activeElement !== profileDialogCancel) {
      e.preventDefault();
      confirmProfileDialog();
      return;
    }
  }
  if (e.key === 'Escape' && profileMenu.classList.contains('open')) {
    setProfileMenuOpen(false);
    return;
  }
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
  setBlockedPanelCollapsed(!autoBlockedOn);
  refreshGeneralPanel();
  markUnsaved();
});

autoProtectCollapse.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!autoBlockedOn) return;
  setBlockedPanelCollapsed(!blockedPanelCollapsed);
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
    const patch = buildSettingsPatch();
    const res = await window.deskoy.saveSettings(patch);
    if (res.ok) {
      if (Array.isArray(patch.profiles)) profiles = patch.profiles;
      if (typeof patch.activeProfileId === 'string') activeProfileId = patch.activeProfileId;
      setStatus(settingsStatus, 'Saved', 'ok');
      hasUnsavedChanges = false;
      savedSnapshot = JSON.stringify(buildSettingsPatch());
      renderProfileTrigger();
      renderProfileMenu();
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

window.addEventListener('focus', () => {
  void refreshActiveState();
  void refreshUpdateNotice();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refreshActiveState();
    void refreshUpdateNotice();
  }
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
  void refreshUpdateNotice();
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

function openUpdateNoticePage() {
  if (upgradeRequiredActive) return;
  if (!isSettingsPanelOpen()) openSettingsPanel();
  setSettingsPage('updates');
}

updateNotice.addEventListener('click', openUpdateNoticePage);

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

function normalizeFontSize(value: string | undefined): DeskoyFontSize {
  return value === 'small' || value === 'large' ? value : 'default';
}

function applyCompactMode(on: boolean) {
  compactModeOn = on;
  document.documentElement.setAttribute('data-density', on ? 'compact' : 'default');
  setToggle(spToggleCompactMode, on);
}

function applyFontSize(value: string | undefined) {
  currentFontSize = normalizeFontSize(value);
  document.documentElement.setAttribute('data-font-size', currentFontSize);
  spFontSizeTrack.querySelectorAll<HTMLButtonElement>('.sp-seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.fontSize === currentFontSize);
  });
}

function applyReduceMotion(on: boolean) {
  reduceMotionOn = on;
  document.documentElement.setAttribute('data-motion', on ? 'reduced' : 'default');
  setToggle(spToggleReduceMotion, on);
}

async function saveAppearanceSetting(patch: DeskoySaveSettingsPatch) {
  try {
    const result = await window.deskoy.saveSettings(patch);
    if (!result.ok) setStatus(settingsStatus, 'Customization setting could not be saved.', 'error');
  } catch {
    setStatus(settingsStatus, 'Customization setting could not be saved.', 'error');
  }
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (currentTheme === 'system') applyTheme('system');
});

spThemeTrack.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sp-seg-btn');
  if (!btn || !btn.dataset.theme) return;
  const theme = btn.dataset.theme as 'dark' | 'light' | 'system';
  applyTheme(theme);
  void saveAppearanceSetting({ theme });
});

spFontSizeTrack.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sp-seg-btn');
  if (!btn || !btn.dataset.fontSize) return;
  const fontSize = normalizeFontSize(btn.dataset.fontSize);
  applyFontSize(fontSize);
  void saveAppearanceSetting({ fontSize });
});

spToggleCompactMode.addEventListener('click', () => {
  const compactMode = !compactModeOn;
  applyCompactMode(compactMode);
  void saveAppearanceSetting({ compactMode });
});

spToggleReduceMotion.addEventListener('click', () => {
  const reduceMotion = !reduceMotionOn;
  applyReduceMotion(reduceMotion);
  void saveAppearanceSetting({ reduceMotion });
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
    appearance: 'Customization',
    feedback: 'Feedback',
    bug: 'Bug Report',
    logs: 'Logs',
    updates: 'Updates',
    about: 'About',
  };
  spHeaderTitle.textContent = titleMap[page];

  if (page === 'general') {
    refreshGeneralPanel();
    void refreshCoverDisplayList();
  }
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
  spGeneralStatusVersion.textContent = appVersion.textContent || '—';
  const selectedCover = (coverMode.value as keyof typeof coverOptions) || 'excel';
  spGeneralStatusCover.textContent = coverOptions[selectedCover]?.label ?? 'Excel Spreadsheet';
  spGeneralStatusAutoProtect.textContent = autoBlockedOn ? 'On' : 'Off';
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
      spLogsList.innerHTML = '<p class="sp-logs-empty">No cover activity yet.</p>';
      return;
    }
    spLogsList.innerHTML = logs
      .map((log) => {
        const processName = escapeHtml(log.processName || 'Unknown process');
        const title = escapeHtml(log.title || 'Untitled window');
        const action = escapeHtml(log.action || 'Protected');
        const isCoverActivation = /cover activated/i.test(log.action || '');
        const kind = isCoverActivation ? 'cover' : 'protect';
        const label = isCoverActivation ? 'Cover' : 'Auto Protect';
        const iconPath = isCoverActivation
          ? 'M10.7429 5.09232C11.1494 5.03223 11.5686 5 12.0004 5C17.1054 5 20.4553 9.50484 21.5807 11.2868C21.7169 11.5025 21.785 11.6103 21.8231 11.7767C21.8518 11.9016 21.8517 12.0987 21.8231 12.2236C21.7849 12.3899 21.7164 12.4985 21.5792 12.7156C21.2793 13.1901 20.8222 13.8571 20.2165 14.5805M6.72432 6.71504C4.56225 8.1817 3.09445 10.2194 2.42111 11.2853C2.28428 11.5019 2.21587 11.6102 2.17774 11.7765C2.1491 11.9014 2.14909 12.0984 2.17771 12.2234C2.21583 12.3897 2.28393 12.4975 2.42013 12.7132C3.54554 14.4952 6.89541 19 12.0004 19C14.0588 19 15.8319 18.2676 17.2888 17.2766M3.00042 3L21.0004 21M9.8791 9.87868C9.3362 10.4216 9.00042 11.1716 9.00042 12C9.00042 13.6569 10.3436 15 12.0004 15C12.8288 15 13.5788 14.6642 14.1217 14.1213'
          : 'M13 7.5L10 10.5L14 12.5L11 15.5M20 12C20 16.9084 14.646 20.4784 12.698 21.6148C12.4766 21.744 12.3659 21.8086 12.2097 21.8421C12.0884 21.8681 11.9116 21.8681 11.7903 21.8421C11.6341 21.8086 11.5234 21.744 11.302 21.6148C9.35396 20.4784 4 16.9084 4 12V7.2176C4 6.41809 4 6.01833 4.13076 5.6747C4.24627 5.37114 4.43398 5.10028 4.67766 4.88553C4.9535 4.64244 5.3278 4.50208 6.0764 4.22135L11.4382 2.21067C11.6461 2.13271 11.75 2.09373 11.857 2.07828C11.9518 2.06457 12.0482 2.06457 12.143 2.07828C12.25 2.09373 12.3539 2.13271 12.5618 2.21067L17.9236 4.22135C18.6722 4.50208 19.0465 4.64244 19.3223 4.88553C19.566 5.10028 19.7537 5.37114 19.8692 5.6747C20 6.01833 20 6.41809 20 7.2176V12Z';
        return `<div class="sp-log-row ${kind}">
          <div class="sp-log-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="${iconPath}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="sp-log-body">
            <div class="sp-log-top">
              <span class="sp-log-process">${processName}</span>
              <span class="sp-log-kind">${label}</span>
              <span class="sp-log-time">${formatLogTime(log.timestamp)}</span>
            </div>
            <div class="sp-log-title">${title}</div>
            <div class="sp-log-action">${action}</div>
          </div>
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
