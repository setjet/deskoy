export {};

declare global {
  type DefenderState = {
    enabled: boolean;
    notificationsEnabled: boolean;
    developerMode: boolean;
    folders: Array<{ id: string; path: string; name: string }>;
    busy: boolean;
    queued: number;
    progress: string | null;
    activeScan: {
      id: string;
      filename: string;
      source: 'manual' | 'automatic';
      phase: string;
    } | null;
    queuedScans: Array<{
      id: string;
      filename: string;
      source: 'manual' | 'automatic';
    }>;
    lastCompleted: DefenderScanLog | null;
    protection: {
      state: 'checking' | 'protected' | 'attention' | 'unavailable';
      runningMode: string;
      antivirusEnabled: boolean;
      realTimeEnabled: boolean;
      behaviorMonitorEnabled: boolean;
      onAccessEnabled: boolean;
      downloadScanningEnabled: boolean;
      checkedAt: number;
      detail: string;
    } | null;
  };

  type DefenderScanLog = {
    id: string;
    timestamp: number;
    filename: string;
    source: 'manual' | 'automatic';
    result: 'clean' | 'threat' | 'remediated' | 'failed' | 'incomplete';
    detail: string;
    action: string | null;
    retryAvailable: boolean;
  };

  type DeskoyLicenceState = {
    status:
      | 'free'
      | 'activating'
      | 'pro_active'
      | 'invalid_or_revoked'
      | 'already_activated_elsewhere'
      | 'connection_error';
    message: string;
    offlineDaysRemaining: number | null;
    lastCheckedAt: number | null;
    activatedAt: number | null;
    keyHint: string | null;
  };

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
        releaseDate?: number;
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
        developerMode: boolean;
        developerModeDisclaimerAccepted: boolean;
        activeProfileId: string;
        profiles: Array<{
          id: string;
          name: string;
          settings: {
            coverMode: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
            cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
            coverDisplay: string;
            coverUrl: string;
            coverFilePath: string;
            audioMute: boolean;
            whitelist: string[];
            useCustomCover: boolean;
            autoCoverBlocked: boolean;
            blockedApps: string[];
            blockedWebsites: string[];
            blockedTitleKeywords: string[];
          };
        }>;
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
      getLicenceState: () => Promise<DeskoyLicenceState>;
      getLicenceKey: () => Promise<string | null>;
      activateLicence: (licenceKey: string) => Promise<DeskoyLicenceState>;
      getDefenderState: () => Promise<DefenderState>;
      pickDefenderScan: () => Promise<{ queued: boolean; scanId?: string; filename?: string }>;
      scanDefenderPath: (path: string) => Promise<{ queued: boolean; scanId?: string; filename?: string }>;
      retryDefenderScan: (id: string) => Promise<{ queued: boolean; scanId?: string; filename?: string }>;
      setDefenderEnabled: (enabled: boolean) => Promise<DefenderState>;
      setDefenderNotifications: (enabled: boolean) => Promise<DefenderState>;
      pickDefenderFolder: () => Promise<DefenderState>;
      removeDefenderFolder: (id: string) => Promise<DefenderState>;
      getDefenderLogs: () => Promise<DefenderScanLog[]>;
      clearDefenderLogs: () => Promise<{ ok: boolean }>;
      openWindowsSecurity: () => Promise<{ ok: boolean }>;
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
          developerMode: boolean;
          developerModeDisclaimerAccepted: boolean;
          activeProfileId: string;
          profiles: Array<{
            id: string;
            name: string;
            settings: {
              coverMode: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black' | 'url' | 'file';
              cover: 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
              coverDisplay: string;
              coverUrl: string;
              coverFilePath: string;
              audioMute: boolean;
              whitelist: string[];
              useCustomCover: boolean;
              autoCoverBlocked: boolean;
              blockedApps: string[];
              blockedWebsites: string[];
              blockedTitleKeywords: string[];
            };
          }>;
        }>,
      ) => Promise<{ ok: boolean; error?: string }>;
      pickCoverFile: () => Promise<{ ok: boolean; path: string; error?: string }>;
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
      onDefenderChanged: (cb: (state: DefenderState) => void) => () => void;
      onDefenderScan: (cb: (event: { log: DefenderScanLog; notify: boolean }) => void) => () => void;
      onLicenceChanged: (cb: (state: DeskoyLicenceState) => void) => () => void;
      onFileDrop: (cb: (event:
        | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
        | { type: 'over'; position: { x: number; y: number } }
        | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
        | { type: 'leave' }
      ) => void) => () => void;
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
