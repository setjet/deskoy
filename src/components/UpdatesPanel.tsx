import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type DeskoyUpdatesPayload = {
  ok: true;
  visible?: boolean;
  title?: string;
  version?: string;
  notes?: string;
  downloadUrl?: string;
};

type NativeUpdatePayload = Awaited<ReturnType<Window['deskoy']['checkAppUpdate']>>;

type UpdatesState =
  | { status: 'checking' }
  | { status: 'empty'; message: string }
  | {
      status: 'available';
      title: string;
      version: string;
      notes: string;
      downloadUrl: string;
      installable: boolean;
      installing: boolean;
      installStatus: string;
    };

const DESKOY_DOWNLOAD_URL = 'https://www.deskoy.com/download';
const REFRESH_UPDATES_EVENT = 'deskoy:refreshUpdatesPanel';

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

function nativeUpdateIsAvailable(
  native: NativeUpdatePayload,
  installedVersion: string,
): boolean {
  if (!native.ok || !native.available) return false;
  if (!native.version || !installedVersion) return true;
  return updateVersionIsNewer(native.version, installedVersion);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function UpdatesPanel(): ReactElement {
  const [state, setState] = useState<UpdatesState>({
    status: 'empty',
    message: 'You’re up to date. New versions of Deskoy will appear here.',
  });

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'checking' });

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
      if (res.ok && (!data || data.ok !== true)) throw new Error('updates_bad_payload');

      const visible = Boolean(data?.visible);
      const title = typeof data?.title === 'string' ? data.title.trim() : '';
      const version = typeof data?.version === 'string' ? data.version.trim() : '';
      const notes = typeof data?.notes === 'string' ? data.notes.trim() : '';
      const downloadUrl =
        typeof data?.downloadUrl === 'string' ? data.downloadUrl.trim() : '';
      const currentAppVersion = meta.version.trim();
      const nativeAvailable = nativeUpdateIsAvailable(native, currentAppVersion);
      const feedAvailable =
        visible &&
        (!version || !currentAppVersion || updateVersionIsNewer(version, currentAppVersion));

      if (!feedAvailable && !nativeAvailable) {
        setState({
          status: 'empty',
          message: res.ok
            ? 'You’re up to date. New versions of Deskoy will appear here.'
            : 'Updates aren’t available right now. Please check again later.',
        });
        return;
      }

      const displayVersion = nativeAvailable && native.version ? native.version : version;
      const displayNotes =
        notes ||
        (nativeAvailable && native.notes ? native.notes.trim() : '') ||
        'No release notes were provided for this update.';
      setState({
        status: 'available',
        title: title || 'Deskoy update',
        version: displayVersion || '—',
        notes: displayNotes,
        downloadUrl: downloadUrl || DESKOY_DOWNLOAD_URL,
        installable: nativeAvailable && native.configured,
        installing: false,
        installStatus:
          nativeAvailable && native.configured
            ? 'Update directly in Deskoy. The app may close during installation.'
            : 'Download the latest version to get these changes.',
      });
    } catch {
      setState({
        status: 'empty',
        message: 'Updates aren’t available right now. Please check again later.',
      });
    }
  }, []);

  const handleUpdateAction = useCallback(async () => {
    if (state.status !== 'available') return;
    if (!state.installable) {
      if (state.downloadUrl) void window.deskoy.openExternal(state.downloadUrl);
      return;
    }

    setState((current) =>
      current.status === 'available'
        ? { ...current, installing: true, installStatus: 'Preparing update...' }
        : current,
    );
    const result = await window.deskoy.installAppUpdate();
    if (!result.ok) {
      setState((current) =>
        current.status === 'available'
          ? {
              ...current,
              installable: false,
              installing: false,
              installStatus: 'Could not install in-app. Download the installer instead.',
            }
          : current,
      );
    }
  }, [state]);

  useEffect(() => {
    const onRefresh = (): void => void refresh();
    window.addEventListener(REFRESH_UPDATES_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_UPDATES_EVENT, onRefresh);
  }, [refresh]);

  useEffect(() => {
    return window.deskoy.onUpdateProgress((event) => {
      setState((current) => {
        if (current.status !== 'available') return current;
        if (event.event === 'started') {
          return { ...current, installing: true, installStatus: 'Starting download...' };
        }
        if (event.event === 'progress') {
          const downloaded = event.downloaded ?? 0;
          const total = event.total ?? 0;
          const percent = total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : null;
          return {
            ...current,
            installing: true,
            installStatus:
              percent === null
                ? `Downloading update ${formatBytes(downloaded)}`
                : `Downloading update ${percent}% (${formatBytes(downloaded)} of ${formatBytes(total)})`,
          };
        }
        if (event.event === 'finished') {
          return { ...current, installing: true, installStatus: 'Installing update...' };
        }
        if (event.event === 'installed') {
          return {
            ...current,
            installing: false,
            installStatus: 'Update installed. Restart Deskoy to finish.',
          };
        }
        return {
          ...current,
          installable: false,
          installing: false,
          installStatus: 'Could not install in-app. Download the installer instead.',
        };
      });
    });
  }, []);

  if (state.status === 'checking') {
    return <p className="sp-updates-empty">Checking for updates…</p>;
  }

  if (state.status === 'empty') {
    return <p className="sp-updates-empty">{state.message}</p>;
  }

  return (
    <div className="sp-update-card" role="region" aria-label="Latest update announcement">
      <div className="sp-update-hero">
        <div className="sp-update-hero-top">
          <div>
            <div className="sp-update-title">{state.title}</div>
            <div className="sp-update-sub">Latest update available.</div>
          </div>
          <div className="sp-update-badge">{state.version}</div>
        </div>
      </div>

      <div className="sp-update-body">
        <div className="sp-update-section-title">What’s new</div>
        <div className="sp-update-notes">{state.notes}</div>
      </div>

      <div className="sp-update-footer">
        <div className="sp-update-hint">{state.installStatus}</div>
        <button
          type="button"
          className="sp-update-btn"
          disabled={state.installing || (!state.installable && !state.downloadUrl)}
          onClick={() => void handleUpdateAction()}
        >
          {state.installing ? 'Installing...' : state.installable ? 'Install' : 'Download'}
        </button>
      </div>
    </div>
  );
}

export function mountUpdatesPanel(rootElement: HTMLElement): void {
  createRoot(rootElement).render(<UpdatesPanel />);
}

export function refreshUpdatesPanel(): void {
  window.dispatchEvent(new Event(REFRESH_UPDATES_EVENT));
}
