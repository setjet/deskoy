import { escapeHtml } from './dom';
import { defenderResultLabels } from './defender';

type StatusKind = 'ok' | 'error' | 'muted';
type SetStatus = (
  target: HTMLElement,
  message: string,
  kind?: StatusKind,
  persistent?: boolean,
) => void;

type ProtectionLogsElements = {
  list: HTMLElement;
  clearButton: HTMLButtonElement;
  status: HTMLElement;
  filter?: HTMLElement;
};

type FilterValue =
  | 'all'
  | 'cover'
  | 'auto-hide'
  | 'scan-all'
  | 'scan-clean'
  | 'scan-threat'
  | 'scan-remediated'
  | 'scan-failed'
  | 'scan-incomplete';

type LogRow = {
  timestamp: number;
  category: Exclude<FilterValue, 'all' | 'scan-all'>;
  html: string;
};

type ProtectionLogEntry = Awaited<
  ReturnType<typeof window.deskoy.getProtectionLogs>
>[number];

type FilterOption = {
  value: FilterValue;
  label: string;
  iconPath: string;
};

const filterGroups: Array<{ label: string; options: FilterOption[] }> = [
  {
    label: 'Activity',
    options: [
      { value: 'all', label: 'All activity', iconPath: 'M4 5.5H12M4 8H10M4 10.5H8' },
      { value: 'cover', label: 'Cover', iconPath: 'M3 4.5H13V11.5H3V4.5ZM6 14H10M8 11.5V14' },
      { value: 'auto-hide', label: 'Auto Hide', iconPath: 'M2.5 8S4.5 4.5 8 4.5 13.5 8 13.5 8 11.5 11.5 8 11.5 2.5 8 2.5 8ZM6.5 8A1.5 1.5 0 1 0 9.5 8 1.5 1.5 0 0 0 6.5 8Z' },
    ],
  },
  {
    label: 'File scans',
    options: [
      { value: 'scan-all', label: 'All file scans', iconPath: 'M8 2.5L13.5 4.5V8.5C13.5 11.5 8 14 8 14S2.5 11.5 2.5 8.5V4.5L8 2.5Z' },
      { value: 'scan-clean', label: 'Clean', iconPath: 'M3 8.25L6.25 11.5L13 4.75' },
      { value: 'scan-threat', label: 'Threat found', iconPath: 'M8 2.5L14 13H2L8 2.5ZM8 6V9M8 11.25H8.01' },
      { value: 'scan-remediated', label: 'Remediated', iconPath: 'M3 8.5L6.25 11.75L13 5M12.5 8V12.5H8' },
      { value: 'scan-failed', label: 'Failed', iconPath: 'M4 4L12 12M12 4L4 12' },
      { value: 'scan-incomplete', label: 'Incomplete', iconPath: 'M8 2.5V8L11.5 10M14 8A6 6 0 1 1 8 2' },
    ],
  },
];

function formatLogTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scanCategory(result: DefenderScanLog['result']): LogRow['category'] {
  switch (result) {
    case 'clean': return 'scan-clean';
    case 'threat': return 'scan-threat';
    case 'remediated': return 'scan-remediated';
    case 'failed': return 'scan-failed';
    default: return 'scan-incomplete';
  }
}

function defenderLogRow(log: DefenderScanLog, expanded: boolean): LogRow {
  const label = defenderResultLabels[log.result];
  const category = scanCategory(log.result);
  const source = log.source === 'automatic' ? 'Automatic scan' : 'File scan';
  return {
    timestamp: log.timestamp,
    category,
    html: `<article class="sp-log-row scan scan-${log.result} t-acc" data-log-category="${category}" data-scan-details="${escapeHtml(log.id)}" data-open="${expanded}">
      <button type="button" class="sp-log-disclosure t-acc-head" data-scan-toggle="${escapeHtml(log.id)}" aria-expanded="${expanded}">
        <span class="sp-log-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3L20 6V12C20 17 12 21 12 21C12 21 4 17 4 12V6L12 3Z M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="sp-log-body">
          <span class="sp-log-top"><span class="sp-log-process">${escapeHtml(log.filename)}</span><span class="sp-log-time">${formatLogTime(log.timestamp)}</span></span>
          <span class="sp-log-title">${escapeHtml(label)}</span>
          <span class="sp-log-meta"><span class="sp-log-kind">${source}</span>${log.action ? `<span>Defender action: ${escapeHtml(log.action)}</span>` : ''}</span>
        </span>
        <span class="sp-log-chevron t-acc-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M4 6.5L8 10.5L12 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </button>
      <div class="sp-log-detail-panel t-acc-panel"><div class="sp-log-detail-inner t-acc-panel-inner">
        <p>${escapeHtml(log.detail)}</p>
        ${!log.retryAvailable ? '<p>To check this file again, choose it using Scan File in Developer Mode.</p>' : ''}
        <div class="defender-actions">
          ${log.retryAvailable ? `<button type="button" class="sp-action-btn" data-retry-scan="${escapeHtml(log.id)}">Retry</button>` : ''}
          <button type="button" class="sp-action-btn" data-scan-security>Open Windows Security</button>
        </div>
      </div></div>
    </article>`,
  };
}

