import brandLogoUrl from '../../assets/logo.png';
import proCardBackgroundUrl from '../../assets/cardbg.png';
import { mountUpdatesPanel, refreshUpdatesPanel } from '../components/settings/UpdatesPanel';
import { displayUpdateVersion, updateVersionIsNewer } from '../shared/version';
import { elementById as el, escapeHtml } from './dom';
import { bindProtectionLogs } from './protection-logs';
import { bindDefender } from './defender';
import type {
  DeskoyBuiltInCover,
  DeskoyCoverMode,
  DeskoyDisplay,
  DeskoyFontSize,
  DeskoyProfile,
  DeskoyProfileSettings,
  DeskoySaveSettingsPatch,
  DeskoySettings,
  DeskoyUpdatesPayload,
  NativeUpdatePayload,
  ProfileDialogOptions,
  ProfileDialogResult,
} from './types';

let deskoyUiAttached = false;

export function attachDeskoyUi(): void {
if (deskoyUiAttached) return;
deskoyUiAttached = true;

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

const brandLogoImg = el<HTMLImageElement>('brandLogoImg');
brandLogoImg.src = brandLogoUrl;
const titlebarProBadge = document.querySelector<HTMLElement>('.titlebar-brand .beta-badge');
if (titlebarProBadge) {
  titlebarProBadge.textContent = 'PRO';
  titlebarProBadge.setAttribute('aria-label', 'Deskoy Pro active');
}

const upgradeOverlay = el<HTMLElement>('upgradeOverlay');
const upgradeStatus = el<HTMLElement>('upgradeStatus');
const btnUpgrade = el<HTMLButtonElement>('btnUpgrade');
const upgradeModalSubtitle = el<HTMLElement>('upgradeModalSubtitle');

/** Opens in the default browser (see `deskoy:openExternal` in main). */
const HELP_URL = 'https://www.deskoy.com/docs/support';
const DOCS_URL = 'https://www.deskoy.com/docs';
const CHANGELOG_URL = 'https://www.deskoy.com/changelog';
/** Public uptime / incidents page for Deskoy online services. */
const STATUS_PAGE_URL = 'https://www.deskoy.com/status';
const TERMS_OF_SERVICE_URL = 'https://www.deskoy.com/terms';
const DESKOY_DOWNLOAD_URL = 'https://www.deskoy.com/download';
const DESKOY_PRO_URL = 'https://deskoy.com/pricing';

document.body.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a.lic-link');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  void window.deskoy.openExternal(href);
});

const spFeedbackTermsLink = el<HTMLAnchorElement>('spFeedbackTermsLink');
const spBugTermsLink = el<HTMLAnchorElement>('spBugTermsLink');
spFeedbackTermsLink.setAttribute('href', TERMS_OF_SERVICE_URL);
spBugTermsLink.setAttribute('href', TERMS_OF_SERVICE_URL);
spFeedbackTermsLink.closest('.sp-form-disclaimer')
  ?.replaceChildren('By submitting this feedback, you agree to our ', spFeedbackTermsLink, '.');
spBugTermsLink.closest('.sp-form-disclaimer')
  ?.replaceChildren('By submitting this feedback, you agree to our ', spBugTermsLink, '.');

const socialProfileLink = document.querySelector<HTMLAnchorElement>('.sp-footer-credit a[href="https://github.com/setjet"]');
if (socialProfileLink) {
  socialProfileLink.href = 'https://x.com/inthecayenne';
  socialProfileLink.classList.add('sp-social-profile');
  socialProfileLink.setAttribute('aria-label', 'Open @inthecayenne on X');
  socialProfileLink.innerHTML = `
    <span class="sp-social-avatar" aria-hidden="true">
      <img src="${brandLogoUrl}" alt="" width="22" height="22" decoding="async" />
    </span>
    <span>@inthecayenne</span>
  `;
}

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

function nativeUpdateIsAvailable(native: NativeUpdatePayload, installedVersion: string): boolean {
  if (!native.ok || !native.available) return false;
  if (!native.version || !installedVersion) return true;
  return updateVersionIsNewer(native.version, installedVersion);
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
const developerModeDisclaimerOverlay = document.createElement('div');
developerModeDisclaimerOverlay.className = 'modal-overlay developer-mode-disclaimer-overlay';
developerModeDisclaimerOverlay.innerHTML = `
  <div class="lic-modal profile-dialog developer-mode-disclaimer t-modal" role="dialog" aria-modal="true" aria-labelledby="developerModeDisclaimerTitle" aria-describedby="developerModeDisclaimerMessage">
    <div class="lic-modal__header profile-dialog-header">
      <div class="lic-modal__header-left">
        <span class="profile-dialog-icon developer-mode-disclaimer-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.9998 8.99999V13M11.9998 17H12.0098M10.6151 3.89171L2.39019 18.0983C1.93398 18.8863 1.70588 19.2803 1.73959 19.6037C1.769 19.8857 1.91677 20.142 2.14613 20.3088C2.40908 20.5 2.86435 20.5 3.77487 20.5H20.2246C21.1352 20.5 21.5904 20.5 21.8534 20.3088C22.0827 20.142 22.2305 19.8857 22.2599 19.6037C22.2936 19.2803 22.0655 18.8863 21.6093 18.0983L13.3844 3.89171C12.9299 3.10654 12.7026 2.71396 12.4061 2.58211C12.1474 2.4671 11.8521 2.4671 11.5935 2.58211C11.2969 2.71396 11.0696 3.10655 10.6151 3.89171Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <div>
          <h2 id="developerModeDisclaimerTitle" class="lic-modal__title">Enable Developer Mode?</h2>
          <p id="developerModeDisclaimerMessage" class="lic-modal__subtitle profile-dialog-message">Experimental features can be unstable and may change without notice.</p>
        </div>
      </div>
    </div>
    <div class="lic-modal__body profile-dialog-body">
      <label class="developer-mode-disclaimer-check" for="developerModeDisclaimerCheck">
        <input type="checkbox" id="developerModeDisclaimerCheck" />
        <span>I understand and want to continue.</span>
      </label>
      <div class="developer-mode-disclaimer-error" id="developerModeDisclaimerError" role="status" aria-live="polite"></div>
      <div class="lic-btns profile-dialog-actions">
        <button type="button" class="btn btn-ghost" id="developerModeDisclaimerCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="developerModeDisclaimerAccept" disabled>Enable</button>
      </div>
    </div>
  </div>
`;
document.body.appendChild(developerModeDisclaimerOverlay);
const developerModeDisclaimerDialog =
  developerModeDisclaimerOverlay.querySelector<HTMLElement>('.developer-mode-disclaimer')!;
const developerModeDisclaimerCheck =
  developerModeDisclaimerOverlay.querySelector<HTMLInputElement>('#developerModeDisclaimerCheck')!;
const developerModeDisclaimerError =
  developerModeDisclaimerOverlay.querySelector<HTMLElement>('#developerModeDisclaimerError')!;
const developerModeDisclaimerCancel =
  developerModeDisclaimerOverlay.querySelector<HTMLButtonElement>('#developerModeDisclaimerCancel')!;
const developerModeDisclaimerAccept =
  developerModeDisclaimerOverlay.querySelector<HTMLButtonElement>('#developerModeDisclaimerAccept')!;
const toggleMuteAudio = el<HTMLButtonElement>('toggleMuteAudio');
const toggleUseCustom = el<HTMLButtonElement>('toggleUseCustom');
const customCoverRow = toggleUseCustom.closest<HTMLElement>('.row')!;
const customCoverLabel = customCoverRow.querySelector<HTMLElement>('.row-label.with-icon')!;
customCoverLabel.childNodes.forEach((node) => {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Custom Cover Override')) {
    node.textContent = node.textContent.replace('Custom Cover Override', 'Custom Cover');
  }
});
customCoverLabel.insertAdjacentHTML(
  'beforeend',
  '<span class="sp-pro-badge" aria-label="Deskoy Pro feature">PRO</span>',
);
customCoverRow.querySelector<HTMLElement>('.row-sub')!.textContent =
  'Use your own URL or local file as the cover';
const toggleAutoBlocked = el<HTMLButtonElement>('toggleAutoBlocked');
const autoHideRow = toggleAutoBlocked.closest<HTMLElement>('.row')!;
const autoHideLabel = autoHideRow.querySelector<HTMLElement>('.row-label.with-icon')!;
autoHideLabel.childNodes.forEach((node) => {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Auto Protect')) {
    node.textContent = node.textContent.replace('Auto Protect', 'Auto Hide');
  }
});
autoHideRow.querySelector<HTMLElement>('.row-sub')!.textContent =
  'Attempts to hide blocked windows automatically';
