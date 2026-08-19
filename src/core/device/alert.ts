/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface iOSAlertAction {
  label: string;
  style?: "default" | "cancel" | "destructive";
  onClick?: () => void;
}

export interface iOSAlertOptions {
  title: string;
  message?: string;
  actions?: iOSAlertAction[];
}

export const showiOSAlert = (options: iOSAlertOptions) => {
  const event = new CustomEvent("show-ios-alert", { detail: options });
  window.dispatchEvent(event);
};

// Also expose a standard browser alert replacement
export const nativeAlert = (title: string, message?: string) => {
  showiOSAlert({
    title,
    message,
    actions: [{ label: "OK", style: "default" }],
  });
};
