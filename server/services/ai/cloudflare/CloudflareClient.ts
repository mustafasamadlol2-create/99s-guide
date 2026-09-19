import { AIServiceError } from "../errors.js";
import { type CloudflareConfig } from "../config.js";

export interface CloudflareRunMessage {
  role: "system" | "user";
  content: string;
}

export interface CloudflareRunResult {
  text: string;
  responseId?: string;
}

export interface CloudflareMarkdownResult {
  data: string;
  format: string;
  mimeType?: string;
  name?: string;
  tokens?: number;
}

export type CloudflareFetch = typeof fetch;

function providerError(
  status: number,
  operation: string,
  cause?: unknown,
): AIServiceError {
  if (status === 401 || status === 403) {
    return new AIServiceError("AI_CONFIG_ERROR", {
      publicMessage: "AI service is not configured.",
      diagnosticMessage: `Cloudflare ${operation} authentication failed.`,
      cause,
    });
  }
  if (status === 429) {
    return new AIServiceError("AI_RATE_LIMITED", {
      publicMessage: "The AI service is temporarily rate limited.",
      diagnosticMessage: `Cloudflare ${operation} returned HTTP 429.`,
      retryable: true,
      cause,
    });
  }
  if (status >= 500) {
    return new AIServiceError("AI_UNAVAILABLE", {
      publicMessage: "The AI service is temporarily unavailable.",
      diagnosticMessage: `Cloudflare ${operation} returned HTTP ${status}.`,
      retryable: true,
      cause,
    });
  }
  return new AIServiceError("AI_PROVIDER_ERROR", {
    publicMessage: "The AI provider could not complete the request.",
    diagnosticMessage: `cloudflare_${operation}_invalid_request`,
    cause,
  });
}

async function parseJson(response: Response, operation: string): Promise<any> {
  try {
    return await response.json();
  } catch (error) {
    if (!response.ok) throw providerError(response.status, operation, error);
    throw new AIServiceError("AI_PROVIDER_ERROR", {
      publicMessage: "The AI provider returned an unreadable response.",
      diagnosticMessage: `Cloudflare ${operation} response was not valid JSON.`,
      cause: error,
    });
  }
}

function resultArray(payload: any): any[] {
  if (Array.isArray(payload?.result)) return payload.result;
  if (payload?.result && typeof payload.result === "object") return [payload.result];
  return [];
}

export class CloudflareClient {
  private readonly fetchImpl: CloudflareFetch;

  constructor(
    private readonly config: CloudflareConfig,
    fetchImpl: CloudflareFetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  async run(
    messages: CloudflareRunMessage[],
    responseFormat: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CloudflareRunResult> {
    const modelPath = this.config.model.split("/").map((part) => encodeURIComponent(part)).join("/");
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/ai/run/${modelPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          messages,
          response_format: responseFormat,
          max_tokens: this.config.maxOutputTokens,
        }),
        signal,
      },
    );
    const payload = await parseJson(response, "inference");
    if (!response.ok || payload?.success === false) {
      throw providerError(response.status, "inference", undefined);
    }

    const result = payload?.result;
    const candidate = result?.response ?? result?.choices?.[0]?.message?.content;
    const text = typeof candidate === "string"
      ? candidate
      : candidate && typeof candidate === "object"
        ? JSON.stringify(candidate)
        : undefined;
    if (!text) {
      throw new AIServiceError("AI_INVALID_RESPONSE", {
        publicMessage: "The AI provider returned an empty response.",
        diagnosticMessage: "Cloudflare inference response did not contain structured text.",
      });
    }
    return {
      text,
      responseId: response.headers.get("cf-ray") ?? undefined,
    };
  }


  async toMarkdown(
    bytes: Uint8Array,
    mimeType: string,
    filename: string,
    signal: AbortSignal,
  ): Promise<CloudflareMarkdownResult> {
    const form = new FormData();
    form.append("files", new Blob([Buffer.from(bytes)], { type: mimeType }), filename);
    if (mimeType === "application/pdf") {
      // Metadata can make an image-only PDF look non-empty even when there is
      // no readable page text. Excluding it lets the converter reliably detect
      // scanned documents and invoke the vision transcription fallback.
      form.append("conversionOptions", JSON.stringify({ pdf: { metadata: false } }));
    }
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/ai/tomarkdown`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          Accept: "application/json",
        },
        body: form,
        signal,
      },
    );
    const payload = await parseJson(response, "markdown");
    if (!response.ok || payload?.success === false) {
      throw providerError(response.status, "markdown", undefined);
    }
    const entry = resultArray(payload)[0];
    if (!entry || entry.format === "error" || typeof entry.data !== "string") {
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "The AI provider could not convert the media.",
        diagnosticMessage: "Cloudflare Markdown Conversion returned no usable Markdown.",
      });
    }
    return {
      data: entry.data,
      format: typeof entry.format === "string" ? entry.format : "markdown",
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
      name: typeof entry.name === "string" ? entry.name : undefined,
      tokens: typeof entry.tokens === "number" ? entry.tokens : undefined,
    };
  }
}