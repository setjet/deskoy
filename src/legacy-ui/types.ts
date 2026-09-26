/** Matches `saveSettings` / store `coverMode` in `global.d.ts`. */
export type DeskoyCoverMode =
  | 'excel'
  | 'vscode'
  | 'docs'
  | 'jira'
  | 'bi'
  | 'black'
  | 'url'
  | 'file';

export type DeskoyBuiltInCover = Exclude<DeskoyCoverMode, 'url' | 'file'>;
export type DeskoyDisplay = Awaited<ReturnType<Window['deskoy']['getDisplays']>>['displays'][number];
export type DeskoyFontSize = 'small' | 'default' | 'large';
export type DeskoySettings = Awaited<ReturnType<Window['deskoy']['getSettings']>>;
export type DeskoyProfile = DeskoySettings['profiles'][number];
export type DeskoyProfileSettings = DeskoyProfile['settings'];
export type DeskoyUpdatesPayload = {
  ok: true;
  visible?: boolean;
  title?: string;
  version?: string;
  notes?: string;
  downloadUrl?: string;
  releaseDate?: string | number;
};
export type NativeUpdatePayload = Awaited<ReturnType<Window['deskoy']['checkAppUpdate']>>;
export type ProfileDialogResult = { confirmed: boolean; value?: string };
export type ProfileDialogOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  input?: {
    label: string;
    placeholder?: string;
    value?: string;
  };
};

export type DeskoySaveSettingsPatch = Parameters<Window['deskoy']['saveSettings']>[0];
