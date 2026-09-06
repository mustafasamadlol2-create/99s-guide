/**
 * toast — thin wrapper around sonner for app-wide notifications.
 *
 * Usage
 *   import { toast } from "@/core/utils/toast";
 *   toast.error("Invalid domain — only @comed.uobaghdad.edu.iq accounts are allowed.");
 *   toast.success("Password updated successfully.");
 *   toast.warning("Session expiring soon.");
 *   toast.info("Syncing your data…");
 */

import { toast as sonner } from "sonner";

export const toast = {
  error:   (msg: string, opts?: Parameters<typeof sonner.error>[1])   => sonner.error(msg, opts),
  success: (msg: string, opts?: Parameters<typeof sonner.success>[1]) => sonner.success(msg, opts),
  warning: (msg: string, opts?: Parameters<typeof sonner.warning>[1]) => sonner.warning(msg, opts),
  info:    (msg: string, opts?: Parameters<typeof sonner.info>[1])    => sonner.info(msg, opts),
  /** Raw sonner access for advanced use-cases (custom JSX, promises, etc.). */
  raw:     sonner,
};
