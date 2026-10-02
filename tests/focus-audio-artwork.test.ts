import assert from "node:assert/strict";
import test from "node:test";
import { readId3Artwork } from "../src/features/focus-audio/id3Artwork";
import { makeAudioFile, makeAudioFileWithArtwork } from "./helpers/focus-audio";

test("reads a safe embedded JPEG cover image from a local ID3v2 MP3", async () => {
  const artwork = await readId3Artwork(makeAudioFileWithArtwork());

  assert.ok(artwork);
  assert.equal(artwork.type, "image/jpeg");
  assert.deepEqual(
    new Uint8Array(await artwork.arrayBuffer()),
    Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9),
  );
});

test("ignores files without ID3 art and malformed tags", async () => {
  assert.equal(await readId3Artwork(makeAudioFile()), null);

  const malformed = new File([
    new TextEncoder().encode("ID3"),
    new Uint8Array([3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]),
  ], "malformed.mp3", { type: "audio/mpeg" });
  assert.equal(await readId3Artwork(malformed), null);
});