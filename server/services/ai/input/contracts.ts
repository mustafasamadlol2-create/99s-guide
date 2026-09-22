export type AIInputOrigin = "upload" | "pasted_text" | "existing_resource";
export type AIBinaryOwnership = "owned_transient" | "borrowed";

export type AIFileSource =
  | {
    kind: "staged_file";
    capability: AIStagedFileCapability;
    ownership: "owned_transient";
  }
  | {
    kind: "existing_resource";
    resourceId: string;
    ownership: "borrowed";
  };

export interface AIStagedFileCapability {
  readonly sizeBytes: number;
  readBytes(): Promise<Uint8Array>;
  withPath<T>(operation: (path: string) => Promise<T>): Promise<T>;
}

interface AISourceMetadata {
  section?: string;
  label?: string;
}

export interface AITextSourceReference extends AISourceMetadata {
  inputType: "text";
}

export interface AIPdfSourceReference extends AISourceMetadata {
  inputType: "pdf";
  page?: number;
}

export interface AIImageSourceReference {
  inputType: "image";
  imageIndex: number;
  label?: string;
}

export interface AITextPart {
  kind: "text";
  text: string;
  source: AITextSourceReference;
  sizeBytes: number;
  sha256: string;
}

interface AIFilePartBase {
  kind: "file";
  fileSource: AIFileSource;
  sizeBytes: number;
  sha256: string;
}

export interface AIPdfFilePart extends AIFilePartBase {
  inputType: "pdf";
  mimeType: "application/pdf";
  source: AIPdfSourceReference;
  pageCount?: number;
}

export interface AIImageFilePart extends AIFilePartBase {
  inputType: "image";
  mimeType: Exclude<SupportedAIBinaryMimeType, "application/pdf">;
  source: AIImageSourceReference;
}

export type AIFilePart = AIPdfFilePart | AIImageFilePart;
export type AIContentPart = AITextPart | AIPdfFilePart | AIImageFilePart;

export type SupportedAIBinaryMimeType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface RawAIBinaryInput {
  bytes?: Uint8Array;
  adoptedFile?: AIAdoptedBinaryFile;
  claimedMimeType: string;
  originalFilename?: string;
  sourceLabel?: string;
}

export interface AIAdoptedBinaryFile {
  readonly sizeBytes: number;
  readonly capability: AIStagedFileCapability;
  dispose(): Promise<void>;
}

export type RawAIInput =
  | { kind: "pdf"; file: RawAIBinaryInput }
  | { kind: "image"; files: RawAIBinaryInput[] }
  | { kind: "text"; text: string; sourceLabel?: string };

interface NormalizedBinaryMetadata<TSource> {
  displayName: string;
  mimeType: SupportedAIBinaryMimeType;
  sizeBytes: number;
  sha256: string;
  source: TSource;
}

type NormalizedBinaryLocation =
  | {
    origin: "upload";
    ownership: "owned_transient";
    fileSource: Extract<AIFileSource, { kind: "staged_file" }>;
  }
  | {
    origin: "existing_resource";
    ownership: "borrowed";
    fileSource: Extract<AIFileSource, { kind: "existing_resource" }>;
  };

export type NormalizedPDFInput =
  NormalizedBinaryMetadata<AIPdfSourceReference> &
  NormalizedBinaryLocation & {
    kind: "pdf";
    mimeType: "application/pdf";
    pageCount?: number;
  };

export interface AIVisualPDFPage {
  kind: "visual_page";
  inputType: "pdf";
  page: number;
  mimeType: "image/png";
  bytes: Uint8Array;
  sizeBytes: number;
  sha256: string;
  source: AIPdfSourceReference;
}

export interface AIPDFVisualSource {
  pageCount?: number;
  renderPages(options?: {
    startPage?: number;
    endPage?: number;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<AIVisualPDFPage[]>;
}

export type NormalizedImageInput =
  NormalizedBinaryMetadata<AIImageSourceReference> &
  NormalizedBinaryLocation & {
    kind: "image";
    mimeType: Exclude<SupportedAIBinaryMimeType, "application/pdf">;
    imageIndex: number;
  };

export interface NormalizedTextInput {
  kind: "text";
  origin: "pasted_text";
  text: string;
  mimeType: "text/plain";
  sizeBytes: number;
  sha256: string;
  source: AITextSourceReference;
}

export type NormalizedAIInput =
  | { kind: "pdf"; pdf: NormalizedPDFInput }
  | { kind: "image"; images: NormalizedImageInput[] }
  | { kind: "text"; text: NormalizedTextInput };

export interface PreparedAIInput {
  input: NormalizedAIInput;
  contents: AIContentPart[];
  dispose(): Promise<void>;
}