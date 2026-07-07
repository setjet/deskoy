export {};

declare global {
  interface Window {
    deskoy: {
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      getAppVersion: () => Promise<{ version: string; name: string }>;
      getDisplays: () => Promise<{
        ok: boolean;
        displays: Array<{
          id: number;
          name: string;
          width: number;
          height: number;
          x: number;
          y: number;
          scaleFactor: number;
          primary: boolean;
        }>;
      }>;
      getUpdates: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      checkAppUpdate: () => Promise<{
        ok: boolean;
        configured: boolean;
        available: boolean;
        version?: string;
        currentVersion?: string;
        notes?: string;
        url?: string;
        error?: string;
      }>;
      installAppUpdate: () => Promise<{ ok: boolean; error?: string }>;
      getState: () => Promise<{ active: boolean; maximized: boolean; paused?: boolean }>;
      toggle: () => Promise<{ active: boolean; ok: boolean; error?: string }>;
      getSettings: () => Promise<{
        hotkey: string;
        coverMode: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
        cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
        coverDisplay: string;
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
        compactMode: boolean;
        fontSize: 'small' | 'default' | 'large';
        reduceMotion: boolean;
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
          coverDisplay: string;
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
          compactMode: boolean;
          fontSize: 'small' | 'default' | 'large';
          reduceMotion: boolean;
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
      onUpdateProgress: (
        cb: (event: {
          event: 'started' | 'progress' | 'finished' | 'installed' | 'error';
          downloaded?: number;
          total?: number;
          error?: string;
        }) => void,
      ) => () => void;
      onCoverFallback: (cb: (info: { reason: string }) => void) => () => void;
      onUpgradeRequired: (cb: (payload: { message: string; downloadUrl: string; minimumVersion?: string }) => void) => () => void;
    };
  }
}