autoHideLabel.insertAdjacentHTML(
  'beforeend',
  '<span class="sp-pro-badge" aria-label="Deskoy Pro feature">PRO</span>',
);
const blockedWebsites = el<HTMLTextAreaElement>('blockedWebsites');
const blockedKeywords = el<HTMLTextAreaElement>('blockedKeywords');
// Active window debug panel removed from UI.
const customSourcePanel = el<HTMLElement>('customSourcePanel');
const blockedPanel = el<HTMLElement>('blockedPanel');
const autoProtectCollapse = document.createElement('button');
autoProtectCollapse.type = 'button';
autoProtectCollapse.className = 'auto-protect-collapse-btn';
autoProtectCollapse.hidden = true;
autoProtectCollapse.setAttribute('aria-label', 'Collapse Auto Hide settings');
autoProtectCollapse.setAttribute('aria-expanded', 'true');
autoProtectCollapse.innerHTML = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
toggleAutoBlocked.parentElement?.insertBefore(autoProtectCollapse, toggleAutoBlocked);
const developerModeSection = document.createElement('div');
developerModeSection.id = 'developerModeSection';
developerModeSection.hidden = true;
toggleAutoBlocked.closest<HTMLElement>('.group')?.after(developerModeSection);
const developerModeSettingsSection = document.createElement('div');
developerModeSettingsSection.id = 'developerModeSettingsSection';
developerModeSettingsSection.hidden = true;
const appVersion = el<HTMLElement>('appVersion');
const btnHelp = el<HTMLButtonElement>('btnHelp');
const btnChangelog = el<HTMLButtonElement>('btnChangelog');

const btnGear = el<HTMLButtonElement>('btnGear');
const mainStatusbar = document.querySelector<HTMLElement>('.statusbar')!;
btnGear.title = 'Help';
btnGear.setAttribute('aria-label', 'Help');
btnGear.innerHTML = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
    <path d="M9.4 9a2.8 2.8 0 1 1 4.14 2.45C12.65 11.96 12 12.54 12 14M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
const statusSettingsButton = document.createElement('button');
statusSettingsButton.type = 'button';
statusSettingsButton.className = 'statusbar-settings';
statusSettingsButton.title = 'Settings';
statusSettingsButton.setAttribute('aria-label', 'Settings');
statusSettingsButton.innerHTML = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12.0005 15C13.6573 15 15.0005 13.6569 15.0005 12C15.0005 10.3431 13.6573 9 12.0005 9C10.3436 9 9.00049 10.3431 9.00049 12C9.00049 13.6569 10.3436 15 12.0005 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9.28957 19.3711L9.87402 20.6856C10.0478 21.0768 10.3313 21.4093 10.6902 21.6426C11.0492 21.8759 11.4681 22.0001 11.8962 22C12.3244 22.0001 12.7433 21.8759 13.1022 21.6426C13.4612 21.4093 13.7447 21.0768 13.9185 20.6856L14.5029 19.3711C14.711 18.9047 15.0609 18.5159 15.5029 18.26C15.9477 18.0034 16.4622 17.8941 16.9729 17.9478L18.4029 18.1C18.8286 18.145 19.2582 18.0656 19.6396 17.8713C20.021 17.6771 20.3379 17.3763 20.5518 17.0056C20.766 16.635 20.868 16.2103 20.8455 15.7829C20.823 15.3555 20.677 14.9438 20.4251 14.5978L19.5785 13.4344C19.277 13.0171 19.1159 12.5148 19.1185 12C19.1184 11.4866 19.281 10.9864 19.5829 10.5711L20.4296 9.40778C20.6814 9.06175 20.8275 8.65007 20.85 8.22267C20.8725 7.79528 20.7704 7.37054 20.5562 7C20.3423 6.62923 20.0255 6.32849 19.644 6.13423C19.2626 5.93997 18.833 5.86053 18.4074 5.90556L16.9774 6.05778C16.4667 6.11141 15.9521 6.00212 15.5074 5.74556C15.0645 5.48825 14.7144 5.09736 14.5074 4.62889L13.9185 3.31444C13.7447 2.92317 13.4612 2.59072 13.1022 2.3574C12.7433 2.12408 12.3244 1.99993 11.8962 2C11.4681 1.99993 11.0492 2.12408 10.6902 2.3574C10.3313 2.59072 10.0478 2.92317 9.87402 3.31444L9.28957 4.62889C9.0825 5.09736 8.73245 5.48825 8.28957 5.74556C7.84479 6.00212 7.33024 6.11141 6.81957 6.05778L5.38513 5.90556C4.95946 5.86053 4.52987 5.93997 4.14844 6.13423C3.76702 6.32849 3.45014 6.62923 3.23624 7C3.02206 7.37054 2.92002 7.79528 2.94251 8.22267C2.96499 8.65007 3.11103 9.06175 3.36291 9.40778L4.20957 10.5711C4.51151 10.9864 4.67411 11.4866 4.67402 12C4.67411 12.5134 4.51151 13.0137 4.20957 13.4289L3.36291 14.5922C3.11103 14.9382 2.96499 15.3499 2.94251 15.7773C2.92002 16.2047 3.02206 16.6295 3.23624 17C3.45036 17.3706 3.76727 17.6712 4.14864 17.8654C4.53001 18.0596 4.95949 18.1392 5.38513 18.0944L6.81513 17.9422C7.3258 17.8886 7.84034 17.9979 8.28513 18.2544C8.72966 18.511 9.08134 18.902 9.28957 19.3711Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
profileDropdown.before(statusSettingsButton);
const mainBodyScroll = document.querySelector<HTMLElement>('.body-scroll')!;
const spPanel = el<HTMLElement>('spPanel');
const spBackdrop = el<HTMLElement>('spBackdrop');
const spClose = el<HTMLButtonElement>('spClose');
const spHeaderTitle = el<HTMLElement>('spHeaderTitle');
el<HTMLButtonElement>('spNavGeneral').remove();
const spNavAppearance = el<HTMLButtonElement>('spNavAppearance');
const spNavFeedback = el<HTMLButtonElement>('spNavFeedback');
const spNavBug = el<HTMLButtonElement>('spNavBug');
const spNavLogs = el<HTMLButtonElement>('spNavLogs');
const spNavUpdates = el<HTMLButtonElement>('spNavUpdates');
const spNavAbout = el<HTMLButtonElement>('spNavAbout');
spNavLogs.querySelector<HTMLElement>('.sp-nav-icon')!.innerHTML = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14 11H8M10 15H8M16 7H8M20 10.5V6.8C20 5.11984 20 4.27976 19.673 3.63803C19.3854 3.07354 18.9265 2.6146 18.362 2.32698C17.7202 2 16.8802 2 15.2 2H8.8C7.11984 2 6.27976 2 5.63803 2.32698C5.07354 2.6146 4.6146 3.07354 4.32698 3.63803C4 4.27976 4 5.11984 4 6.8V17.2C4 18.8802 4 19.7202 4.32698 20.362C4.6146 20.9265 5.07354 21.3854 5.63803 21.673C6.27976 22 7.11984 22 8.8 22H11.5M22 22L20.5 20.5M21.5 18C21.5 19.933 19.933 21.5 18 21.5C16.067 21.5 14.5 19.933 14.5 18C14.5 16.067 16.067 14.5 18 14.5C19.933 14.5 21.5 16.067 21.5 18Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
const spInfoNavSection = spNavLogs.previousElementSibling;
if (spInfoNavSection?.classList.contains('sp-nav-section')) spInfoNavSection.remove();
const spNavLicence = document.createElement('button');
spNavLicence.type = 'button';
spNavLicence.className = 'sp-nav-btn';
spNavLicence.id = 'spNavLicence';
spNavLicence.dataset.page = 'licence';
spNavLicence.innerHTML = `
  <span class="sp-nav-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 6V22M12 6H8.46429C7.94332 6 7.4437 5.78929 7.07533 5.41421C6.70695 5.03914 6.5 4.53043 6.5 4C6.5 3.46957 6.70695 2.96086 7.07533 2.58579C7.4437 2.21071 7.94332 2 8.46429 2C11.2143 2 12 6 12 6ZM12 6H15.5357C16.0567 6 16.5563 5.78929 16.9247 5.41421C17.293 5.03914 17.5 4.53043 17.5 4C17.5 3.46957 17.293 2.96086 16.9247 2.58579C16.5563 2.21071 16.0567 2 15.5357 2C12.7857 2 12 6 12 6ZM20 11V18.8C20 19.9201 20 20.4802 19.782 20.908C19.5903 21.2843 19.2843 21.5903 18.908 21.782C18.4802 22 17.9201 22 16.8 22L7.2 22C6.07989 22 5.51984 22 5.09202 21.782C4.71569 21.5903 4.40973 21.2843 4.21799 20.908C4 20.4802 4 19.9201 4 18.8V11M2 7.6L2 9.4C2 9.96005 2 10.2401 2.10899 10.454C2.20487 10.6422 2.35785 10.7951 2.54601 10.891C2.75992 11 3.03995 11 3.6 11L20.4 11C20.9601 11 21.2401 11 21.454 10.891C21.6422 10.7951 21.7951 10.6422 21.891 10.454C22 10.2401 22 9.96005 22 9.4V7.6C22 7.03995 22 6.75992 21.891 6.54601C21.7951 6.35785 21.6422 6.20487 21.454 6.10899C21.2401 6 20.9601 6 20.4 6L3.6 6C3.03995 6 2.75992 6 2.54601 6.10899C2.35785 6.20487 2.20487 6.35785 2.10899 6.54601C2 6.75992 2 7.03995 2 7.6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>
  Licence
`;
spNavAppearance.after(spNavLicence);
spNavUpdates.after(spNavFeedback, spNavBug);

