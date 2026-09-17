import { MEBIBYTE } from "../input/config.js";

export const AI_HTTP_MAX_TOTAL_IMAGE_BYTES = 100 * MEBIBYTE;
export const AI_HTTP_MAX_OPTIONS_BYTES = 16 * 1024;
export const AI_HTTP_RATE_WINDOW_MS = 10 * 60 * 1000;
export const AI_HTTP_RATE_MAX_REQUESTS = 20;
export const AI_HTTP_MAX_ACTIVE_PER_ADMIN = 1;
export const AI_HTTP_MAX_ACTIVE_GLOBAL = 3;
export const AI_HTTP_MAX_RATE_ENTRIES = 10_000;

export const AI_HTTP_LIMITS = Object.freeze({
  pdfBytes: 50 * MEBIBYTE,
  imageBytes: 20 * MEBIBYTE,
  imageCount: 20,
  totalImageBytes: AI_HTTP_MAX_TOTAL_IMAGE_BYTES,
  textBytes: 1 * MEBIBYTE,
  optionsBytes: AI_HTTP_MAX_OPTIONS_BYTES,
});