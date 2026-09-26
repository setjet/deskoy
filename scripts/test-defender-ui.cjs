const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Exercise the feature's bindings without a browser, native scanning, or extra dependencies.
class Element {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = true;
    this.dataset = {};
    this.attributes = {};
    this.handlers = new Map();
    this.children = new Map();
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : force;
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      },
      contains: (name) => this.classes.has(name),
    };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  querySelectorAll() { return []; }
  closest() { return this; }
  addEventListener(name, callback, options = {}) {
    const handlers = this.handlers.get(name) || [];
    handlers.push({ callback, signal: options.signal });
    this.handlers.set(name, handlers);
  }
  async fire(name, target = this) {
    if (this.disabled) return;
    for (const handler of this.handlers.get(name) || []) {
      if (!handler.signal?.aborted) await handler.callback({ target });
    }
    await new Promise(setImmediate);
  }
}

function setup() {
  const section = new Element();
  const window = new Element();
  const listeners = { changed: new Set(), scan: new Set(), drop: new Set() };
  const state = {
    enabled: false, notificationsEnabled: false, developerMode: true, folders: [],
    busy: false, queued: 0, progress: null, activeScan: null, queuedScans: [],
    lastCompleted: null, protection: null,
  };
  const calls = [];
  let scans = [];
  let protection = [];
  window.deskoy = {
    getDefenderState: async () => structuredClone(state),
    pickDefenderScan: async () => { calls.push('pick'); return { queued: true, scanId: 'scan-1', filename: 'example.txt' }; },
    scanDefenderPath: async (filePath) => { calls.push(['scan-path', filePath]); return { queued: true, scanId: 'scan-1', filename: 'dropped.txt' }; },
    setDefenderEnabled: async (enabled) => {
      calls.push(['enable', enabled]);
      state.enabled = enabled;
      state.protection = enabled ? {
        state: 'protected', runningMode: 'Normal', antivirusEnabled: true,
        realTimeEnabled: true, behaviorMonitorEnabled: true, onAccessEnabled: true,
        downloadScanningEnabled: true, checkedAt: Date.now(), detail: 'Defender protection is active.',
      } : null;
      return structuredClone(state);
    },
    setDefenderNotifications: async (enabled) => { calls.push(['notifications', enabled]); state.notificationsEnabled = enabled; return structuredClone(state); },
    pickDefenderFolder: async () => { state.folders.push({ id: 'folder', name: 'Downloads', path: 'C:\\Downloads' }); return structuredClone(state); },
    removeDefenderFolder: async (id) => { state.folders = state.folders.filter((folder) => folder.id !== id); return structuredClone(state); },
    openWindowsSecurity: async () => { calls.push('security'); return { ok: true }; },
    getProtectionLogs: async () => protection,
    getDefenderLogs: async () => scans,
    clearProtectionLogs: async () => { protection = []; calls.push('clear-protection'); return { ok: true }; },
    clearDefenderLogs: async () => { scans = []; calls.push('clear-scans'); return { ok: true }; },
    retryDefenderScan: async (id) => { calls.push(['retry', id]); return { queued: true, scanId: 'scan-retry', filename: 'example.txt' }; },
    onDefenderChanged: (callback) => { listeners.changed.add(callback); return () => listeners.changed.delete(callback); },
    onDefenderScan: (callback) => { listeners.scan.add(callback); return () => listeners.scan.delete(callback); },
    onFileDrop: (callback) => { listeners.drop.add(callback); return () => listeners.drop.delete(callback); },
  };
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    if (name === 'thinking-orb') {
      const exports = { mountThinkingOrb: () => ({ setActive: () => {}, dispose: () => {} }) };
      modules.set(name, exports);
      return exports;
    }
    const filename = path.join(__dirname, '..', 'src', 'legacy-ui', `${name}.ts`);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    modules.set(name, exports);
    vm.runInNewContext(source, { exports, require: (id) => load(id.replace('./', '')), window, AbortController }, { filename });
    return exports;
  }
  const alerts = [];
  const ui = load('defender').bindDefender(section, (message) => alerts.push(message), () => calls.push('logs'));
  return {
    section, window, state, calls, alerts, ui, listeners, load,
    node: (name) => section.querySelector(`[data-defender="${name}"]`),
    changed: () => listeners.changed.forEach((callback) => callback(structuredClone(state))),
    scan: (log, notify) => listeners.scan.forEach((callback) => callback({ log, notify })),
    drop: (event) => listeners.drop.forEach((callback) => callback(event)),
    logs: (nextScans, nextProtection = []) => { scans = nextScans; protection = nextProtection; },
  };
}