function syncMainScrollEffects() {
  mainStatusbar.classList.toggle('is-scrolled', mainBodyScroll.scrollTop > 3);
}
mainBodyScroll.addEventListener('scroll', syncMainScrollEffects, { passive: true });
syncMainScrollEffects();
el<HTMLElement>('spPageGeneral').remove();
const spPageAppearance = el<HTMLElement>('spPageAppearance');
const spPageDeveloperMode = document.createElement('div');
spPageDeveloperMode.className = 'sp-page sp-developer-page';
spPageDeveloperMode.id = 'spPageDeveloperMode';
spPageDeveloperMode.dataset.page = 'developer';
spPageDeveloperMode.innerHTML = `
  <div class="sp-page-title">Developer Mode</div>
  <p class="sp-page-sub">Adjust experimental tools and controls.</p>
`;
spPageDeveloperMode.append(developerModeSettingsSection);
spPageAppearance.after(spPageDeveloperMode);
const spPageFeedback = el<HTMLElement>('spPageFeedback');
const spPageBug = el<HTMLElement>('spPageBug');
const spPageLogs = el<HTMLElement>('spPageLogs');
const spLogsSubtitle = spPageLogs.querySelector<HTMLElement>('.sp-page-sub')!;
spPageFeedback.querySelector<HTMLElement>('.sp-page-sub')!.textContent =
  'Share feedback with us. We read every message (:';
spPageBug.querySelector<HTMLElement>('.sp-page-sub')!.textContent =
  'Tell us what went wrong, We will do our best to fix it!';
spLogsSubtitle.textContent = 'Browse recent Cover and Auto Hide activity.';
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

const spCoverDisplaySection = document.createElement('section');
spCoverDisplaySection.className = 'sp-customization-cover';
spCoverDisplaySection.setAttribute('aria-labelledby', 'spCoverDisplayHeading');
spCoverDisplaySection.innerHTML = `
  <div class="sp-customization-cover-head">
    <div>
      <h3 class="sp-row-title sp-pro-feature-title" id="spCoverDisplayHeading">Cover display <span class="sp-pro-badge" aria-label="Deskoy Pro feature">PRO</span></h3>
      <p class="sp-row-sub">Choose where Deskoy shows your cover.</p>
    </div>
    <span class="sp-cover-display-chip" id="spCoverDisplayChip">Checking</span>
  </div>
  <div class="sp-cover-display-body" id="spCoverDisplayBody"></div>
`;
spPageAppearance.append(spCoverDisplaySection);
const spCoverDisplayBody = spCoverDisplaySection.querySelector<HTMLElement>('#spCoverDisplayBody')!;
const spCoverDisplayChip = spCoverDisplaySection.querySelector<HTMLElement>('#spCoverDisplayChip')!;

const spFeedbackEmail = el<HTMLInputElement>('spFeedbackEmail');
const spFeedbackText = el<HTMLTextAreaElement>('spFeedbackText');
const spFeedbackSend = el<HTMLButtonElement>('spFeedbackSend');
const spFeedbackStatus = el<HTMLElement>('spFeedbackStatus');
const spBugEmail = el<HTMLInputElement>('spBugEmail');
document.getElementById('spBugSteps')?.closest('.sp-field')?.remove();
const spBugDiag = el<HTMLInputElement>('spBugDiag');
const spBugText = el<HTMLTextAreaElement>('spBugText');
const spBugSend = el<HTMLButtonElement>('spBugSend');
const spBugStatus = el<HTMLElement>('spBugStatus');
const spBugFileInput = el<HTMLInputElement>('spBugFileInput');
const spBugAttachPrompt = el<HTMLElement>('spBugAttachPrompt');
const spBugPreview = el<HTMLElement>('spBugPreview');
const spBugPreviewImg = el<HTMLImageElement>('spBugPreviewImg');
const spBugRemoveImg = el<HTMLButtonElement>('spBugRemoveImg');
spFeedbackText.placeholder = 'What should we improve?';
spFeedbackEmail.closest<HTMLElement>('.sp-field')?.querySelector<HTMLElement>('.sp-field-help')
  ?.replaceChildren('Only used if we decide to follow-up.');
spBugText.placeholder = 'What happened?';
spBugEmail.closest<HTMLElement>('.sp-field')?.querySelector<HTMLElement>('.sp-field-help')
  ?.replaceChildren('Only used if we decide to follow-up.');
const spChangelog = el<HTMLButtonElement>('spChangelog');
const spHelp = el<HTMLButtonElement>('spHelp');
const spAboutStatus = el<HTMLButtonElement>('spAboutStatus');
const spAppVersion = el<HTMLElement>('spAppVersion');
const spSidebar = spPanel.querySelector<HTMLElement>('.sp-sidebar')!;
appVersion.classList.add('sp-sidebar-version');
appVersion.setAttribute('aria-label', 'Deskoy version');
spSidebar.append(appVersion);
const spLogsList = el<HTMLElement>('spLogsList');
const spClearLogs = el<HTMLButtonElement>('spClearLogs');
const spLogsStatus = el<HTMLElement>('spLogsStatus');
const spDeveloperModeSection = document.createElement('section');
spDeveloperModeSection.className = 'sp-card sp-developer-mode-setting';
spDeveloperModeSection.innerHTML = `
  <div class="sp-list-row">
    <div class="sp-row-left">
      <div class="sp-row-title sp-pro-feature-title">Developer Mode <span class="sp-pro-badge" aria-label="Deskoy Pro feature">PRO</span></div>
      <div class="sp-row-sub">Unlock experimental unreleased features.</div>
    </div>
    <div class="sp-row-right">
      <button type="button" class="toggle" id="spToggleDeveloperMode" aria-label="Developer Mode" aria-pressed="false"></button>
    </div>
  </div>
`;
const spToggleDeveloperMode =
  spDeveloperModeSection.querySelector<HTMLButtonElement>('#spToggleDeveloperMode')!;
spPageAppearance.append(spDeveloperModeSection);

