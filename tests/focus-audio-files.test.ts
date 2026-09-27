import assert from "node:assert/strict";
import test from "node:test";
import { MAX_LOCAL_AUDIO_FILE_BYTES } from "../src/features/focus-audio/constants";
import {
  pickLocalAudioFile,
  validateLocalAudioFile,
} from "../src/features/focus-audio/localFile";
import { makeAudioFile } from "./helpers/focus-audio";

test("accepts supported local formats and returns only a safe basename", () => {
  const mp3 = makeAudioFile("C:\\private\\music\\focus.mp3");
  const result = validateLocalAudioFile(mp3);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mimeType, "audio/mpeg");
    assert.equal(result.displayName, "focus.mp3");
  }

  const m4a = validateLocalAudioFile(makeAudioFile("track.m4a", "audio/mp4"));
  assert.equal(m4a.ok, true);
});

test("rejects empty, oversized, mismatched, and non-audio files", () => {
  assert.deepEqual(
    validateLocalAudioFile(makeAudioFile("empty.mp3", "audio/mpeg", "")),
    { ok: false, errorCode: "UNSUPPORTED_AUDIO" },
  );
  assert.deepEqual(
    validateLocalAudioFile(makeAudioFile("document.pdf", "application/pdf")),
    { ok: false, errorCode: "UNSUPPORTED_AUDIO" },
  );
  assert.deepEqual(
    validateLocalAudioFile(makeAudioFile("renamed.mp3", "application/pdf")),
    { ok: false, errorCode: "UNSUPPORTED_AUDIO" },
  );

  const oversized = {
    name: "too-large.mp3",
    type: "audio/mpeg",
    size: MAX_LOCAL_AUDIO_FILE_BYTES + 1,
    slice: () => new Blob(),
  } as unknown as File;
  assert.deepEqual(validateLocalAudioFile(oversized), {
    ok: false,
    errorCode: "UNSUPPORTED_AUDIO",
  });
});

test("accepts a generic picker MIME only with a supported extension and defers decode validation to media", () => {
  const genericMime = validateLocalAudioFile(makeAudioFile("local.wav", "application/octet-stream"));
  assert.equal(genericMime.ok, true);
  if (genericMime.ok) assert.equal(genericMime.mimeType, "audio/wav");

  assert.deepEqual(
    validateLocalAudioFile(makeAudioFile("unknown.bin", "application/octet-stream")),
    { ok: false, errorCode: "UNSUPPORTED_AUDIO" },
  );
});

test("picker requests one explicit audio/* selection and returns null when cancelled", async () => {
  class FakeInput extends EventTarget {
    type = "";
    accept = "";
    multiple = true;
    tabIndex = 0;
    style = {} as CSSStyleDeclaration;
    files: FileList | null = null;
    removed = false;
    setAttribute(): void {}
    remove(): void {
      this.removed = true;
    }
    click(): void {}
  }

  const input = new FakeInput();
  const documentTarget = {
    body: { append: () => undefined },
    createElement: () => input,
  } as unknown as Document;
  const windowListeners = new Map<string, EventListener>();
  const windowTarget = {
    addEventListener: (type: string, listener: EventListener) => windowListeners.set(type, listener),
    removeEventListener: (type: string) => windowListeners.delete(type),
  } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;

  const selection = pickLocalAudioFile({ documentTarget, windowTarget });
  assert.equal(input.accept, "audio/*");
  assert.equal(input.multiple, false);
  input.dispatchEvent(new Event("cancel"));
  assert.equal(await selection, null);
  assert.equal(input.removed, true);
});