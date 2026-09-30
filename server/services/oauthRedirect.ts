interface OAuthRedirectUriOptions {
  provider: string;
  nodeEnv?: string;
  replitDevDomain?: string;
  productionBackendOrigin: string;
  resolveBackendOrigin: () => string;
}

function replitDevelopmentOrigin(domain: string): string {
  const normalizedDomain = domain.trim();
  const previewUrl = new URL(
    normalizedDomain.startsWith("https://")
      ? normalizedDomain
      : `https://${normalizedDomain}`,
  );

  if (
    previewUrl.protocol !== "https:" ||
    previewUrl.username ||
    previewUrl.password ||
    previewUrl.pathname !== "/" ||
    previewUrl.search ||
    previewUrl.hash
  ) {
    throw new Error("REPLIT_DEV_DOMAIN is not a valid HTTPS origin.");
  }

  return previewUrl.origin;
}

/**
 * Google callbacks use the stable Replit preview host in development, while
 * production continues to use the explicitly configured Render backend.
 */
export function buildOAuthRedirectUri({
  provider,
  nodeEnv,
  replitDevDomain,
  productionBackendOrigin,
  resolveBackendOrigin,
}: OAuthRedirectUriOptions): string {
  let origin: string;
  if (provider === "google" && nodeEnv === "production") {
    origin = productionBackendOrigin;
  } else if (
    provider === "google" &&
    nodeEnv !== "production" &&
    replitDevDomain?.trim()
  ) {
    origin = replitDevelopmentOrigin(replitDevDomain);
  } else {
    origin = resolveBackendOrigin();
  }

  return `${new URL(origin).origin}/auth/callback/${provider}`;
}