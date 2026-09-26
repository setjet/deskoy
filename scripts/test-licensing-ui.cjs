const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const api = read('src/api/deskoy.ts');
const globalTypes = read('src/global.d.ts');
const ui = read('src/legacy-ui/index.ts');
const settingsCss = read('src/styles/settings-panel.css');
const mainWindowCss = read('src/styles/main-window.css');
const protectionLogs = read('src/legacy-ui/protection-logs.ts');
const mainRust = read('src-tauri/src/main.rs');
const defenderRust = read('src-tauri/src/defender.rs');
const rust = read('src-tauri/src/licensing.rs');

test('licensing commands are exposed only through the typed desktop bridge', () => {
  assert.match(api, /invoke\('licence_get_state'\)/);
  assert.match(api, /invoke\('licence_get_key'\)/);
  assert.match(api, /invoke\('licence_activate'/);
  assert.doesNotMatch(api, /invoke\('licence_deactivate'\)/);
  assert.doesNotMatch(mainRust, /licensing::licence_deactivate/);
  assert.match(globalTypes, /type DeskoyLicenceState/);
  assert.match(rust, /window\.label\(\) == "main"/);
  assert.match(rust, /licence_key: Option<String>/);
});

test('settings renders every requested licence state', () => {
  for (const state of [
    'free',
    'activating',
    'pro_active',
    'invalid_or_revoked',
    'already_activated_elsewhere',
    'connection_error',
  ]) {
    assert.ok(globalTypes.includes(state), `missing ${state} state`);
  }
  assert.match(ui, /spLicenceFeedback\.dataset\.state = state\.status/);
  assert.match(ui, /type="password"/);
  assert.match(ui, /dataset\.page = 'licence'/);
  assert.match(ui, /Have a license key/);
  assert.match(ui, /\$9\.99/);
  assert.match(ui, /Last activated/);
  assert.match(ui, /sp-licence-spinner/);
  assert.match(ui, /runLicenceConfetti/);
  assert.match(ui, /M12 6V22M12 6H8\.46429/);
  assert.match(ui, /M14 11H8M10 15H8M16 7H8/);
  assert.match(ui, /You have activated Deskoy Pro!/);
  assert.match(ui, /Click to view license key/);
  assert.match(ui, /spLicenceDetails" hidden/);
  assert.doesNotMatch(ui, /Deactivate this device/);
  assert.doesNotMatch(ui, /offline access remaining/);
  assert.doesNotMatch(ui, /Licence ending/);
  assert.match(ui, /for \(let index = 0; index < 84; index \+= 1\)/);
  assert.match(ui, /}, 4300\);/);
  assert.match(settingsCss, /@keyframes sp-licence-confetti-layer[\s\S]*100% \{ opacity: 0; \}/);
  assert.match(settingsCss, /mask-image: linear-gradient\(to bottom[\s\S]*transparent 100%\)/);
  assert.match(ui, /state\.status !== 'free' && !active && !busy/);
  assert.match(ui, /Access to more features, better support, more customization, get new features earlier than others, and more!/);
});

test('licence has its own settings page and feedback tools follow updates', () => {
  assert.match(ui, /spPageDeveloperMode\.before\(spPageLicence\)/);
  assert.match(ui, /spNavAppearance\.after\(spNavLicence\)/);
  assert.match(ui, /spNavUpdates\.after\(spNavFeedback, spNavBug\)/);
  assert.match(ui, /if \(page === 'licence'\) void refreshLicenceState\(\)/);
});

test('entitlement is not represented by an editable frontend isPro flag', () => {
  assert.doesNotMatch(`${api}\n${globalTypes}\n${ui}`, /\bisPro\b/);
  assert.match(rust, /fn has_pro_entitlement\(&self\) -> bool/);
});

test('licence errors, invalid-key motion and Pro feature labels use the focused UI', () => {
  assert.match(ui, /Have a license key\?/);
  assert.doesNotMatch(ui, /spLicenceBadge|sp-licence-badge/);
  assert.doesNotMatch(ui, /sp-licence-terms|By activating your license/);
  assert.match(ui, /showLicenceInputError/);
  assert.match(ui, /scheduleLicenceErrorReset/);
  assert.match(ui, /const LICENCE_ERROR_HOLD_MS = 10_000/);
  assert.match(ui, /licenceErrorVisibleUntil > Date\.now\(\)/);
  assert.match(ui, /else if \(!preserveFeedback\) cancelLicenceErrorReset\(\)/);
  assert.match(settingsCss, /@keyframes sp-licence-input-shake/);
  assert.match(settingsCss, /prefers-reduced-motion: reduce/);
  assert.match(settingsCss, /\.sp-licence-key-value[\s\S]*filter: blur\(5px\)/);
  assert.match(ui, /spLicenceKeyReveal\.addEventListener\('mouseleave', concealLicenceKey\)/);
  assert.equal((ui.match(/Deskoy Pro feature">PRO/g) ?? []).length, 4);
  assert.match(settingsCss, /\.sp-pro-badge[\s\S]*background: #2f8ed8;[\s\S]*color: #fff;/);
  assert.match(ui, /surfaceTransientFeedback: false/);
  assert.match(settingsCss, /\.sp-action-btn\.sp-licence-activate[\s\S]*height: 34px;[\s\S]*background: #fff;/);
  assert.match(ui, /titlebarProBadge\.textContent = 'PRO'/);
  assert.match(ui, /titlebarProBadge\?\.classList\.toggle\('is-pro-active', active\)/);
  assert.match(ui, /badge\.hidden = active/);
  assert.match(mainWindowCss, /\.beta-badge\.is-pro-active \{ display: inline-flex; \}/);
  assert.match(settingsCss, /\.sp-licence-title-line label[\s\S]*font-size: 15px;[\s\S]*font-weight: 750;/);
});

test('Custom Cover, Cover Display, Auto Hide and Developer Mode are enforced by the native entitlement', () => {
  assert.match(mainRust, /state::<licensing::LicenseManager>\(\)/);
  assert.match(mainRust, /"pro_required"/);
  assert.match(mainRust, /"coverDisplay"/);
  assert.match(mainRust, /"autoCoverBlocked" \| "developerMode" \| "useCustomCover"/);
  assert.match(mainRust, /matches!\(nested\.as_str\(\), Some\("url" \| "file"\)\)/);
  assert.match(ui, /replace\('Custom Cover Override', 'Custom Cover'\)/);
  assert.match(ui, /\[toggleUseCustom, toggleAutoBlocked, spToggleDeveloperMode\]/);
  assert.match(defenderRust, /Deskoy Pro is required to use Developer Mode tools/);
  assert.match(defenderRust, /state::<LicenseManager>\(\)\.has_pro_entitlement\(\)/);
  assert.match(ui, /M11\.9998 8\.99999V13M11\.9998 17H12\.0098/);
  assert.match(mainWindowCss, /\.developer-mode-disclaimer-icon[\s\S]*border: 0;[\s\S]*background: transparent/);
  assert.doesNotMatch(ui, /const spLogsFilter/);
  assert.match(ui, /\(\) => developerModeOn/);
  assert.match(protectionLogs, /isDeveloperModeEnabled\(\) \? window\.deskoy\.getDefenderLogs\(\) : Promise\.resolve\(\[\]\)/);
});

