export const APP_ICON_IDS = [
  "primary",
  "midnight",
  "rose",
  "monochrome",
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

export interface AppIconState {
  supported: boolean;
  iconId: AppIconId;
}

export interface NativeAppIconPlugin {
  getState(): Promise<AppIconState>;
  setIcon(options: { iconId: AppIconId }): Promise<{ iconId: AppIconId }>;
}