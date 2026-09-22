export const APP_ICON_IDS = [
  "primary",
  "midnight",
  "rose",
  "monochrome",
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

export interface AppIconState {
  /** The selector is available on every device. */
  supported: boolean;
  iconId: AppIconId;
  /** True only when the current native shell can also change its launcher icon. */
  nativeSupported?: boolean;
}

export interface NativeAppIconPlugin {
  getState(): Promise<{
    supported: boolean;
    iconId: AppIconId;
  }>;
  setIcon(options: { iconId: AppIconId }): Promise<{ iconId: AppIconId }>;
}