const spPageLicence = document.createElement('div');
spPageLicence.className = 'sp-page sp-licence-page';
spPageLicence.id = 'spPageLicence';
spPageLicence.dataset.page = 'licence';
spPageLicence.innerHTML = `
  <div class="sp-page-title">Licence</div>
  <p class="sp-page-sub">Activate and manage Deskoy Pro on this device.</p>

  <section class="sp-pro-card" aria-labelledby="spProCardTitle">
    <img class="sp-pro-card-background" src="${proCardBackgroundUrl}" alt="" aria-hidden="true" />
    <span class="sp-pro-card-fade sp-pro-card-fade-top" aria-hidden="true"></span>
    <span class="sp-pro-card-fade sp-pro-card-fade-bottom" aria-hidden="true"></span>
    <div class="sp-pro-card-top">
      <span class="sp-pro-card-logo" aria-hidden="true">
        <img src="${brandLogoUrl}" alt="" width="28" height="28" />
      </span>
      <span class="sp-pro-card-eyebrow">Deskoy Pro</span>
      <span class="sp-pro-card-plan">Lifetime</span>
    </div>
    <div class="sp-pro-card-content">
      <div class="sp-pro-card-copy">
        <h3 id="spProCardTitle">Unlock more from Deskoy</h3>
        <p>Access to more features, better support, more customization, get new features earlier than others, and more!</p>
      </div>
      <div class="sp-pro-card-offer">
        <div class="sp-pro-card-price"><strong>$9.99</strong><span>/ lifetime</span></div>
        <button type="button" class="sp-pro-card-button" id="spLicencePurchase">Purchase</button>
      </div>
    </div>
  </section>

  <div class="sp-licence-separator" role="separator" aria-hidden="true"></div>

  <section class="sp-licence-manager t-input-wrap" id="spLicenceManager" aria-labelledby="spLicenceTitle">
    <div class="sp-licence-heading">
      <div>
        <div class="sp-licence-title-line">
          <label id="spLicenceTitle" for="spLicenceKey">Have a license key?</label>
        </div>
        <p id="spLicenceMessage">Activate Deskoy Pro on this device.</p>
      </div>
    </div>

    <div class="sp-licence-entry" id="spLicenceActivationControls">
      <div class="sp-licence-input-row">
        <div class="sp-licence-input-shell">
          <input
            class="sp-input sp-licence-input t-input"
            id="spLicenceKey"
            type="password"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="DSKY-PRO-…"
          />
        </div>
        <button type="button" class="sp-action-btn sp-licence-activate" id="spLicenceActivate">
          <span class="sp-licence-spinner" id="spLicenceSpinner" aria-hidden="true" hidden></span>
          <span id="spLicenceActivateLabel">Activate</span>
        </button>
      </div>
      <div class="sp-licence-feedback t-error-msg" id="spLicenceFeedback" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>

    <div class="sp-licence-active-summary" id="spLicenceActiveSummary" hidden>
      <div class="sp-licence-key-row">
        <span class="sp-licence-key-label">License key:</span>
        <button type="button" class="sp-licence-key-reveal" id="spLicenceKeyReveal" data-available="false" aria-pressed="false" disabled>
          <span class="sp-licence-key-value" id="spLicenceKeyValue">Unavailable</span>
          <span class="sp-licence-key-hint">Click to view license key</span>
        </button>
      </div>
      <div class="sp-licence-details" id="spLicenceDetails" hidden>
        <div class="sp-licence-hover-card" id="spLicenceActivatedAtCard">
          <button type="button" class="sp-licence-time-trigger" id="spLicenceActivatedAt" aria-describedby="spLicenceActivatedAtDetails">
            Last activated <strong id="spLicenceActivatedAtValue"></strong>
          </button>
          <div class="sp-licence-time-card" id="spLicenceActivatedAtDetails" role="tooltip">
            <div class="sp-licence-time-title" id="spLicenceActivatedAtTitle"></div>
            <div class="sp-licence-time-line"><span>Local</span><time id="spLicenceActivatedAtLocal"></time></div>
            <div class="sp-licence-time-line"><span>UTC</span><time id="spLicenceActivatedAtUtc"></time></div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <div class="sp-licence-confetti" id="spLicenceConfetti" aria-hidden="true"></div>
`;
spPageDeveloperMode.before(spPageLicence);
const spLicenceManager = spPageLicence.querySelector<HTMLElement>('#spLicenceManager')!;
const spLicenceTitle = spPageLicence.querySelector<HTMLElement>('#spLicenceTitle')!;
const spLicenceMessage = spPageLicence.querySelector<HTMLElement>('#spLicenceMessage')!;
const spLicenceActivationControls = spPageLicence.querySelector<HTMLElement>('#spLicenceActivationControls')!;
const spLicenceKey = spPageLicence.querySelector<HTMLInputElement>('#spLicenceKey')!;
const spLicenceActivate = spPageLicence.querySelector<HTMLButtonElement>('#spLicenceActivate')!;
const spLicenceActivateLabel = spPageLicence.querySelector<HTMLElement>('#spLicenceActivateLabel')!;
const spLicenceSpinner = spPageLicence.querySelector<HTMLElement>('#spLicenceSpinner')!;
const spLicenceFeedback = spPageLicence.querySelector<HTMLElement>('#spLicenceFeedback')!;
const spLicencePurchase = spPageLicence.querySelector<HTMLButtonElement>('#spLicencePurchase')!;
const spLicenceActiveSummary = spPageLicence.querySelector<HTMLElement>('#spLicenceActiveSummary')!;
const spLicenceKeyReveal = spPageLicence.querySelector<HTMLButtonElement>('#spLicenceKeyReveal')!;
const spLicenceKeyValue = spPageLicence.querySelector<HTMLElement>('#spLicenceKeyValue')!;
const spLicenceDetails = spPageLicence.querySelector<HTMLElement>('#spLicenceDetails')!;
const spLicenceActivatedAt = spPageLicence.querySelector<HTMLButtonElement>('#spLicenceActivatedAt')!;
const spLicenceActivatedAtValue = spPageLicence.querySelector<HTMLElement>('#spLicenceActivatedAtValue')!;
const spLicenceActivatedAtTitle = spPageLicence.querySelector<HTMLElement>('#spLicenceActivatedAtTitle')!;
const spLicenceActivatedAtLocal = spPageLicence.querySelector<HTMLTimeElement>('#spLicenceActivatedAtLocal')!;
const spLicenceActivatedAtUtc = spPageLicence.querySelector<HTMLTimeElement>('#spLicenceActivatedAtUtc')!;
const spLicenceConfetti = spPageLicence.querySelector<HTMLElement>('#spLicenceConfetti')!;
let licenceErrorRevertTimer: number | null = null;
let licenceShakeTimer: number | null = null;
let licenceConfettiTimer: number | null = null;
let licenceKeyRequest = 0;
let licenceErrorVisibleUntil = 0;
const LICENCE_ERROR_HOLD_MS = 10_000;

function relativeActivationTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (elapsedSeconds < 60) return 'just now';
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function renderLastActivated(timestamp: number | null) {
  if (!timestamp) {
    spLicenceDetails.hidden = true;
    return;
  }

  spLicenceDetails.hidden = false;
  const activated = new Date(timestamp * 1000);
  const iso = activated.toISOString();
  spLicenceActivatedAtValue.textContent = relativeActivationTime(timestamp);
  spLicenceActivatedAtTitle.textContent = activated.toLocaleString();
  spLicenceActivatedAtLocal.textContent = activated.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  spLicenceActivatedAtLocal.dateTime = iso;
  spLicenceActivatedAtUtc.textContent = activated.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  spLicenceActivatedAtUtc.dateTime = iso;
  spLicenceActivatedAt.setAttribute('aria-label', `Last activated ${activated.toLocaleString()}`);
}

function concealLicenceKey() {
  spLicenceKeyReveal.classList.remove('is-revealed');
  spLicenceKeyReveal.setAttribute('aria-pressed', 'false');
}

async function renderStoredLicenceKey(active: boolean) {
  const request = ++licenceKeyRequest;
  concealLicenceKey();
  if (!active) {
    spLicenceKeyValue.textContent = 'Unavailable';
    spLicenceKeyReveal.dataset.available = 'false';
    spLicenceKeyReveal.disabled = true;
    return;
  }

  const licenceKey = await window.deskoy.getLicenceKey().catch(() => null);
  if (request !== licenceKeyRequest) return;
  const available = typeof licenceKey === 'string' && licenceKey.length > 0;
  spLicenceKeyValue.textContent = available ? licenceKey : 'Unavailable';
  spLicenceKeyReveal.dataset.available = String(available);
  spLicenceKeyReveal.disabled = !available;
}

