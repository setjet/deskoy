import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ThinkingOrb } from 'thinking-orbs';

export function mountThinkingOrb(host: HTMLElement): { setActive: (active: boolean) => void; dispose: () => void } {
  const root = createRoot(host);
  let current: boolean | null = null;

  const setActive = (active: boolean) => {
    if (active === current) return;
    current = active;
    root.render(createElement(ThinkingOrb, {
      state: 'searching',
      size: 64,
      paused: !active,
      'aria-label': active ? 'Scanning file' : 'File scan result',
    }));
  };

  setActive(false);
  return { setActive, dispose: () => root.unmount() };
}
