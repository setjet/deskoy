import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type Unlisten = () => void;

function onEvent<T>(event: string, cb: (payload: T) => void): Unlisten {
  let unlisten: Unlisten | undefined;
  void listen<T>(event, (evt) => cb(evt.payload)).then((fn) => {
    unlisten = fn;
  });
  return () => {
    if (unlisten) unlisten();
  };
}

window.deskoy = {
  openExternal: (url: string) => invoke('open_external', { url }),
  getAppVersion: () => invoke('get_app_version'),
  getUpdates: () => invoke('get_updates'),
  checkAppUpdate: () => invoke('check_app_update'),
  installAppUpdate: () => invoke('install_app_update'),
  getState: () => invoke('get_state'),
  toggle: () => invoke('toggle'),
  getSettings: () => invoke('get_settings'),
  getProtectionLogs: () => invoke('get_protection_logs'),
  clearProtectionLogs: () => invoke('clear_protection_logs'),
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
  onUpdateProgress: (cb) => onEvent('deskoy:updateProgress', cb),
  onCoverFallback: (cb) => onEvent('deskoy:coverFallback', cb),
  onUpgradeRequired: (cb) => onEvent('deskoy:upgradeRequired', cb),
};