function runLicenceConfetti() {
  if (
    reduceMotionOn
    || document.documentElement.getAttribute('data-motion') === 'reduced'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return;

  if (licenceConfettiTimer !== null) window.clearTimeout(licenceConfettiTimer);
  spLicenceConfetti.replaceChildren();
  const colors = ['#2f8ed8', '#69b7ff', '#b9dcff', '#ddecfa', '#ffffff'];
  for (let index = 0; index < 84; index += 1) {
    const piece = document.createElement('i');
    const drift = -240 + Math.random() * 480;
    const turn = (Math.random() > 0.5 ? 1 : -1) * (720 + Math.random() * 1080);
    piece.dataset.shape = index % 5 === 0 ? 'circle' : 'strip';
    piece.style.setProperty('--confetti-x', `${4 + Math.random() * 92}%`);
    piece.style.setProperty('--confetti-mid-drift', `${drift * 0.42}px`);
    piece.style.setProperty('--confetti-drift', `${drift}px`);
    piece.style.setProperty('--confetti-rise', `${-85 - Math.random() * 115}px`);
    piece.style.setProperty('--confetti-fall', `${430 + Math.random() * 170}px`);
    piece.style.setProperty('--confetti-mid-turn', `${turn * 0.38}deg`);
    piece.style.setProperty('--confetti-turn', `${turn}deg`);
    piece.style.setProperty('--confetti-delay', `${Math.random() * 400}ms`);
    piece.style.setProperty('--confetti-duration', `${2500 + Math.random() * 900}ms`);
    piece.style.setProperty('--confetti-width', `${6 + Math.random() * 5}px`);
    piece.style.setProperty('--confetti-height', `${11 + Math.random() * 7}px`);
    piece.style.setProperty('--confetti-color', colors[index % colors.length]);
    spLicenceConfetti.appendChild(piece);
  }
  spLicenceConfetti.classList.remove('is-bursting');
  void spLicenceConfetti.offsetWidth;
  spLicenceConfetti.classList.add('is-bursting');
  licenceConfettiTimer = window.setTimeout(() => {
    spLicenceConfetti.classList.remove('is-bursting');
    spLicenceConfetti.replaceChildren();
    licenceConfettiTimer = null;
  }, 4300);
}

function renderLicenceState(
  state: DeskoyLicenceState,
  { surfaceTransientFeedback = true }: { surfaceTransientFeedback?: boolean } = {},
) {
  const active = state.status === 'pro_active';
  const busy = state.status === 'activating';
  const showFeedback = surfaceTransientFeedback && state.status !== 'free' && !active && !busy;
  const preserveFeedback = !active
    && !busy
    && licenceErrorVisibleUntil > Date.now()
    && spLicenceFeedback.classList.contains('is-visible');
  spLicenceTitle.textContent = active ? 'You have activated Deskoy Pro!' : 'Have a license key?';
  spLicenceMessage.textContent = active
    ? 'Deskoy Pro is active on this device.'
    : 'Activate Deskoy Pro on this device.';
  if (showFeedback) {
    spLicenceFeedback.textContent = state.message;
    spLicenceFeedback.dataset.state = state.status;
  } else if (!preserveFeedback) {
    spLicenceFeedback.textContent = '';
    spLicenceFeedback.dataset.state = state.status;
  }
  spLicenceFeedback.classList.toggle('is-visible', Boolean(spLicenceFeedback.textContent));
  const incomingInvalid = surfaceTransientFeedback && state.status === 'invalid_or_revoked';
  const incomingImportantError = surfaceTransientFeedback && (
    state.status === 'connection_error' || state.status === 'already_activated_elsewhere'
  );
  const invalid = incomingInvalid || (
    preserveFeedback && spLicenceFeedback.dataset.state === 'invalid_or_revoked'
  );
  spLicenceManager.classList.toggle('is-error', invalid);
  spLicenceKey.classList.toggle('is-error', invalid);
  if (incomingInvalid || incomingImportantError) scheduleLicenceErrorReset();
  else if (!preserveFeedback) cancelLicenceErrorReset();
  spLicenceActivationControls.hidden = active;
  spLicenceActiveSummary.hidden = !active;
  spLicenceKey.disabled = busy;
  spLicenceActivate.disabled = busy;
  spLicenceActivate.setAttribute('aria-busy', String(busy));
  spLicenceSpinner.hidden = !busy;
  spLicenceActivateLabel.textContent = busy ? 'Activating…' : 'Activate';
  spLicencePurchase.textContent = active ? 'Activated' : 'Purchase';
  spLicencePurchase.disabled = active;
  renderLastActivated(state.activatedAt);
  void renderStoredLicenceKey(active);
  syncProFeatureAccess(active);
}

function showLicenceInputError(message?: string) {
  if (message) {
    spLicenceFeedback.textContent = message;
    spLicenceFeedback.dataset.state = 'invalid_or_revoked';
    spLicenceFeedback.classList.add('is-visible');
  }
  spLicenceManager.classList.add('is-error');
  spLicenceKey.classList.add('is-error');
  spLicenceKey.classList.remove('is-shaking');
  void spLicenceKey.offsetWidth;
  spLicenceKey.classList.add('is-shaking');

  const styles = getComputedStyle(spLicenceManager);
  const milliseconds = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const shakeDuration =
    milliseconds('--shake-dur-a', 80) * 2 + milliseconds('--shake-dur-b', 60) * 2;
  if (licenceShakeTimer !== null) window.clearTimeout(licenceShakeTimer);
  licenceShakeTimer = window.setTimeout(() => {
    licenceShakeTimer = null;
    spLicenceKey.classList.remove('is-shaking');
  }, shakeDuration + 20);
  scheduleLicenceErrorReset(shakeDuration);
}

function cancelLicenceErrorReset() {
  if (licenceErrorRevertTimer !== null) {
    window.clearTimeout(licenceErrorRevertTimer);
    licenceErrorRevertTimer = null;
  }
  licenceErrorVisibleUntil = 0;
}

function scheduleLicenceErrorReset(extraDelay = 0) {
  cancelLicenceErrorReset();
  const delay = extraDelay + LICENCE_ERROR_HOLD_MS;
  licenceErrorVisibleUntil = Date.now() + delay;
  licenceErrorRevertTimer = window.setTimeout(clearLicenceInputError, delay);
}

function clearLicenceInputError() {
  cancelLicenceErrorReset();
  if (licenceShakeTimer !== null) {
    window.clearTimeout(licenceShakeTimer);
    licenceShakeTimer = null;
  }
  spLicenceManager.classList.remove('is-error');
  spLicenceKey.classList.remove('is-error', 'is-shaking');
  if (
    spLicenceFeedback.dataset.state === 'invalid_or_revoked'
    || spLicenceFeedback.dataset.state === 'connection_error'
    || spLicenceFeedback.dataset.state === 'already_activated_elsewhere'
  ) {
    spLicenceFeedback.textContent = '';
    spLicenceFeedback.classList.remove('is-visible');
  }
}

async function refreshLicenceState() {
  try {
    renderLicenceState(await window.deskoy.getLicenceState(), { surfaceTransientFeedback: false });
  } catch {
    renderLicenceState({
      status: 'connection_error',
      message: 'Licence state is unavailable.',
      offlineDaysRemaining: null,
      lastCheckedAt: null,
      activatedAt: null,
      keyHint: null,
    }, { surfaceTransientFeedback: false });
  }
}

spLicenceActivate.addEventListener('click', async () => {
  const licenceKey = spLicenceKey.value.trim();
  if (!licenceKey) {
    showLicenceInputError('Enter your Deskoy Pro licence key.');
    spLicenceKey.focus();
    return;
  }
  renderLicenceState({
    status: 'activating',
    message: 'Activating licence…',
    offlineDaysRemaining: null,
    lastCheckedAt: null,
    activatedAt: null,
    keyHint: null,
  });
  try {
    const state = await window.deskoy.activateLicence(licenceKey);
    renderLicenceState(state);
    if (state.status === 'pro_active') {
      spLicenceKey.value = '';
      runLicenceConfetti();
    } else if (state.status === 'invalid_or_revoked') {
      showLicenceInputError();
    }
  } catch {
    await refreshLicenceState();
  }
});

spLicenceKey.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !spLicenceActivate.disabled) spLicenceActivate.click();
});
spLicenceKey.addEventListener('input', clearLicenceInputError);
spLicenceKey.addEventListener('animationend', () => spLicenceKey.classList.remove('is-shaking'));

spLicencePurchase.addEventListener('click', () => {
  if (!spLicencePurchase.disabled) void window.deskoy.openExternal(DESKOY_PRO_URL);
});

spLicenceKeyReveal.addEventListener('click', () => {
  if (spLicenceKeyReveal.disabled) return;
  spLicenceKeyReveal.classList.add('is-revealed');
  spLicenceKeyReveal.setAttribute('aria-pressed', 'true');
});
spLicenceKeyReveal.addEventListener('mouseleave', concealLicenceKey);
spLicenceKeyReveal.addEventListener('blur', concealLicenceKey);

const unlistenLicenceState = window.deskoy.onLicenceChanged(renderLicenceState);
window.addEventListener('pagehide', unlistenLicenceState, { once: true });

