export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(value: string): Uint8Array | null {
  if (
    value.length === 0
    || value.length % 4 === 1
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return null;
  }

  const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = standard + "=".repeat((4 - standard.length % 4) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}