function protectionLogRow(log: ProtectionLogEntry): LogRow {
  const processName = escapeHtml(log.processName || 'Unknown process');
  const title = escapeHtml(log.title || 'Protected window');
  const action = escapeHtml(log.action || 'Protected');
  const isCoverActivation = /cover activated/i.test(log.action || '');
  const category = isCoverActivation ? 'cover' : 'auto-hide';
  const label = isCoverActivation ? 'Cover' : 'Auto Hide';
  const iconPath = isCoverActivation
    ? 'M10.7429 5.09232C11.1494 5.03223 11.5686 5 12.0004 5C17.1054 5 20.4553 9.50484 21.5807 11.2868C21.7169 11.5025 21.785 11.6103 21.8231 11.7767C21.8518 11.9016 21.8517 12.0987 21.8231 12.2236C21.7849 12.3899 21.7164 12.4985 21.5792 12.7156C21.2793 13.1901 20.8222 13.8571 20.2165 14.5805M6.72432 6.71504C4.56225 8.1817 3.09445 10.2194 2.42111 11.2853C2.28428 11.5019 2.21587 11.6102 2.17774 11.7765C2.1491 11.9014 2.14909 12.0984 2.17771 12.2234C2.21583 12.3897 2.28393 12.4975 2.42013 12.7132C3.54554 14.4952 6.89541 19 12.0004 19C14.0588 19 15.8319 18.2676 17.2888 17.2766M3.00042 3L21.0004 21M9.8791 9.87868C9.3362 10.4216 9.00042 11.1716 9.00042 12C9.00042 13.6569 10.3436 15 12.0004 15C12.8288 15 13.5788 14.6642 14.1217 14.1213'
    : 'M13 7.5L10 10.5L14 12.5L11 15.5M20 12C20 16.9084 14.646 20.4784 12.698 21.6148C12.4766 21.744 12.3659 21.8086 12.2097 21.8421C12.0884 21.8681 11.9116 21.8681 11.7903 21.8421C11.6341 21.8086 11.5234 21.744 11.302 21.6148C9.35396 20.4784 4 16.9084 4 12V7.2176C4 6.41809 4 6.01833 4.13076 5.6747C4.24627 5.37114 4.43398 5.10028 4.67766 4.88553C4.9535 4.64244 5.3278 4.50208 6.0764 4.22135L11.4382 2.21067C11.6461 2.13271 11.75 2.09373 11.857 2.07828C11.9518 2.06457 12.0482 2.06457 12.143 2.07828C12.25 2.09373 12.3539 2.13271 12.5618 2.21067L17.9236 4.22135C18.6722 4.50208 19.0465 4.64244 19.3223 4.88553C19.566 5.10028 19.7537 5.37114 19.8692 5.6747C20 6.01833 20 6.41809 20 7.2176V12Z';
  return {
    timestamp: log.timestamp,
    category,
    html: `<article class="sp-log-row ${category === 'cover' ? 'cover' : 'protect'}" data-log-category="${category}">
      <span class="sp-log-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="${iconPath}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="sp-log-body">
        <span class="sp-log-top"><span class="sp-log-process">${processName}</span><span class="sp-log-time">${formatLogTime(log.timestamp)}</span></span>
        <span class="sp-log-title">${title}</span>
        <span class="sp-log-meta"><span class="sp-log-kind">${label}</span><span>${action}</span></span>
      </span>
    </article>`,
  };
}

function filterLabel(value: FilterValue): string {
  return filterGroups.flatMap((group) => group.options)
    .find((option) => option.value === value)?.label ?? 'All activity';
}

