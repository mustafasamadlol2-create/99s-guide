export class MockAudioElement extends EventTarget {
  src = "";
  currentSrc = "";
  currentTime = 0;
  duration = 120;
  volume = 1;
  loop = false;
  paused = true;
  preload = "metadata";
  loadCount = 0;
  playCount = 0;
  removeSourceCount = 0;
  supportedMimeTypes = new Set([
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
  ]);
  playImplementation: (() => Promise<void>) | null = null;

  canPlayType(mimeType: string): CanPlayTypeResult {
    return this.supportedMimeTypes.has(mimeType) ? "probably" : "";
  }

  load(): void {
    this.loadCount += 1;
  }

  play(): Promise<void> {
    this.playCount += 1;
    if (this.playImplementation) return this.playImplementation();
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }

  pause(): void {
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) this.dispatchEvent(new Event("pause"));
  }

  removeAttribute(name: string): void {
    if (name !== "src") return;
    this.removeSourceCount += 1;
    this.src = "";
    this.currentSrc = "";
  }

  setSource(url: string): void {
    this.src = url;
    this.currentSrc = url;
  }
}

export function makeAudioFile(
  name = "focus-track.mp3",
  type = "audio/mpeg",
  content = "local audio bytes",
): File {
  return new File([content], name, { type });
}

export function makeAudioFileWithArtwork(name = "focus-with-cover.mp3"): File {
  const cover = Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9);
  const apicText = new TextEncoder().encode("image/jpeg\0");
  const description = new TextEncoder().encode("cover");
  const apic = new Uint8Array(1 + apicText.length + 1 + description.length + 1 + cover.length);
  let offset = 0;
  apic[offset++] = 0; // Latin-1 text encoding.
  apic.set(apicText, offset);
  offset += apicText.length;
  apic[offset++] = 3; // Front cover.
  apic.set(description, offset);
  offset += description.length;
  apic[offset++] = 0;
  apic.set(cover, offset);

  const frame = new Uint8Array(10 + apic.length);
  frame.set(new TextEncoder().encode("APIC"), 0);
  frame[4] = (apic.length >>> 24) & 0xff;
  frame[5] = (apic.length >>> 16) & 0xff;
  frame[6] = (apic.length >>> 8) & 0xff;
  frame[7] = apic.length & 0xff;
  frame.set(apic, 10);

  const header = new Uint8Array(10);
  header.set(new TextEncoder().encode("ID3"), 0);
  header[3] = 3; // ID3v2.3.
  header[6] = (frame.length >>> 21) & 0x7f;
  header[7] = (frame.length >>> 14) & 0x7f;
  header[8] = (frame.length >>> 7) & 0x7f;
  header[9] = frame.length & 0x7f;
  return new File([header.buffer as ArrayBuffer, frame.buffer as ArrayBuffer], name, {
    type: "audio/mpeg",
  });
}

export class MockLifecycleSource {
  private listener: ((isActive: boolean) => void) | null = null;
  subscribeCount = 0;
  unsubscribeCount = 0;

  subscribe(listener: (isActive: boolean) => void): () => void {
    this.subscribeCount += 1;
    this.listener = listener;
    return () => {
      this.unsubscribeCount += 1;
      this.listener = null;
    };
  }

  emit(isActive: boolean): void {
    this.listener?.(isActive);
  }
}