const scanLog = (result = 'clean') => ({
  id: 'scan-1', timestamp: 2000, filename: 'example.txt', source: 'manual', result,
  detail: 'Defender completed the scan.', action: null, retryAvailable: true,
});

test('Protection stays compact at idle and exposes folders, help, and one shared Activity action', async () => {
  const fixture = setup();
  await fixture.ui.refresh();
  assert.match(fixture.section.innerHTML, /<span>Protection<\/span>/);
  assert.equal((fixture.section.innerHTML.match(/defender-settings-card/g) || []).length, 4);
  assert.match(fixture.section.innerHTML, /<h2 id="defenderScanTitle"[^>]*>File Scan<\/h2>/);
  assert.match(fixture.section.innerHTML, /class="defender-scan-orb"/);
  assert.match(fixture.section.innerHTML, /Check a file for potential malware\/virus/);
  assert.match(fixture.section.innerHTML, /Deskoy will scan file using Microsoft Defender/);
  assert.equal(fixture.node('scan-status').hidden, true);
  assert.equal(fixture.node('toggle').attributes['aria-pressed'], 'false');
  assert.equal(fixture.node('toggle').disabled, false);
  assert.equal(fixture.node('scan').disabled, false);
  assert.equal(fixture.node('folder-count').textContent, '0 folders');
  assert.match(fixture.node('folders').innerHTML, /No folders yet/);
  assert.equal((fixture.section.innerHTML.match(/data-defender="logs"/g) || []).length, 1);
  assert.doesNotMatch(fixture.section.innerHTML, /View scan activity/);
  assert.match(fixture.section.innerHTML, /device-wide real-time, behavior, on-access and download protection/);
  assert.match(fixture.section.innerHTML, /recognized temporary-to-final downloads up to 512 MiB/);
  assert.match(fixture.section.innerHTML, /Microsoft Defender keeps control of quarantine and remediation/);
  assert.equal(fixture.node('folders-toggle').attributes['aria-expanded'], 'false');
  assert.equal(fixture.node('folders-disclosure').querySelector('.defender-collapse-panel').attributes['aria-hidden'], 'true');
  await fixture.node('folders-toggle').fire('click');
  assert.equal(fixture.node('folders-toggle').attributes['aria-expanded'], 'true');
  assert.equal(fixture.node('folders-disclosure').dataset.open, 'true');
  assert.equal(fixture.node('folders-disclosure').querySelector('.defender-collapse-panel').attributes['aria-hidden'], 'false');
  await fixture.node('how-toggle').fire('click');
  assert.equal(fixture.node('how-toggle').attributes['aria-expanded'], 'true');
  await fixture.node('scan').fire('click');
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.node('scan-overlay').classes.has('show'), true);
  assert.equal(fixture.node('scan-picker').hidden, false);
  await fixture.node('select-file').fire('click');
  assert.deepEqual(fixture.calls, ['pick']);
  await fixture.node('add').fire('click');
  assert.equal(fixture.node('folder-count').textContent, '1 folder');
  assert.match(fixture.node('folders').innerHTML, /<details class="defender-path-details">/);
  assert.match(fixture.node('folders').innerHTML, /C:\\Downloads/);
  assert.equal(fixture.node('toggle').disabled, false);
  assert.equal(fixture.node('toggle').attributes['aria-pressed'], 'false');
  await fixture.node('toggle').fire('click');
  assert.equal(fixture.node('toggle').attributes['aria-pressed'], 'true');
  assert.equal(fixture.node('auto-status').hidden, false);
  assert.match(fixture.node('auto-status').textContent, /Protected/);
  assert.equal(fixture.node('protection-state').textContent, 'Protected');
  await fixture.node('notifications').fire('click');
  assert.equal(fixture.node('notifications').attributes['aria-pressed'], 'true');
  fixture.state.progress = 'Automatic checks paused because Defender could not provide a conclusive system-level result.';
  fixture.changed();
  assert.equal(fixture.node('auto-status').dataset.state, 'paused');
  assert.match(fixture.node('auto-status').textContent, /paused/i);
  await fixture.node('logs').fire('click');
  assert.deepEqual(fixture.calls, ['pick', ['enable', true], ['notifications', true], 'logs']);
  fixture.state.developerMode = false;
  fixture.changed();
  assert.equal(fixture.node('scan').disabled, true);
  assert.equal(fixture.node('toggle').disabled, true);
  fixture.ui.dispose();
  assert.equal(fixture.listeners.changed.size, 0);
  assert.equal(fixture.listeners.scan.size, 0);
  assert.equal(fixture.listeners.drop.size, 0);
});

