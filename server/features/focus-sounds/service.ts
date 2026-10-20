import type { PrismaClient } from "@prisma/client";
import {
  buildFocusSoundStoragePath,
  createFocusSoundPlaybackUrl,
  deleteFocusSoundObject,
  uploadFocusSoundObject,
  validateFocusSoundUpload,
  type FocusSoundUploadInput,
} from "./storage.js";

export type FocusSoundDto = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  isEnabled: boolean;
  playbackUrl: string;
  createdAt: string;
  updatedAt: string;
};

function safeName(value: unknown): string {
  if (typeof value !== "string") throw new Error("FOCUS_SOUND_INVALID_NAME");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 80) throw new Error("FOCUS_SOUND_INVALID_NAME");
  if ([...normalized].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  })) throw new Error("FOCUS_SOUND_INVALID_NAME");
  return normalized;
}

function safeOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000) {
    throw new Error("FOCUS_SOUND_INVALID_ORDER");
  }
  return Number(value);
}

async function toDto(row: {
  id: string;
  name: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: bigint;
  sortOrder: number;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Promise<FocusSoundDto> {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    sortOrder: row.sortOrder,
    isEnabled: row.isEnabled,
    playbackUrl: await createFocusSoundPlaybackUrl(row.storagePath, row.mimeType),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class FocusSoundService {
  constructor(private readonly database: PrismaClient) {}

  async listEnabled(): Promise<FocusSoundDto[]> {
    const rows = await this.database.focusSound.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return Promise.all(rows.map(toDto));
  }

  async listAll(): Promise<FocusSoundDto[]> {
    const rows = await this.database.focusSound.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return Promise.all(rows.map(toDto));
  }

  async create(input: {
    createdById: string;
    name: unknown;
    file: FocusSoundUploadInput;
  }): Promise<FocusSoundDto> {
    const name = safeName(input.name);
    const validated = validateFocusSoundUpload(input.file);
    const storagePath = buildFocusSoundStoragePath(validated.extension);
    const highest = await this.database.focusSound.findFirst({
      orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
      select: { sortOrder: true },
    });
    const sortOrder = Math.min(100_000, (highest?.sortOrder ?? -10) + 10);
    await uploadFocusSoundObject({
      storagePath,
      buffer: input.file.buffer,
      mimeType: validated.mimeType,
    });
    try {
      const row = await this.database.focusSound.create({
        data: {
          name,
          storagePath,
          mimeType: validated.mimeType,
          sizeBytes: BigInt(input.file.size),
          sortOrder,
          isEnabled: true,
          createdById: input.createdById,
        },
      });
      return toDto(row);
    } catch (error) {
      await deleteFocusSoundObject(storagePath).catch(() => {});
      throw error;
    }
  }

  async update(id: string, input: { name?: unknown; isEnabled?: unknown; sortOrder?: unknown }): Promise<FocusSoundDto> {
    const data: { name?: string; isEnabled?: boolean; sortOrder?: number } = {};
    if (input.name !== undefined) data.name = safeName(input.name);
    if (input.isEnabled !== undefined) {
      if (typeof input.isEnabled !== "boolean") throw new Error("FOCUS_SOUND_INVALID_ENABLED");
      data.isEnabled = input.isEnabled;
    }
    if (input.sortOrder !== undefined) data.sortOrder = safeOrder(input.sortOrder);
    if (Object.keys(data).length === 0) throw new Error("FOCUS_SOUND_EMPTY_UPDATE");
    const row = await this.database.focusSound.update({ where: { id }, data });
    return toDto(row);
  }

  async reorder(ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
      throw new Error("FOCUS_SOUND_INVALID_REORDER");
    }
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length || ids.some((id) => typeof id !== "string" || id.length > 128 || id.length < 1)) {
      throw new Error("FOCUS_SOUND_INVALID_REORDER");
    }
    const existing = await this.database.focusSound.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((row) => row.id));
    if (existingIds.size !== ids.length || ids.some((id) => !existingIds.has(id))) {
      throw new Error("FOCUS_SOUND_INVALID_REORDER");
    }
    await this.database.$transaction(
      ids.map((id, index) => this.database.focusSound.update({
        where: { id },
        data: { sortOrder: index * 10 },
      })),
    );
  }

  async remove(id: string): Promise<void> {
    const row = await this.database.focusSound.delete({ where: { id } });
    await deleteFocusSoundObject(row.storagePath).catch((error) => {
      console.warn("[FocusSounds] R2 cleanup failed after canonical delete", {
        id,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}
