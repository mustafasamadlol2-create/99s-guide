const PUBLIC_AUTH_ENDPOINT = /\/api\/auth\/(?:login|register|forgot-password|reset-password|oauth-url|oauth-session)(?:\/|[?#]|$)/;

export function isPublicAuthEndpoint(url: string): boolean {
  return PUBLIC_AUTH_ENDPOINT.test(url);
}