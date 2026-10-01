import { useRef, useState } from "react";

type AudioState = "IDLE" | "PLAYING" | "PAUSED" | "INTERRUPTED" | "ERROR";
type AudioSnapshot = {
  state: AudioState;
  sourceType: "NONE" | "USER_FILE";
  userAudioDisplayName: string | null;
  volume: number;
  loop: boolean;
};

export function useFocusAudio() {
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [audio, setAudio] = useState<AudioSnapshot>({
    state: "IDLE",
    sourceType: "NONE",
    userAudioDisplayName: null,
    volume: 0.5,
    loop: false,
  });

  const pickUserAudio = () =>
    new Promise<{ ok: boolean }>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ ok: false });
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = URL.createObjectURL(file);
        const player = new Audio(objectUrlRef.current);
        player.volume = audio.volume;
        player.loop = audio.loop;
        player.onended = () => setAudio((previous) => ({ ...previous, state: "IDLE" }));
        player.onerror = () => setAudio((previous) => ({ ...previous, state: "ERROR" }));
        playerRef.current = player;
        setAudio((previous) => ({
          ...previous,
          state: "IDLE",
          sourceType: "USER_FILE",
          userAudioDisplayName: file.name,
        }));
        resolve({ ok: true });
      };
      input.oncancel = () => resolve({ ok: false });
      input.click();
    });

  const play = async () => {
    if (!playerRef.current) return { ok: false };
    try {
      await playerRef.current.play();
      setAudio((previous) => ({ ...previous, state: "PLAYING" }));
      return { ok: true };
    } catch {
      setAudio((previous) => ({ ...previous, state: "ERROR" }));
      return { ok: false };
    }
  };

  const pause = () => {
    playerRef.current?.pause();
    setAudio((previous) => ({ ...previous, state: "PAUSED" }));
  };

  const resume = () => play();
  const setVolume = (volume: number) => {
    if (playerRef.current) playerRef.current.volume = volume;
    setAudio((previous) => ({ ...previous, volume }));
  };
  const setLoop = (loop: boolean) => {
    if (playerRef.current) playerRef.current.loop = loop;
    setAudio((previous) => ({ ...previous, loop }));
  };

  return { audio, pickUserAudio, play, pause, resume, setVolume, setLoop };
}