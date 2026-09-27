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