test('the scan chooser accepts one dropped file and keeps multi-file errors in the popup', async () => {
  const fixture = setup();
  await fixture.ui.refresh();
  await fixture.node('scan').fire('click');
  fixture.drop({ type: 'enter', paths: ['C:\\Downloads\\dropped.txt'], position: { x: 20, y: 20 } });
  assert.equal(fixture.node('drop-zone').dataset.active, 'true');
  fixture.drop({ type: 'drop', paths: ['C:\\Downloads\\dropped.txt'], position: { x: 20, y: 20 } });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.deepEqual(fixture.calls, [['scan-path', 'C:\\Downloads\\dropped.txt']]);
  assert.equal(fixture.node('scan-picker').hidden, true);

  await fixture.node('scan').fire('click');
  fixture.drop({ type: 'drop', paths: ['one.txt', 'two.txt'], position: { x: 20, y: 20 } });
  assert.equal(fixture.node('scan-error').hidden, false);
  assert.match(fixture.node('scan-error-message').textContent, /one file at a time/i);
  fixture.ui.dispose();
});

test('real backend states drive queued, scanning, result-checking, and bounded timeout UI', async () => {
  const fixture = setup();
  await fixture.ui.refresh();
  await fixture.node('scan').fire('click');
  assert.equal(fixture.node('popup-note').hidden, true);
  await fixture.node('select-file').fire('click');

  fixture.state.queued = 1;
  fixture.state.queuedScans = [{ id: 'scan-1', filename: 'example.txt', source: 'manual' }];
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'queued');
  assert.equal(fixture.node('phase').textContent, 'Queued');
  assert.equal(fixture.node('indicator').classes.has('is-active'), false);
  assert.equal(fixture.node('popup-prefix').textContent, 'Deskoy is preparing ');
  assert.equal(fixture.node('popup-note').hidden, false);

  fixture.state.busy = true;
  fixture.state.queued = 0;
  fixture.state.queuedScans = [];
  fixture.state.activeScan = { id: 'scan-1', filename: 'a-very-long-file-name-that-needs-to-truncate.zip', source: 'manual', phase: 'checking' };
  fixture.state.progress = 'Preparing Defender check: a-very-long-file-name-that-needs-to-truncate.zip';
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'checking');
  assert.equal(fixture.node('phase').textContent, '');
  assert.equal(fixture.node('phase').hidden, true);
  assert.equal(fixture.node('filename').textContent, 'a-very-long-file-name-that-needs-to-truncate.zip');
  assert.equal(fixture.node('indicator').classes.has('is-active'), true);
  assert.equal(fixture.node('popup-prefix').textContent, 'Deskoy is scanning ');
  assert.equal(fixture.node('popup-note').hidden, false);

  fixture.state.progress = 'Microsoft Defender is scanning the file…';
  fixture.state.activeScan.phase = 'scanning';
  fixture.state.queued = 2;
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'scanning');
  assert.equal(fixture.node('phase').textContent, '');
  assert.equal(fixture.node('phase').hidden, true);
  assert.equal(fixture.node('popup-note').hidden, false);

  fixture.state.progress = "Verifying Defender's detection and action records…";
  fixture.state.activeScan.phase = 'checking-result';
  fixture.state.queued = 0;
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'checking-result');
  assert.equal(fixture.node('phase').textContent, 'Checking result…');
  assert.equal(fixture.node('popup-note').hidden, false);

  fixture.state.progress = 'Defender is still running; the result is incomplete. Waiting for this scan to finish before starting another.';
  fixture.state.activeScan.phase = 'timeout';
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'timeout');
  assert.match(fixture.node('phase').textContent, /Scan timed out/);
  assert.equal(fixture.node('indicator').classes.has('is-active'), false);

  fixture.scan(scanLog('failed'), false);
  assert.equal(fixture.node('scan-status').dataset.state, 'failed');
  assert.equal(fixture.node('popup-title').textContent, 'File Scan');
  assert.equal(fixture.node('popup-note').hidden, true);
  assert.equal(fixture.node('indicator').classes.has('is-active'), false);
});

