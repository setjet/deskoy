export {};

declare global {
  interface Window {
    deskoy: {
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      getAppVersion: () => Promise<{ version: string; name: string }>;
      getUpdates: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      getState: () => Promise<{ active: boolean; maximized: boolean; paused?: boolean }>;
      toggle: () => Promise<{ active: boolean; ok: boolean; error?: string }>;
      getSettings: () => Promise<{
        hotkey: string;
        coverMode: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
        cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
        coverUrl: string;
        coverFilePath: string;
        whitelist: string[];
        audioMute: boolean;
        enabled: boolean;
        useCustomCover: boolean;
        autoCoverBlocked: boolean;
        blockedApps: string[];
        blockedWebsites: string[];
        blockedTitleKeywords: string[];
        theme: 'dark' | 'light' | 'system';
      }>;
      getProtectionLogs: () => Promise<
        Array<{
          timestamp: number;
          processName: string;
          title: string;
          action: string;
        }>
      >;
      clearProtectionLogs: () => Promise<{ ok: boolean; error?: string }>;
      getDiagnostics: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      pauseForMinutes: (minutes: number) => Promise<{ ok: boolean; error?: string }>;
      pauseUntilRestart: () => Promise<{ ok: boolean; error?: string }>;
      resumeDeskoy: () => Promise<{ ok: boolean; active?: boolean; error?: string }>;
      saveSettings: (
        settings: Partial<{
          hotkey: string;
          coverMode: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
          cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
          coverUrl: string;
          coverFilePath: string;
          whitelist: string[];
          audioMute: boolean;
          enabled: boolean;
          useCustomCover: boolean;
          autoCoverBlocked: boolean;
          blockedApps: string[];
          blockedWebsites: string[];
          blockedTitleKeywords: string[];
          theme: 'dark' | 'light' | 'system';
        }>,
      ) => Promise<{ ok: boolean; error?: string }>;
      pickCoverFile: () => Promise<{ ok: boolean; path: string }>;
      sendFeedback: (payload: {
        message: string;
        email?: string;
        diagnostics?: unknown;
      }) => Promise<{ ok: boolean; error?: string }>;
      sendBugReport: (payload: {
        message: string;
        email?: string;
        steps?: string;
        screenshot?: string;
        diagnostics?: unknown;
      }) => Promise<{ ok: boolean; error?: string }>;
      windowMinimize: () => Promise<{ ok: boolean }>;
      windowClose: () => Promise<{ ok: boolean }>;
      onStateChanged: (cb: (state: { active: boolean; paused?: boolean }) => void) => () => void;
      onCoverFallback: (cb: (info: { reason: string }) => void) => () => void;
      onUpgradeRequired: (cb: (payload: { message: string; downloadUrl: string; minimumVersion?: string }) => void) => () => void;
    };
  }
}

