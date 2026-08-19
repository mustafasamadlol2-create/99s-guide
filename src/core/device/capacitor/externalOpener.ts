/**
 * Typed bridge to the native CapExternalOpener Capacitor plugin.
 *
 * PDF opening is implemented natively on iOS. The JavaScript layer only
 * dispatches the validated remote URL and awaits the native result.
 */

import { registerPlugin } from "@capacitor/core";

export interface CapExternalOpenerPlugin {
  /**
   * Legacy method retained in the interface only if the native implementation
   * still exposes it elsewhere. YouTube opening in the current application
   * uses Capacitor AppLauncher through NativeBridge instead.
   */
  openYouTube?(options: {
    url: string;
  }): Promise<{
    opened?: boolean;
    native?: boolean;
    ok?: boolean;
  }>;

  /**
   * Download and present a PDF using the native iOS PDF viewer.
   *
   * The Swift plugin currently resolves with:
   * { ok: true }
   */
  openPdf(options: {
    url: string;
  }): Promise<{
    ok: boolean;
  }>;
}

const CapExternalOpener =
  registerPlugin<CapExternalOpenerPlugin>(
    "CapExternalOpener",
  );

export default CapExternalOpener;