test('manual results survive unrelated automatic activity and recover from durable state or history', async () => {
  const fixture = setup();
  await fixture.ui.refresh();
  await fixture.node('scan').fire('click');
  await fixture.node('select-file').fire('click');

  fixture.state.lastCompleted = scanLog('clean');
  fixture.state.activeScan = null;
  fixture.state.queuedScans = [];
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'clean');

  fixture.state.activeScan = { id: 'auto-1', filename: 'download.tmp', source: 'automatic', phase: 'scanning' };
  fixture.state.busy = true;
  fixture.changed();
  assert.equal(fixture.node('scan-status').dataset.state, 'clean');
  assert.equal(fixture.node('filename').textContent, 'example.txt');

  const missed = setup();
  await missed.ui.refresh();
  await missed.node('scan').fire('click');
  await missed.node('select-file').fire('click');
  missed.logs([scanLog('failed')]);
  missed.state.queuedScans = [{ id: 'scan-1', filename: 'example.txt', source: 'manual' }];
  missed.changed();
  missed.state.activeScan = null;
  missed.state.queuedScans = [];
  missed.changed();
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(missed.node('scan-status').dataset.state, 'failed');
  fixture.ui.dispose();
  missed.ui.dispose();
});

test('General is removed and Developer Mode moves into Customization without a separate navigation entry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacy-ui', 'index.ts'), 'utf8');
  assert.match(source, /toggleAutoBlocked\.closest<HTMLElement>\('\.group'\)\?\.after\(developerModeSection\)/);
  assert.doesNotMatch(source, /spNavAppearance\.after\(spNavDeveloperMode\)/);
  assert.match(source, /spPageAppearance\.after\(spPageDeveloperMode\)/);
  assert.match(source, /spPageDeveloperMode\.append\(developerModeSettingsSection\)/);
  assert.doesNotMatch(source, /spNavDeveloperMode/);
  assert.match(source, /el<HTMLButtonElement>\('spNavGeneral'\)\.remove\(\)/);
  assert.match(source, /el<HTMLElement>\('spPageGeneral'\)\.remove\(\)/);
  assert.match(source, /spPageAppearance\.append\(spDeveloperModeSection\)/);
});

test('completed scans use compact labelled results with expandable findings and contextual actions', async () => {
  const fixture = setup();
  await fixture.ui.refresh();
  for (const result of ['clean', 'threat', 'remediated', 'failed', 'incomplete']) {
    fixture.scan(scanLog(result), false);
    assert.equal(fixture.node('scan-status').dataset.state, result);
    assert.equal(fixture.node('filename').textContent, 'example.txt');
    assert.equal(fixture.node('phase').textContent, fixture.load('defender').defenderResultLabels[result]);
    assert.equal(fixture.node('indicator').classes.has('is-active'), false);
    assert.equal(fixture.node('result-toggle').hidden, false);
    assert.equal(fixture.node('result-details').dataset.open, 'false');
  }
  await fixture.node('result-toggle').fire('click');
  assert.equal(fixture.node('result-details').dataset.open, 'true');
  assert.match(fixture.node('result-detail').textContent, /completed the scan/);
  assert.equal(fixture.node('security').hidden, false);
  assert.equal(fixture.node('retry').hidden, false);

  fixture.scan(scanLog('clean'), false);
  assert.equal(fixture.node('security').hidden, true);
  assert.equal(fixture.node('retry').hidden, true);
  fixture.scan({ ...scanLog(), source: 'automatic' }, false);
  assert.equal(fixture.alerts.length, 0);
  fixture.scan(scanLog('threat'), true);
  assert.equal(fixture.alerts.length, 1);
  assert.match(fixture.alerts[0], /Threat detected/);
});

