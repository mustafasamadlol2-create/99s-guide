import { AIServiceError } from "../errors.js";
import type { CloudflareConfig } from "../config.js";

export interface CloudflareRunMessage {
  role: "system" | "user";
  content: string;
}

export interface CloudflareRunResult {
  text: string;
  responseId?: string;
}

export interface CloudflareVisionResult {
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
  payload?: unknown,
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
  const details = providerErrorText(payload);
  return new AIServiceError("AI_PROVIDER_ERROR", {
    publicMessage: "The AI provider could not complete the request.",
    diagnosticMessage: details
      ? `cloudflare_${operation}_invalid_request: ${details.slice(0, 800)}`
      : `cloudflare_${operation}_invalid_request`,
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

function providerErrorText(payload: any): string {
  const values: string[] = [];
  if (typeof payload?.message === "string") values.push(payload.message);
  for (const entry of Array.isArray(payload?.errors) ? payload.errors : []) {
    if (typeof entry?.message === "string") values.push(entry.message);
  }
  return values.join(" ");
}

function jsonModeCouldNotBeMet(status: number, payload: any): boolean {
  return status >= 400 && status < 500 && /json mode[^.]*could(?:n['’]t| not) be met/iu.test(providerErrorText(payload));
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
    const execute = async (
      currentMessages: CloudflareRunMessage[],
      currentResponseFormat: Record<string, unknown>,
    ): Promise<{ response: Response; payload: any }> => {
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
            messages: currentMessages,
            response_format: currentResponseFormat,
            max_tokens: this.config.maxOutputTokens,
            temperature: 0,
            stream: false,
          }),
          signal,
        },
      );
      return { response, payload: await parseJson(response, "inference") };
    };

    let attempt = await execute(messages, responseFormat);
    if (jsonModeCouldNotBeMet(attempt.response.status, attempt.payload)) {
      // Cloudflare documents that strict json_schema mode can occasionally fail
      // even on supported models. Retry once with json_object mode while placing
      // the exact schema in a trusted system instruction; the provider still
      // performs the original Zod validation before accepting the response.
      const schemaText = JSON.stringify(responseFormat);
      attempt = await execute(
        [
          {
            role: "system",
            content: `Strict schema generation previously failed. Return ONLY one valid JSON object matching this response contract exactly: ${schemaText}`,
          },
          ...messages,
        ],
        { type: "json_object" },
      );
    }

    const { response, payload } = attempt;
    if (!response.ok || payload?.success === false) {
      throw providerError(response.status, "inference", undefined, payload);
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


  /**
   * Plain text generation without JSON-mode. Calendar image recovery uses this
   * after OCR/transcription so a strict JSON-schema failure cannot turn an
   * otherwise readable timetable image into a provider error.
   */
  async runPlainText(
    messages: CloudflareRunMessage[],
    signal: AbortSignal,
    maxTokens = this.config.maxOutputTokens,
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
          max_tokens: Math.max(256, Math.min(maxTokens, this.config.maxOutputTokens)),
          temperature: 0,
          stream: false,
        }),
        signal,
      },
    );
    const payload = await parseJson(response, "inference_text");
    if (!response.ok || payload?.success === false) {
      throw providerError(response.status, "inference_text", undefined, payload);
    }
    const result = payload?.result;
    const candidate = result?.response ?? result?.choices?.[0]?.message?.content;
    const text = typeof candidate === "string"
      ? candidate.trim()
      : candidate && typeof candidate === "object"
        ? JSON.stringify(candidate)
        : "";
    if (!text) {
      throw new AIServiceError("AI_INVALID_RESPONSE", {
        publicMessage: "The AI provider returned an empty response.",
        diagnosticMessage: "Cloudflare plain-text inference returned no text.",
      });
    }
    return {
      text,
      responseId: response.headers.get("cf-ray") ?? undefined,
    };
  }

  async visionToText(
    bytes: Uint8Array,
    mimeType: string,
    signal: AbortSignal,
    question?: string,
    maxTokens?: number,
  ): Promise<CloudflareVisionResult> {
    const modelPath = this.config.visionModel.split("/").map((part) => encodeURIComponent(part)).join("/");
    const image = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
    const prompt = question ?? [
      "Read this educational source image as a high-fidelity OCR/transcription task.",
      "Transcribe every visible word, number, option label, table cell, date, time, heading, annotation, and diagram label.",
      "When the page contains an educational diagram, also describe only the clearly visible labelled relationships needed to preserve its factual content.",
      "Preserve reading order and use Markdown rows/lists when helpful.",
      "Do not summarize, omit, answer, correct, or invent content. If a character is genuinely unreadable, mark it as [unclear].",
    ].join(" ");
    const isMoondream = /(?:^|\/)moondream(?:\/|$)|moondream3/iu.test(this.config.visionModel);
    const requestedMaxTokens = Math.max(512, Math.min(maxTokens ?? this.config.visionMaxOutputTokens, 16_384));
    const body = isMoondream
      ? {
        task: "query",
        image,
        question: prompt,
        // Moondream currently defaults stream=true. The REST client needs one
        // JSON envelope, so synchronous mode must be explicit.
        stream: false,
        reasoning: false,
        temperature: 0,
        max_tokens: requestedMaxTokens,
      }
      : {
        // Other Workers AI vision text models (for example Llama Vision) use
        // the standard messages + image shape instead of Moondream's task API.
        messages: [{ role: "user", content: prompt }],
        image,
        stream: false,
        temperature: 0,
        max_tokens: requestedMaxTokens,
      };
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/ai/run/${modelPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    const payload = await parseJson(response, "vision");
    if (!response.ok || payload?.success === false) {
      throw providerError(response.status, "vision", undefined, payload);
    }
    const result = payload?.result;
    const candidate = typeof result === "string"
      ? result
      : result?.answer ?? result?.response ?? result?.caption ?? result?.choices?.[0]?.message?.content;
    const text = typeof candidate === "string" ? candidate.trim() : "";
    if (!text) {
      throw new AIServiceError("AI_MEDIA_PROCESSING_FAILED", {
        publicMessage: "Cloudflare Workers AI could not read this image.",
        diagnosticMessage: "Cloudflare vision OCR returned no usable text.",
        retryable: true,
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
      throw providerError(response.status, "markdown", undefined, payload);
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