function rowMatchesFilter(row: LogRow, value: FilterValue): boolean {
  if (value === 'all') return true;
  if (value === 'scan-all') return row.category.startsWith('scan-');
  return row.category === value;
}

function filterIcon(option: FilterOption): string {
  return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${option.iconPath}" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function bindProtectionLogs(
  elements: ProtectionLogsElements,
  setStatus: SetStatus,
  isDeveloperModeEnabled: () => boolean = () => true,
): () => Promise<void> {
  const { list, clearButton, status, filter } = elements;
  const events = new AbortController();
  let revision = 0;
  let rows: LogRow[] = [];
  let selected: FilterValue = 'all';
  let open = false;
  let closing = false;
  let closeTimer: number | null = null;
  let scanMenuOpen = false;
  let scanMenuClosing = false;
  let scanMenuCloseTimer: number | null = null;
  const expandedScans = new Set<string>();

  function renderRows(): void {
    const visible = rows.filter((row) => rowMatchesFilter(row, selected));
    list.innerHTML = visible.length
      ? visible.map((row) => row.html).join('')
      : `<p class="sp-logs-empty">${rows.length ? 'No activity matches this filter.' : 'No activity yet.'}</p>`;
  }

  function dropdownCloseMs(): number {
    if (
      document.documentElement.getAttribute('data-motion') === 'reduced'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return 0;
    return Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur'),
    ) || 150;
  }

  function renderDropdown(): void {
    if (!filter) return;
    filter.dataset.open = String(open);
    const activityOptions = filterGroups[0].options;
    const scanOptions = filterGroups[1].options;
    const renderOption = (option: FilterOption) => {
      const isSelected = option.value === selected;
      return `<button type="button" class="sp-log-dropdown-item${isSelected ? ' is-selected' : ''}" data-log-filter="${option.value}" role="menuitemradio" aria-checked="${isSelected}">
        <span class="sp-log-dropdown-icon">${filterIcon(option)}</span>
        <span class="sp-log-dropdown-item-label">${escapeHtml(option.label)}</span>
        <span class="sp-log-dropdown-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M4 8.25L6.75 11L12 5.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </button>`;
    };
    filter.innerHTML = `
      <button type="button" class="sp-log-dropdown-trigger" aria-haspopup="menu" aria-expanded="${open}">
        <span class="sp-log-dropdown-trigger-label">${escapeHtml(filterLabel(selected))}</span>
        <svg class="sp-log-dropdown-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6.5L8 10.5L12 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="sp-log-dropdown-menu t-dropdown${open ? ' is-open' : ''}${closing ? ' is-closing' : ''}" data-origin="top-left" role="menu" ${open || closing ? '' : 'hidden'}>
        <div class="sp-log-dropdown-group">
          <div class="sp-log-dropdown-label">Activity</div>
          ${activityOptions.map(renderOption).join('')}
        </div>
        <div class="sp-log-dropdown-separator" role="separator"></div>
        <div class="sp-log-dropdown-group">
          <div class="sp-log-dropdown-label">Defender</div>
          <div class="sp-log-dropdown-sub" data-open="${scanMenuOpen}">
            <button type="button" class="sp-log-dropdown-item sp-log-dropdown-sub-trigger${selected.startsWith('scan-') ? ' is-current-group' : ''}" data-log-submenu aria-haspopup="menu" aria-expanded="${scanMenuOpen}">
              <span class="sp-log-dropdown-icon">${filterIcon(scanOptions[0])}</span>
              <span class="sp-log-dropdown-item-label">File scans</span>
              <span class="sp-log-dropdown-sub-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </button>
            <div class="sp-log-dropdown-submenu t-dropdown${scanMenuOpen ? ' is-open' : ''}${scanMenuClosing ? ' is-closing' : ''}" data-origin="top-left" role="menu" ${scanMenuOpen || scanMenuClosing ? '' : 'hidden'}>
              <div class="sp-log-dropdown-label">File scans</div>
              ${renderOption(scanOptions[0])}
              <div class="sp-log-dropdown-separator" role="separator"></div>
              ${scanOptions.slice(1).map(renderOption).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  function openScanMenu(): void {
    if (!filter || scanMenuOpen) return;
    if (scanMenuCloseTimer !== null) {
      window.clearTimeout(scanMenuCloseTimer);
      scanMenuCloseTimer = null;
    }
    scanMenuOpen = true;
    scanMenuClosing = false;
    const wrapper = filter.querySelector<HTMLElement>('.sp-log-dropdown-sub');
    const trigger = filter.querySelector<HTMLButtonElement>('[data-log-submenu]');
    const menu = filter.querySelector<HTMLElement>('.sp-log-dropdown-submenu');
    if (!wrapper || !trigger || !menu) {
      renderDropdown();
      return;
    }
    wrapper.dataset.open = 'true';
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.classList.remove('is-closing');
    void menu.offsetWidth;
    menu.classList.add('is-open');
  }

  function closeScanMenu(): void {
    if (!filter || (!scanMenuOpen && !scanMenuClosing)) return;
    if (scanMenuCloseTimer !== null) window.clearTimeout(scanMenuCloseTimer);
    scanMenuOpen = false;
    scanMenuClosing = true;
    const wrapper = filter.querySelector<HTMLElement>('.sp-log-dropdown-sub');
    if (wrapper) wrapper.dataset.open = 'false';
    filter.querySelector<HTMLButtonElement>('[data-log-submenu]')
      ?.setAttribute('aria-expanded', 'false');
    const menu = filter.querySelector<HTMLElement>('.sp-log-dropdown-submenu');
    menu?.classList.remove('is-open');
    menu?.classList.add('is-closing');
    scanMenuCloseTimer = window.setTimeout(() => {
      scanMenuClosing = false;
      scanMenuCloseTimer = null;
      renderDropdown();
    }, dropdownCloseMs());
  }

  function openDropdown(): void {
    if (!filter || open) return;
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    open = true;
    closing = false;
    renderDropdown();
  }

  function closeDropdown(): void {
    if (!filter || (!open && !closing)) return;
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    open = false;
    closing = true;
    scanMenuOpen = false;
    scanMenuClosing = false;
    if (scanMenuCloseTimer !== null) {
      window.clearTimeout(scanMenuCloseTimer);
      scanMenuCloseTimer = null;
    }
    filter.dataset.open = 'false';
    filter.querySelector<HTMLButtonElement>('.sp-log-dropdown-trigger')
      ?.setAttribute('aria-expanded', 'false');
    const menu = filter.querySelector<HTMLElement>('.sp-log-dropdown-menu');
    menu?.classList.remove('is-open');
    menu?.classList.add('is-closing');
    closeTimer = window.setTimeout(() => {
      closing = false;
      closeTimer = null;
      renderDropdown();
    }, dropdownCloseMs());
  }

  async function refresh(): Promise<void> {
    const request = ++revision;
    try {
      const [logs, scans] = await Promise.all([
        window.deskoy.getProtectionLogs(),
        isDeveloperModeEnabled() ? window.deskoy.getDefenderLogs() : Promise.resolve([]),
      ]);
      if (request !== revision || events.signal.aborted) return;
      rows = logs.map(protectionLogRow)
        .concat(scans.map((log) => defenderLogRow(log, expandedScans.has(log.id))))
        .sort((left, right) => right.timestamp - left.timestamp);
      clearButton.disabled = rows.length === 0;
      renderRows();
      renderDropdown();
    } catch {
      if (request !== revision || events.signal.aborted) return;
      rows = [];
      clearButton.disabled = true;
      list.innerHTML = '<p class="sp-logs-empty">Could not load logs.</p>';
      renderDropdown();
    }
  }

  clearButton.addEventListener('click', async () => {
    clearButton.disabled = true;
    status.textContent = '';
    try {
      const [result, scanResult] = await Promise.all([
        window.deskoy.clearProtectionLogs(),
        window.deskoy.clearDefenderLogs(),
      ]);
      if (!result.ok) throw new Error(result.error || 'Unable to clear logs.');
      if (!scanResult.ok) throw new Error('Unable to clear scan logs.');
      expandedScans.clear();
      selected = 'all';
      setStatus(status, 'Logs cleared.', 'ok');
      await refresh();
    } catch {
      setStatus(status, 'Could not clear logs.', 'error');
      clearButton.disabled = false;
    }
  }, { signal: events.signal });

  filter?.addEventListener('click', (event) => {
    event.stopPropagation?.();
    const target = event.target as HTMLElement;
    if (target.closest('.sp-log-dropdown-trigger')) {
      if (open) closeDropdown();
      else openDropdown();
      return;
    }
    if (target.closest('[data-log-submenu]')) {
      if (scanMenuOpen) closeScanMenu();
      else openScanMenu();
      return;
    }
    const option = target.closest<HTMLButtonElement>('[data-log-filter]');
    if (!option) return;
    selected = option.dataset.logFilter as FilterValue;
    renderRows();
    renderDropdown();
    closeDropdown();
  }, { signal: events.signal });

  filter?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (scanMenuOpen || scanMenuClosing) {
        closeScanMenu();
        filter.querySelector<HTMLButtonElement>('[data-log-submenu]')?.focus();
        return;
      }
      closeDropdown();
      filter.querySelector<HTMLButtonElement>('.sp-log-dropdown-trigger')?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && (event.target as HTMLElement).closest('[data-log-submenu]')) {
      event.preventDefault();
      openScanMenu();
      window.requestAnimationFrame(() => {
        filter.querySelector<HTMLButtonElement>('.sp-log-dropdown-submenu [data-log-filter]')?.focus();
      });
      return;
    }
    if (event.key === 'ArrowLeft' && (event.target as HTMLElement).closest('.sp-log-dropdown-submenu')) {
      event.preventDefault();
      closeScanMenu();
      filter.querySelector<HTMLButtonElement>('[data-log-submenu]')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    if (!open) {
      event.preventDefault();
      openDropdown();
      window.requestAnimationFrame(() => {
        const options = Array.from(filter.querySelectorAll<HTMLButtonElement>('[data-log-filter], [data-log-submenu]'))
          .filter((option) => option.offsetParent !== null);
        options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
      });
      return;
    }
    const options = Array.from(filter.querySelectorAll<HTMLButtonElement>('[data-log-filter], [data-log-submenu]'))
      .filter((option) => option.offsetParent !== null);
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    options[(current + direction + options.length) % options.length].focus();
  }, { signal: events.signal });

  filter?.addEventListener('pointerover', (event) => {
    if ((event.target as HTMLElement).closest('.sp-log-dropdown-sub')) openScanMenu();
  }, { signal: events.signal });

  filter?.addEventListener('pointerout', (event) => {
    const submenu = (event.target as HTMLElement).closest<HTMLElement>('.sp-log-dropdown-sub');
    if (!submenu || submenu.contains(event.relatedTarget as Node | null)) return;
    closeScanMenu();
  }, { signal: events.signal });

  window.addEventListener('click', (event) => {
    if (!open || !filter || filter.contains(event.target as Node)) return;
    closeDropdown();
  }, { signal: events.signal });

  list.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLButtonElement>('[data-retry-scan], [data-scan-security]');
    if (actionButton && ('retryScan' in actionButton.dataset || 'scanSecurity' in actionButton.dataset)) {
      if (actionButton.disabled) return;
      actionButton.disabled = true;
      try {
        if (actionButton.dataset.retryScan) {
          const result = await window.deskoy.retryDefenderScan(actionButton.dataset.retryScan);
          setStatus(status, result.queued ? 'Scan queued.' : 'Scan was not queued.', result.queued ? 'ok' : 'muted');
        } else {
          const result = await window.deskoy.openWindowsSecurity();
          if (!result.ok) throw new Error('Windows Security could not be opened.');
        }
      } catch (error) {
        setStatus(status, typeof error === 'string' ? error : 'The action could not be completed.', 'error', true);
      } finally {
        actionButton.disabled = false;
      }
      return;
    }

    const toggle = target.closest<HTMLButtonElement>('[data-scan-toggle]');
    if (toggle) {
      const id = toggle.dataset.scanToggle;
      if (!id) return;
      const row = toggle.closest<HTMLElement>('[data-scan-details]');
      if (!row) return;
      const expanded = row.dataset.open !== 'true';
      row.dataset.open = String(expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      if (expanded) expandedScans.add(id);
      else expandedScans.delete(id);
      return;
    }
  }, { signal: events.signal });

  renderDropdown();
  const unlistenScan = window.deskoy.onDefenderScan(() => void refresh());
  window.addEventListener('pagehide', () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    if (scanMenuCloseTimer !== null) window.clearTimeout(scanMenuCloseTimer);
    events.abort();
    unlistenScan();
  }, { once: true });

  return refresh;
}