test('unavailable Defender and control failures stay beside the affected action', async () => {
  const scanFixture = setup();
  scanFixture.window.deskoy.pickDefenderScan = async () => { throw 'Microsoft Defender is unavailable. Open Windows Security.'; };
  await scanFixture.ui.refresh();
  await scanFixture.node('scan').fire('click');
  await scanFixture.node('select-file').fire('click');
  assert.equal(scanFixture.node('scan-error').hidden, false);
  assert.match(scanFixture.node('scan-error-message').textContent, /Defender is unavailable/);
  assert.equal(scanFixture.node('scan-security').hidden, false);
  assert.equal(scanFixture.node('indicator').classes.has('is-active'), false);

  const fixture = setup();
  fixture.state.folders = [{ id: 'folder', name: 'Downloads', path: 'C:\\Downloads' }];
  fixture.window.deskoy.setDefenderEnabled = async () => { throw 'Microsoft Defender is unavailable. Open Windows Security.'; };
  await fixture.ui.refresh();
  await fixture.node('toggle').fire('click');
  assert.equal(fixture.node('toggle').attributes['aria-pressed'], 'false');
  assert.equal(fixture.node('toggle').disabled, false);
  assert.equal(fixture.node('auto-error').hidden, false);
  assert.match(fixture.node('auto-error-message').textContent, /Defender is unavailable/);
});

test('Logs merge by time, escape filenames and details, offer actions, and clear both histories', async () => {
  const fixture = setup();
  fixture.logs([{ ...scanLog('remediated'), filename: '<img onerror="bad">', detail: '<script>bad</script>', action: 'Quarantined' }], [
    { timestamp: 1000, processName: 'Older cover', title: 'Cover activated', action: 'Cover activated' },
  ]);
  const list = new Element();
  const clearButton = new Element();
  const status = new Element();
  const refresh = fixture.load('protection-logs').bindProtectionLogs({ list, clearButton, status }, (target, message) => { target.textContent = message; });
  await refresh();
  assert.ok(list.innerHTML.indexOf('Remediation confirmed') < list.innerHTML.indexOf('Older cover'));
  assert.match(list.innerHTML, /&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.match(list.innerHTML, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(list.innerHTML, /Defender action: Quarantined/);
  assert.match(list.innerHTML, /data-retry-scan="scan-1"/);
  const retry = new Element();
  retry.dataset.retryScan = 'scan-1';
  await list.fire('click', retry);
  assert.deepEqual(fixture.calls[0], ['retry', 'scan-1']);
  await clearButton.fire('click');
  assert.ok(fixture.calls.includes('clear-protection'));
  assert.ok(fixture.calls.includes('clear-scans'));
  assert.equal(clearButton.disabled, true);
  assert.match(list.innerHTML, /No activity yet/);
  await fixture.window.fire('pagehide');
  assert.equal(fixture.listeners.scan.size, 1); // The separate Dev Mode binding remains until its own dispose.
  fixture.ui.dispose();
  assert.equal(fixture.listeners.scan.size, 0);
  assert.equal(fixture.listeners.drop.size, 0);
});

test('Logs keep Defender scan activity hidden while Developer Mode is off', async () => {
  const fixture = setup();
  fixture.logs([{ ...scanLog('threat'), detail: 'Defender found a threat.' }], [
    { timestamp: 1000, processName: 'Deskoy', title: 'Cover activated', action: 'Cover activated' },
  ]);
  let defenderReads = 0;
  fixture.window.deskoy.getDefenderLogs = async () => {
    defenderReads += 1;
    return [scanLog('threat')];
  };
  const list = new Element();
  const clearButton = new Element();
  const status = new Element();
  const refresh = fixture.load('protection-logs').bindProtectionLogs(
    { list, clearButton, status },
    (target, message) => { target.textContent = message; },
    () => false,
  );
  await refresh();
  assert.equal(defenderReads, 0);
  assert.match(list.innerHTML, /Cover activated/);
  assert.doesNotMatch(list.innerHTML, /File scan|Defender|data-scan-details/);
  await fixture.window.fire('pagehide');
  fixture.ui.dispose();
});
