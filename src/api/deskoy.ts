import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, type DragDropEvent } from '@tauri-apps/api/window';

type Unlisten = () => void;

function onEvent<T>(event: string, cb: (payload: T) => void): Unlisten {
  let unlisten: Unlisten | undefined;
  let disposed = false;
  void listen<T>(event, (evt) => cb(evt.payload)).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}

function onFileDrop(cb: (payload: DragDropEvent) => void): Unlisten {
  let unlisten: Unlisten | undefined;
  let disposed = false;
  let retryTimer: number | undefined;
  let attempts = 0;

  const subscribe = async () => {
    attempts += 1;
    try {
      const fn = await getCurrentWindow().onDragDropEvent((event) => cb(event.payload));
      if (disposed) fn();
      else unlisten = fn;
    } catch {
      if (!disposed && attempts < 3) {
        retryTimer = window.setTimeout((): void => {
          void subscribe();
        }, 250);
      }
    }
  };

  void subscribe();
  return () => {
    disposed = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    if (unlisten) unlisten();
  };
}

window.deskoy = {
  openExternal: (url: string) => invoke('open_external', { url }),
  getAppVersion: () => invoke('get_app_version'),
  getDisplays: () => invoke('get_displays'),
  getUpdates: () => invoke('get_updates'),
  checkAppUpdate: () => invoke('check_app_update'),
  installAppUpdate: () => invoke('install_app_update'),
  getState: () => invoke('get_state'),
  toggle: () => invoke('toggle'),
  getSettings: () => invoke('get_settings'),
  getProtectionLogs: () => invoke('get_protection_logs'),
  clearProtectionLogs: () => invoke('clear_protection_logs'),
  getLicenceState: () => invoke('licence_get_state'),
  getLicenceKey: () => invoke('licence_get_key'),
  activateLicence: (licenceKey) => invoke('licence_activate', { licenceKey }),
  getDefenderState: () => invoke('defender_get_state'),
  pickDefenderScan: () => invoke('defender_pick_scan'),
  scanDefenderPath: (path) => invoke('defender_scan_path', { path }),
  retryDefenderScan: (id) => invoke('defender_retry_scan', { id }),
  setDefenderEnabled: (enabled) => invoke('defender_set_enabled', { enabled }),
  setDefenderNotifications: (enabled) => invoke('defender_set_notifications', { enabled }),
  pickDefenderFolder: () => invoke('defender_pick_folder'),
  removeDefenderFolder: (id) => invoke('defender_remove_folder', { id }),
  getDefenderLogs: () => invoke('defender_get_logs'),
  clearDefenderLogs: () => invoke('defender_clear_logs'),
  openWindowsSecurity: () => invoke('defender_open_security'),
  saveSettings: (settings) => invoke('save_settings', { patch: settings }),
  pickCoverFile: () => invoke('pick_cover_file'),
  getDiagnostics: () => invoke('get_diagnostics'),
  pauseForMinutes: (minutes: number) => invoke('pause_for_minutes', { minutes }),
  pauseUntilRestart: () => invoke('pause_until_restart'),
  resumeDeskoy: () => invoke('resume_deskoy'),
  sendFeedback: (payload) => invoke('send_feedback', { payload }),
  sendBugReport: (payload) => invoke('send_bug_report', { payload }),
  windowMinimize: () => invoke('window_minimize'),
  windowClose: () => invoke('window_close'),
  onStateChanged: (cb) => onEvent('deskoy:stateChanged', cb),
  onDefenderChanged: (cb) => onEvent('deskoy:defenderChanged', cb),
  onDefenderScan: (cb) => onEvent('deskoy:defenderScan', cb),
  onLicenceChanged: (cb) => onEvent('licence-state-changed', cb),
  onFileDrop,
  onUpdateProgress: (cb) => onEvent('deskoy:updateProgress', cb),
  onCoverFallback: (cb) => onEvent('deskoy:coverFallback', cb),
  onUpgradeRequired: (cb) => onEvent('deskoy:upgradeRequired', cb),
};