const statusTimers = new WeakMap<HTMLElement, number>();
let hasUnsavedChanges = false;
let savedSnapshot = '';
let currentTheme: 'dark' | 'light' | 'system' = 'dark';
let compactModeOn = false;
let currentFontSize: DeskoyFontSize = 'default';
let reduceMotionOn = false;
let developerModeOn = false;
let hasProEntitlement = false;
let developerModeDisclaimerAccepted = false;
let developerModeDisclaimerPending = false;
let developerModeDisclaimerCloseTimer: number | null = null;
let developerModeDisclaimerReturnFocus: HTMLElement | null = null;
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
/** When true, Deskoy Pro uses a custom URL/file instead of the Cover mode dropdown. */
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
  if (!availableDisplays.length) {
    spCoverDisplayChip.textContent = 'Unavailable';
    spCoverDisplayBody.innerHTML = '<p class="sp-cover-display-empty">Display selection is unavailable right now.</p>';
    return;
  }

  spCoverDisplayChip.textContent = `${availableDisplays.length} ${availableDisplays.length === 1 ? 'display' : 'displays'}`;
  const activeValue = activeCoverDisplayValue();
  const option = (value: string, title: string, summary: string, number: string, selected: boolean) => `
    <button type="button" class="sp-cover-display-option${selected ? ' is-selected' : ''}" data-cover-display="${value}" aria-pressed="${selected}" aria-disabled="${!hasProEntitlement}">
      <span class="sp-cover-display-screen" aria-hidden="true">${number}</span>
      <span class="sp-cover-display-copy">
        <span class="sp-cover-display-title">${escapeHtml(title)}</span>
        <span class="sp-cover-display-summary">${escapeHtml(summary)}</span>
      </span>
      <span class="sp-cover-display-check" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none"><path d="M4 8.25L6.75 11L12 5.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </button>`;
  const choices = availableDisplays.length > 1
    ? option('all', 'All displays', 'Cover every connected screen', 'All', coverDisplay === 'all')
    : '';
  const displays = availableDisplays.map((display, index) => {
    const value = availableDisplays.length === 1 ? 'all' : `monitor:${display.id}`;
    const selected = availableDisplays.length === 1 || (coverDisplay !== 'all' && activeValue === value);
    const title = availableDisplays.length === 1 ? 'Only display' : displayLabel(display, index);
    return option(value, title, displaySummary(display), String(index + 1), selected);
  }).join('');

  spCoverDisplayBody.innerHTML = `<div class="sp-cover-display-options" role="radiogroup" aria-label="Cover display">${choices}${displays}</div>`;
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
  if (!hasProEntitlement) {
    setSettingsPage('licence');
    return;
  }
  const next = normalizeCoverDisplayValue(button.dataset.coverDisplay);
  if (next === coverDisplay) return;
  coverDisplay = next;
  renderCoverDisplayPicker();
  markUnsaved();
});
const coverOptions: Record<
  string,
  {
    iconHtml: string;
    label: string;
    proOnly?: boolean;
    cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
  }
> = {
  excel: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M4.75 4A3.25 3.25 0 0 1 8 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 32 39.25H8A3.25 3.25 0 0 1 4.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M24 .5V8a4 4 0 0 0 4 4h7.5"/><path stroke="#079455" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.9 24.9h16.2m-16.2 0v-3.6a1.8 1.8 0 0 1 1.8-1.8h3.6m-5.4 5.4v3.6a1.8 1.8 0 0 0 1.8 1.8h3.6m10.8-5.4v3.6a1.8 1.8 0 0 1-1.8 1.8h-9m10.8-5.4v-3.6a1.8 1.8 0 0 0-1.8-1.8h-9m0 0v10.8"/></svg></span>`,
    label: 'Excel Spreadsheet',
    cover: 'excel',
  },
  vscode: {
    iconHtml: `<span class="cover-opt-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path stroke="#D5D7DA" stroke-width="1.5" d="M4.75 4A3.25 3.25 0 0 1 8 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 32 39.25H8A3.25 3.25 0 0 1 4.75 36z"/><path stroke="#D5D7DA" stroke-width="1.5" d="M24 .5V8a4 4 0 0 0 4 4h7.5"/><path stroke="#444CE7" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M23.75 27.75 27.5 24l-3.75-3.75m-7.5 0L12.5 24l3.75 3.75m5.25-10.5-3 13.5"/></svg></span>`,
    label: 'VS Code',
    proOnly: true,
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
    label: 'Blank Screen',
    proOnly: true,
    cover: 'black',
  },
};
const builtInCovers = ['excel', 'vscode', 'docs', 'jira', 'bi', 'black'] as const;
const proOnlyCoverModes = new Set<DeskoyBuiltInCover>(['vscode', 'black']);
const defaultProfileId = 'default';

function coverIsAvailable(mode: string): boolean {
  return hasProEntitlement || !proOnlyCoverModes.has(mode as DeskoyBuiltInCover);
}

function normalizeFreeBuiltInCover(mode: unknown): DeskoyBuiltInCover {
  const normalized = normalizeBuiltInCover(typeof mode === 'string' ? mode : 'excel');
  return proOnlyCoverModes.has(normalized) ? 'excel' : normalized;
}

function renderCoverMenu() {
  const selected = coverMode.value || 'excel';
  coverMenu.classList.add('cover-preset-menu', 't-dropdown');
  coverMenu.dataset.origin = 'top-right';
  coverMenu.innerHTML = `
    <div class="cover-menu-items" role="group" aria-label="Cover presets">
      ${Object.entries(coverOptions).map(([mode, option]) => {
        const locked = option.proOnly && !hasProEntitlement;
        return `<button type="button" class="dd-opt cover-menu-item${mode === selected ? ' sel' : ''}${locked ? ' is-pro-locked' : ''}" data-cover="${mode}" role="menuitemradio" aria-checked="${mode === selected}" aria-disabled="${locked}">
          <span class="opt-left">
            ${option.iconHtml}
            <span class="cover-menu-label">${escapeHtml(option.label)}</span>
          </span>
          <span class="cover-menu-end">
            ${locked ? '<span class="cover-menu-pro-badge">PRO</span>' : ''}
            <span class="dd-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="m3.5 8.1 2.7 2.7 6.3-6.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </span>
        </button>`;
      }).join('')}
    </div>`;
}

renderCoverMenu();

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
    collapsed ? 'Expand Auto Hide settings' : 'Collapse Auto Hide settings',
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
    const selected = o.dataset.cover === mode;
    o.classList.toggle('sel', selected);
    o.setAttribute('aria-checked', String(selected));
  });
}

let coverMenuCloseTimer: number | null = null;

