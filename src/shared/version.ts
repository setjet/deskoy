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

export function updateVersionIsNewer(
  updateVersion: string,
  installedVersion: string,
): boolean {
  const comparison = compareVersions(updateVersion, installedVersion);
  return comparison === null || comparison > 0;
}

export function displayUpdateVersion(version: string): string {
  const value = version.trim();
  if (!value) return '';
  return value.toLowerCase().startsWith('v') ? value : `v${value}`;
}
