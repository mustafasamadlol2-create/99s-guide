import jwt from "jsonwebtoken";

export const PDF_DOWNLOAD_SCOPE = "pdf-download" as const;

export interface PdfDownloadClaims {
  userId: string;
  email: string;
  sessionVersion: number;
  materialId: string;
  scope: typeof PDF_DOWNLOAD_SCOPE;
}

export function createPdfDownloadToken(
  claims: Omit<PdfDownloadClaims, "scope">,
  secret: string,
  expiresInSeconds = 300,
): string {
  if (!secret) throw new Error("pdf_download_secret_missing");
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("pdf_download_expiry_invalid");
  }

  return jwt.sign(
    { ...claims, scope: PDF_DOWNLOAD_SCOPE },
    secret,
    {
      algorithm: "HS256",
      expiresIn: Math.floor(expiresInSeconds),
    },
  );
}

export function verifyPdfDownloadToken(
  token: string,
  materialId: string,
  secret: string,
): PdfDownloadClaims | null {
  if (!token || !materialId || !secret) return null;

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || decoded === null) return null;

    if (
      decoded.scope !== PDF_DOWNLOAD_SCOPE ||
      decoded.materialId !== materialId ||
      typeof decoded.userId !== "string" ||
      !decoded.userId ||
      typeof decoded.email !== "string" ||
      !decoded.email ||
      typeof decoded.sessionVersion !== "number"
    ) {
      return null;
    }

    return {
      userId: decoded.userId,
      email: decoded.email,
      sessionVersion: decoded.sessionVersion,
      materialId: decoded.materialId,
      scope: PDF_DOWNLOAD_SCOPE,
    };
  } catch {
    return null;
  }
}