function coverMenuCloseMs(): number {
  if (
    document.documentElement.getAttribute('data-motion') === 'reduced'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return 0;
  const value = getComputedStyle(coverMenu).getPropertyValue('--dropdown-close-dur');
  return Number.parseFloat(value) || 150;
}

function openCoverMenu() {
  if (coverMenuCloseTimer !== null) {
    window.clearTimeout(coverMenuCloseTimer);
    coverMenuCloseTimer = null;
  }
  renderCoverMenu();
  coverMenu.classList.remove('is-closing');
  coverMenu.classList.add('is-open');
  coverTrigger.classList.add('is-open');
  coverTrigger.setAttribute('aria-expanded', 'true');
}

function closeCoverMenu() {
  if (!coverMenu.classList.contains('is-open') || coverMenuCloseTimer !== null) return;
  coverMenu.classList.remove('is-open');
  coverMenu.classList.add('is-closing');
  coverTrigger.classList.remove('is-open');
  coverTrigger.setAttribute('aria-expanded', 'false');
  coverMenuCloseTimer = window.setTimeout(() => {
    coverMenuCloseTimer = null;
    coverMenu.classList.remove('is-closing');
  }, coverMenuCloseMs());
}

/** Built-in Cover mode is ignored whenever Custom Cover is on (URL/file may still be empty). */
function isCoverModeLocked(): boolean {
  return useCustomCover;
}

function refreshCoverModeUi() {
  const locked = isCoverModeLocked();
  coverDropdown.classList.toggle('panel-muted', locked);
  coverTrigger.disabled = locked;
  coverTrigger.setAttribute('aria-disabled', locked ? 'true' : 'false');
  coverTrigger.title = locked ? 'Turn off Custom Cover to change the built-in preset.' : '';
  coverLockChip.hidden = !locked;
  if (locked) closeCoverMenu();
}

function updateCustomSourceHintText() {
  if (!useCustomCover) {
    customSourceHint.textContent = 'Turn on Custom Cover above to edit.';
    return;
  }
  customSourceHint.textContent =
    'If empty, the built-in preset above is used. Turn off Custom Cover to change that preset.';
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

  // Mute audio is for built-in cover presets only. If Custom Cover is on, disable it.
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

function profileSettingsForEntitlement(settings: DeskoyProfileSettings): DeskoyProfileSettings {
  if (hasProEntitlement) return settings;
  const freeCover = normalizeFreeBuiltInCover(settings.cover);
  return {
    ...settings,
    coverMode: freeCover,
    cover: freeCover,
    coverDisplay: 'all',
    useCustomCover: false,
    autoCoverBlocked: false,
  };
}

function patchFromProfileSettings(settings: DeskoyProfileSettings): DeskoySaveSettingsPatch {
  const accessibleSettings = profileSettingsForEntitlement(settings);
  return {
    coverMode: accessibleSettings.coverMode,
    cover: accessibleSettings.cover,
    coverDisplay: accessibleSettings.coverDisplay,
    coverUrl: accessibleSettings.coverUrl,
    coverFilePath: accessibleSettings.coverFilePath,
    audioMute: accessibleSettings.audioMute,
    whitelist: [...accessibleSettings.whitelist],
    useCustomCover: accessibleSettings.useCustomCover,
    autoCoverBlocked: accessibleSettings.autoCoverBlocked,
    blockedApps: [...accessibleSettings.blockedApps],
    blockedWebsites: [...accessibleSettings.blockedWebsites],
    blockedTitleKeywords: [...accessibleSettings.blockedTitleKeywords],
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
  return profilesWithDefaultSnapshot(nextProfiles, patch).map((profile) => ({
    ...profile,
    settings: profileSettingsForEntitlement(profile.settings),
  }));
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
  coverDisplay = hasProEntitlement ? normalizeCoverDisplayValue(settings.coverDisplay) : 'all';
  renderCoverDisplayPicker();
  coverUrl.value = settings.coverUrl ?? '';
  coverFilePath.value = settings.coverFilePath ?? '';
  useCustomCover = hasProEntitlement && Boolean(settings.useCustomCover);
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
  autoBlockedOn = hasProEntitlement && Boolean(settings.autoCoverBlocked);
  setToggle(toggleAutoBlocked, autoBlockedOn);
  setBlockedPanelCollapsed(!autoBlockedOn);
  blockedWebsiteRules = Array.isArray(settings.blockedWebsites) ? [...settings.blockedWebsites] : [];
  blockedTitleKeywords = Array.isArray(settings.blockedTitleKeywords) ? [...settings.blockedTitleKeywords] : [];
  blockedWebsites.value = blockedWebsiteRules.join('\n');
  blockedKeywords.value = blockedTitleKeywords.join('\n');
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
  const [state, settings, displayResult, licenceState] = await Promise.all([
    window.deskoy.getState(),
    window.deskoy.getSettings(),
    window.deskoy.getDisplays().catch(() => ({ ok: false, displays: [] as DeskoyDisplay[] })),
    window.deskoy.getLicenceState().catch(() => ({
      status: 'connection_error' as const,
      message: 'Licence state is unavailable.',
      offlineDaysRemaining: null,
      lastCheckedAt: null,
      activatedAt: null,
      keyHint: null,
    })),
  ]);

  renderLicenceState(licenceState, { surfaceTransientFeedback: false });
  setActiveState(state.active);
  setMaximizedUi();
  currentHotkey = typeof settings.hotkey === 'string' ? settings.hotkey : '';
  coverDisplay = hasProEntitlement ? normalizeCoverDisplayValue(settings.coverDisplay) : 'all';
  availableDisplays = displayResult.ok && Array.isArray(displayResult.displays) ? displayResult.displays : [];
  renderCoverDisplayPicker();
  renderHotkeyBadges(currentHotkey);
  hotkeyHint.textContent = hotkeyHintIdleText();
  coverUrl.value = settings.coverUrl ?? '';
  coverFilePath.value = settings.coverFilePath ?? '';
  useCustomCover = hasProEntitlement && Boolean(settings.useCustomCover);
  setToggle(toggleUseCustom, useCustomCover);
  const builtIn =
    builtInCovers.includes(settings.coverMode as (typeof builtInCovers)[number])
      ? settings.coverMode
      : (settings.cover ?? 'excel');
  setCoverMode(hasProEntitlement ? builtIn : normalizeFreeBuiltInCover(builtIn));
  whitelistApps = [...settings.whitelist];
  blockedAppRules = Array.isArray(settings.blockedApps) ? [...settings.blockedApps] : [];
  setCustomSourceMode(settings.coverMode === 'file' ? 'file' : 'url');
  muteAudioOn = Boolean(settings.audioMute);
  setToggle(toggleMuteAudio, muteAudioOn);
  autoBlockedOn = hasProEntitlement && Boolean(settings.autoCoverBlocked);
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
  developerModeDisclaimerAccepted = Boolean(settings.developerModeDisclaimerAccepted);
  applyDeveloperMode(hasProEntitlement && Boolean(settings.developerMode));
  void defenderUi.refresh();
  profiles = normalizeProfilesFromSettings(settings);
  activeProfileId = profiles.some((profile) => profile.id === settings.activeProfileId)
    ? settings.activeProfileId
    : defaultProfileId;

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
    closeCoverMenu();
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
  if (developerModeDisclaimerOverlay.classList.contains('show')) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDeveloperModeDisclaimer();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = [developerModeDisclaimerCheck, developerModeDisclaimerCancel, developerModeDisclaimerAccept]
        .filter((element) => !element.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!developerModeDisclaimerDialog.contains(document.activeElement)) {
        e.preventDefault();
        first?.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
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
  if (e.key === 'Escape' && coverMenu.classList.contains('is-open')) {
    closeCoverMenu();
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
      setStatus(
        settingsStatus,
        'Arrow keys can’t be used as hotkeys. Try a letter/number key.',
        'error',
      );
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
  if (coverMenu.classList.contains('is-open')) closeCoverMenu();
  else openCoverMenu();
});

coverMenu.addEventListener('click', (ev) => {
  const opt = (ev.target as HTMLElement).closest<HTMLElement>('.dd-opt');
  if (!opt || !coverMenu.contains(opt)) return;
  ev.stopPropagation();
  const mode = opt.dataset.cover ?? 'excel';
  if (!coverIsAvailable(mode)) {
    closeCoverMenu();
    openSettingsPanel();
    setSettingsPage('licence');
    return;
  }
  setCoverMode(mode);
  refreshCustomCoverUi();
  closeCoverMenu();
  markUnsaved();
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
  } else if (!res.ok) {
    setStatus(settingsStatus, 'Cover file setting could not be saved.', 'error');
  }
});

toggleMuteAudio.addEventListener('click', async () => {
  if (toggleMuteAudio.disabled) return;
  muteAudioOn = !muteAudioOn;
  setToggle(toggleMuteAudio, muteAudioOn);
  markUnsaved();
});

toggleAutoBlocked.addEventListener('click', async () => {
  if (!hasProEntitlement) {
    openSettingsPanel();
    setSettingsPage('licence');
    return;
  }
  autoBlockedOn = !autoBlockedOn;
  setToggle(toggleAutoBlocked, autoBlockedOn);
  setBlockedPanelCollapsed(!autoBlockedOn);
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
  if (!hasProEntitlement) {
    openSettingsPanel();
    setSettingsPage('licence');
    return;
  }
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
  setSettingsPage('appearance');
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
  void window.deskoy.openExternal(DOCS_URL);
});
statusSettingsButton.addEventListener('click', () => {
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

function applyDeveloperMode(on: boolean) {
  const enabled = on && hasProEntitlement;
  developerModeOn = enabled;
  setToggle(spToggleDeveloperMode, enabled);
  developerModeSection.hidden = !enabled;
  developerModeSettingsSection.hidden = !enabled;
  if (!enabled && spPageDeveloperMode.classList.contains('active')) setSettingsPage('appearance');
}

function syncProFeatureAccess(active: boolean) {
  hasProEntitlement = active;
  titlebarProBadge?.classList.toggle('is-pro-active', active);
  document.querySelectorAll<HTMLElement>('.sp-pro-badge').forEach((badge) => {
    badge.hidden = active;
  });
  [toggleUseCustom, toggleAutoBlocked, spToggleDeveloperMode].forEach((control) => {
    control.classList.toggle('is-pro-locked', !active);
    control.setAttribute('aria-disabled', String(!active));
  });
  spCoverDisplaySection.classList.toggle('is-pro-locked', !active);
  spCoverDisplaySection.setAttribute('aria-disabled', String(!active));
  renderCoverMenu();
  if (!active) {
    if (!coverIsAvailable(coverMode.value)) setCoverMode('excel');
    coverDisplay = 'all';
    useCustomCover = false;
    setToggle(toggleUseCustom, false);
    refreshCustomCoverUi();
    autoBlockedOn = false;
    setToggle(toggleAutoBlocked, false);
    setBlockedPanelCollapsed(true);
    applyDeveloperMode(false);
  }
  renderCoverDisplayPicker();
}

function developerModeDisclaimerCloseMs() {
  if (
    document.documentElement.getAttribute('data-motion') === 'reduced'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur');
  return Number.parseFloat(value) || 150;
}

function openDeveloperModeDisclaimer() {
  if (developerModeDisclaimerCloseTimer !== null) {
    window.clearTimeout(developerModeDisclaimerCloseTimer);
    developerModeDisclaimerCloseTimer = null;
  }
  developerModeDisclaimerPending = false;
  developerModeDisclaimerCheck.checked = false;
  developerModeDisclaimerAccept.disabled = true;
  developerModeDisclaimerCancel.disabled = false;
  developerModeDisclaimerError.textContent = '';
  developerModeDisclaimerReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : spToggleDeveloperMode;
  developerModeDisclaimerDialog.classList.remove('is-open', 'is-closing');
  developerModeDisclaimerOverlay.classList.add('show');
  void developerModeDisclaimerDialog.offsetWidth;
  developerModeDisclaimerDialog.classList.add('is-open');
  window.requestAnimationFrame(() => developerModeDisclaimerCheck.focus());
}

function closeDeveloperModeDisclaimer() {
  if (
    developerModeDisclaimerPending
    || developerModeDisclaimerCloseTimer !== null
    || !developerModeDisclaimerOverlay.classList.contains('show')
  ) return;
  developerModeDisclaimerDialog.classList.remove('is-open');
  developerModeDisclaimerDialog.classList.add('is-closing');
  developerModeDisclaimerCloseTimer = window.setTimeout(() => {
    developerModeDisclaimerOverlay.classList.remove('show');
    developerModeDisclaimerDialog.classList.remove('is-closing');
    developerModeDisclaimerCloseTimer = null;
    developerModeDisclaimerReturnFocus?.focus();
    developerModeDisclaimerReturnFocus = null;
  }, developerModeDisclaimerCloseMs());
}

async function saveDeveloperModeSetting(next: boolean, previous: boolean, acknowledge = false): Promise<boolean> {
  spToggleDeveloperMode.disabled = true;
  try {
    const result = await window.deskoy.saveSettings({
      developerMode: next,
      ...(acknowledge ? { developerModeDisclaimerAccepted: true } : {}),
    });
    if (result.ok) {
      if (acknowledge) developerModeDisclaimerAccepted = true;
      await defenderUi.refresh();
      return true;
    }
    applyDeveloperMode(previous);
    setStatus(settingsStatus, 'Developer Mode setting could not be saved.', 'error');
  } catch {
    applyDeveloperMode(previous);
    setStatus(settingsStatus, 'Developer Mode setting could not be saved.', 'error');
  } finally {
    spToggleDeveloperMode.disabled = false;
  }
  return false;
}

async function acceptDeveloperModeDisclaimer() {
  if (!developerModeDisclaimerCheck.checked || developerModeDisclaimerPending) return;
  developerModeDisclaimerPending = true;
  developerModeDisclaimerAccept.disabled = true;
  developerModeDisclaimerCancel.disabled = true;
  developerModeDisclaimerError.textContent = '';
  const saved = await saveDeveloperModeSetting(true, false, true);
  developerModeDisclaimerPending = false;
  if (saved) {
    applyDeveloperMode(true);
    closeDeveloperModeDisclaimer();
    return;
  }
  developerModeDisclaimerError.textContent = 'Developer Mode could not be enabled. Try again.';
  developerModeDisclaimerCancel.disabled = false;
  developerModeDisclaimerAccept.disabled = !developerModeDisclaimerCheck.checked;
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

spToggleDeveloperMode.addEventListener('click', () => {
  if (spToggleDeveloperMode.disabled) return;
  if (!hasProEntitlement) {
    setSettingsPage('licence');
    return;
  }
  const previous = developerModeOn;
  const next = !previous;
  if (next && !developerModeDisclaimerAccepted) {
    openDeveloperModeDisclaimer();
    return;
  }
  applyDeveloperMode(next);
  void saveDeveloperModeSetting(next, previous);
});

developerModeDisclaimerCheck.addEventListener('change', () => {
  developerModeDisclaimerAccept.disabled = !developerModeDisclaimerCheck.checked || developerModeDisclaimerPending;
});
developerModeDisclaimerCancel.addEventListener('click', closeDeveloperModeDisclaimer);
developerModeDisclaimerAccept.addEventListener('click', () => void acceptDeveloperModeDisclaimer());
developerModeDisclaimerOverlay.addEventListener('click', (event) => {
  if (event.target === developerModeDisclaimerOverlay) closeDeveloperModeDisclaimer();
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
      setFormStatus(spFeedbackStatus, 'You have already sent your feedback, Please try again later.', 'error');
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
    const diagnostics = includeDiagnostics
      ? await collectDiagnostics()
      : undefined;
    const res = await window.deskoy.sendBugReport({
      message: text,
      email: email || undefined,
      screenshot: bugImageBase64 || undefined,
      diagnostics,
    });
    if (res.ok) {
      setFormStatus(spBugStatus, 'Report sent! Thank you.', 'ok');
      spBugText.value = '';
      spBugEmail.value = '';
      bugImageBase64 = null;
      spBugFileInput.value = '';
      spBugPreviewImg.src = '';
      spBugPreview.hidden = true;
      spBugAttachPrompt.style.display = '';
    } else if (res.error === 'rate_limited') {
      setFormStatus(spBugStatus, 'You have already sent your Bug Report, Please try again later.', 'error');
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

type SettingsPage = 'appearance' | 'licence' | 'developer' | 'feedback' | 'bug' | 'logs' | 'updates' | 'about';

function setSettingsPage(page: SettingsPage) {
  const nav: Array<[HTMLButtonElement, SettingsPage]> = [
    [spNavAppearance, 'appearance'],
    [spNavLicence, 'licence'],
    [spNavFeedback, 'feedback'],
    [spNavBug, 'bug'],
    [spNavLogs, 'logs'],
    [spNavUpdates, 'updates'],
    [spNavAbout, 'about'],
  ];
  nav.forEach(([btn, p]) => btn.classList.toggle('active', p === page));

  const pages: Array<[HTMLElement, SettingsPage]> = [
    [spPageAppearance, 'appearance'],
    [spPageLicence, 'licence'],
    [spPageDeveloperMode, 'developer'],
    [spPageFeedback, 'feedback'],
    [spPageBug, 'bug'],
    [spPageLogs, 'logs'],
    [spPageUpdates, 'updates'],
    [spPageAbout, 'about'],
  ];
  pages.forEach(([elm, p]) => elm.classList.toggle('active', p === page));

  spHeaderTitle.textContent = 'Settings';

  if (page === 'appearance') void refreshCoverDisplayList();
  if (page === 'licence') void refreshLicenceState();
  if (page === 'logs') {
    spLogsSubtitle.textContent = developerModeOn
      ? 'Browse recent Cover, Auto Hide and local Defender scan activity.'
      : 'Browse recent Cover and Auto Hide activity.';
    void refreshLogsPanel();
  }
  if (page === 'updates') void refreshUpdatesPanel();
}

function bindNav(btn: HTMLButtonElement, page: SettingsPage) {
  btn.addEventListener('click', () => setSettingsPage(page));
}
bindNav(spNavAppearance, 'appearance');
bindNav(spNavLicence, 'licence');
bindNav(spNavFeedback, 'feedback');
bindNav(spNavBug, 'bug');
bindNav(spNavLogs, 'logs');
bindNav(spNavUpdates, 'updates');
bindNav(spNavAbout, 'about');

const refreshLogsPanel = bindProtectionLogs(
  { list: spLogsList, clearButton: spClearLogs, status: spLogsStatus },
  setStatus,
  () => developerModeOn,
);
const defenderUi = bindDefender(
  developerModeSection,
  (message) => setStatus(settingsStatus, message, 'error', true),
  () => {
    openSettingsPanel();
    setSettingsPage('logs');
  },
  developerModeSettingsSection,
);
window.addEventListener('pagehide', () => defenderUi.dispose(), { once: true });

spHelp.addEventListener('click', () => {
  void window.deskoy.openExternal(HELP_URL);
});
}
