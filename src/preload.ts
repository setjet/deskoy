import { contextBridge, ipcRenderer } from 'electron';

type CoverKind = 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
type CoverMode = CoverKind | 'url' | 'file';

type DeskoySettings = {
  hotkey: string;
  coverMode: CoverMode;
  cover: CoverKind;
  coverUrl: string;
  coverFilePath: string;
  whitelist: string[];
  audioMute: boolean;
  enabled: boolean;
  useCustomCover: boolean;
  autoCoverBlocked: boolean;
  blockedApps: string[];
  blockedTitleKeywords: string[];
  theme: 'dark' | 'light' | 'system';
};

type FeedbackPayload = {
  message: string;
  email?: string;
  diagnostics?: unknown;
};

type BugReportPayload = {
  message: string;
  email?: string;
  steps?: string;
  screenshot?: string; // data URL (base64)
  diagnostics?: unknown;
};

contextBridge.exposeInMainWorld('deskoy', {
  openExternal: (url: string) => ipcRenderer.invoke('deskoy:openExternal', url) as Promise<{ ok: boolean }>,
  getAppVersion: () =>
    ipcRenderer.invoke('deskoy:getAppVersion') as Promise<{ version: string; name: string }>,
  getUpdates: () =>
    ipcRenderer.invoke('deskoy:getUpdates') as Promise<{ ok: boolean; data?: unknown; error?: string }>,
  getState: () => ipcRenderer.invoke('deskoy:getState'),
  toggle: () => ipcRenderer.invoke('deskoy:toggle'),
  getSettings: () => ipcRenderer.invoke('deskoy:getSettings'),
  saveSettings: (settings: Partial<DeskoySettings>) =>
    ipcRenderer.invoke('deskoy:saveSettings', settings),
  pickCoverFile: () => ipcRenderer.invoke('deskoy:pickCoverFile'),
  sendFeedback: (payload: FeedbackPayload) => ipcRenderer.invoke('deskoy:sendFeedback', payload),
  sendBugReport: (payload: BugReportPayload) => ipcRenderer.invoke('deskoy:sendBugReport', payload),
  windowMinimize: () => ipcRenderer.invoke('deskoy:windowMinimize'),
  windowClose: () => ipcRenderer.invoke('deskoy:windowClose'),
  onStateChanged: (cb: (state: { active: boolean }) => void) => {
    const handler = (_: unknown, payload: { active: boolean }) => cb(payload);
    ipcRenderer.on('deskoy:stateChanged', handler);
    return () => ipcRenderer.removeListener('deskoy:stateChanged', handler);
  },
  onCoverFallback: (cb: (info: { reason: string }) => void) => {
    const handler = (_: unknown, payload: { reason: string }) => cb(payload);
    ipcRenderer.on('deskoy:coverFallback', handler);
    return () => ipcRenderer.removeListener('deskoy:coverFallback', handler);
  },
  onUpgradeRequired: (cb: (payload: { message: string; downloadUrl: string; minimumVersion?: string }) => void) => {
    const handler = (
      _: unknown,
      payload: { message: string; downloadUrl: string; minimumVersion?: string },
    ) => cb(payload);
    ipcRenderer.on('deskoy:upgradeRequired', handler);
    return () => ipcRenderer.removeListener('deskoy:upgradeRequired', handler);
  },
});

