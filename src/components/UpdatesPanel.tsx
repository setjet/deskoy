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

type UpdatesState =
  | { status: 'checking' }
  | { status: 'empty'; message: string }
  | {
      status: 'available';
      title: string;
      version: string;
      notes: string;
      downloadUrl: string;
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

function UpdatesPanel(): ReactElement {
  const [state, setState] = useState<UpdatesState>({
    status: 'empty',
    message: 'You’re up to date. New versions of Deskoy will appear here.',
  });

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'checking' });

      const [meta, res] = await Promise.all([
        window.deskoy.getAppVersion(),
        window.deskoy.getUpdates(),
      ]);
      if (!res.ok) throw new Error(res.error || 'updates_failed');

      const data = res.data as Partial<DeskoyUpdatesPayload> | undefined;
      if (!data || data.ok !== true) throw new Error('updates_bad_payload');

      const visible = Boolean(data.visible);
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const version = typeof data.version === 'string' ? data.version.trim() : '';
      const notes = typeof data.notes === 'string' ? data.notes.trim() : '';
      const downloadUrl =
        typeof data.downloadUrl === 'string' ? data.downloadUrl.trim() : '';
      const currentAppVersion = meta.version.trim();

      if (
        !visible ||
        (version && currentAppVersion && !updateVersionIsNewer(version, currentAppVersion))
      ) {
        setState({
          status: 'empty',
          message: 'You’re up to date. New versions of Deskoy will appear here.',
        });
        return;
      }

      setState({
        status: 'available',
        title: title || 'Deskoy update',
        version: version || '—',
        notes: notes || '—',
        downloadUrl: downloadUrl || DESKOY_DOWNLOAD_URL,
      });
    } catch {
      setState({
        status: 'empty',
        message: 'Updates aren’t available right now. Please check again later.',
      });
    }
  }, []);

  useEffect(() => {
    const onRefresh = (): void => void refresh();
    window.addEventListener(REFRESH_UPDATES_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_UPDATES_EVENT, onRefresh);
  }, [refresh]);

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
        <div className="sp-update-hint">Download the latest version to get these changes.</div>
        <button
          type="button"
          className="sp-update-btn"
          disabled={!state.downloadUrl}
          onClick={() => void window.deskoy.openExternal(state.downloadUrl)}
        >
          Download
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
