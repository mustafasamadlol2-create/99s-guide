import {
  ACCEPTED_AUDIO_MIME_TYPES,
  AUDIO_FILE_PICKER_ACCEPT,
  MAX_LOCAL_AUDIO_FILE_BYTES,
} from "./constants";
import type { FocusAudioErrorCode } from "./types";

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "audio/mpeg": [".mp3"],
  "audio/mp4": [".m4a", ".mp4"],
  "audio/x-m4a": [".m4a"],
  "audio/aac": [".aac"],
  "audio/wav": [".wav"],
  "audio/x-wav": [".wav"],
  "audio/ogg": [".ogg", ".oga"],
};

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
};

export type LocalAudioFileValidation =
  | {
      readonly ok: true;
      readonly file: File;
      readonly mimeType: string;
      readonly displayName: string;
    }
  | {
      readonly ok: false;
      readonly errorCode: FocusAudioErrorCode;
    };

function safeBasename(value: string): string {
  const basename = value.split(/[\\/]/u).pop() ?? "";
  return basename
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ")
    .trim()
    .slice(0, 160);
}

function isFileLike(value: unknown): value is File {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<File>;
  return typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.slice === "function";
}

export function validateLocalAudioFile(value: unknown): LocalAudioFileValidation {
  if (!isFileLike(value)) return { ok: false, errorCode: "UNSUPPORTED_AUDIO" };
  if (!Number.isFinite(value.size) || value.size <= 0 || value.size > MAX_LOCAL_AUDIO_FILE_BYTES) {
    return { ok: false, errorCode: "UNSUPPORTED_AUDIO" };
  }

  const displayName = safeBasename(value.name);
  const extension = /\.[^.]+$/u.exec(displayName)?.[0].toLowerCase() ?? "";
  const declaredMime = value.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extensionMime = EXTENSION_MIME[extension];
  const allowedMime = ACCEPTED_AUDIO_MIME_TYPES.includes(
    declaredMime as (typeof ACCEPTED_AUDIO_MIME_TYPES)[number],
  );
  const genericMime = declaredMime === "" || declaredMime === "application/octet-stream";

  if (!displayName || (!allowedMime && !genericMime)) {
    return { ok: false, errorCode: "UNSUPPORTED_AUDIO" };
  }
  if (extension && !extensionMime) {
    return { ok: false, errorCode: "UNSUPPORTED_AUDIO" };
  }
  if (allowedMime && extensionMime) {
    const acceptedExtensions = MIME_EXTENSIONS[declaredMime] ?? [];
    if (!acceptedExtensions.includes(extension)) {
      return { ok: false, errorCode: "UNSUPPORTED_AUDIO" };
    }
  }
  const mimeType = allowedMime
    ? declaredMime
    : extensionMime;
  if (!mimeType) return { ok: false, errorCode: "UNSUPPORTED_AUDIO" };
  return { ok: true, file: value, mimeType, displayName };
}

export interface AudioFilePickerOptions {
  documentTarget?: Document | null;
  windowTarget?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
}

/**
 * Opens the native/browser file picker only when explicitly called by a user action.
 * No file bytes are copied into application storage by this helper.
 */
export function pickLocalAudioFile(options: AudioFilePickerOptions = {}): Promise<File | null> {
  const documentTarget = options.documentTarget === undefined
    ? (typeof document === "undefined" ? null : document)
    : options.documentTarget;
  const windowTarget = options.windowTarget === undefined
    ? (typeof window === "undefined" ? null : window)
    : options.windowTarget;
  if (!documentTarget?.body) return Promise.resolve(null);

  const input = documentTarget.createElement("input");
  input.type = "file";
  input.accept = AUDIO_FILE_PICKER_ACCEPT;
  input.multiple = false;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.style.position = "fixed";
  input.style.left = "-10000px";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      windowTarget?.removeEventListener("focus", onWindowFocus);
      input.remove();
      resolve(file);
    };
    const onChange = () => finish(input.files?.item(0) ?? null);
    const onCancel = () => finish(null);
    const onWindowFocus = () => {
      globalThis.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) finish(null);
      }, 100);
    };

    input.addEventListener("change", onChange, { once: true });
    input.addEventListener("cancel", onCancel, { once: true });
    windowTarget?.addEventListener("focus", onWindowFocus, { once: true });
    documentTarget.body.append(input);
    try {
      input.click();
    } catch {
      finish(null);
    }
  });
}

export async function pickAndValidateLocalAudioFile(
  options: AudioFilePickerOptions = {},
): Promise<LocalAudioFileValidation | { readonly ok: true; readonly cancelled: true }> {
  const file = await pickLocalAudioFile(options);
  if (!file) return { ok: true, cancelled: true };
  return validateLocalAudioFile(file);
}