import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, RotateCcw, X } from "lucide-react";
import { motion } from "motion/react";

interface AvatarCameraCaptureProps {
  onCancel: () => void;
  onCapture: (dataUrl: string) => void;
}

const CAPTURE_SIZE = 1200;

export default function AvatarCameraCapture({
  onCancel,
  onCapture,
}: AvatarCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const startCamera = async () => {
    setCameraError(null);
    setIsReady(false);

    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available on this device.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setIsReady(true);
    } catch (error) {
      console.error("[ProfilePhoto] Web camera failed", error);
      setCameraError(
        "Camera access could not be opened. Please allow camera permission and try again.",
      );
    }
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void startCamera();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || isCapturing) return;

    setIsCapturing(true);
    try {
      const sourceSize = Math.min(video.videoWidth, video.videoHeight);
      const sourceX = Math.max(0, (video.videoWidth - sourceSize) / 2);
      const sourceY = Math.max(0, (video.videoHeight - sourceSize) / 2);

      const canvas = document.createElement("canvas");
      canvas.width = CAPTURE_SIZE;
      canvas.height = CAPTURE_SIZE;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas unavailable");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.translate(CAPTURE_SIZE, 0);
      context.scale(-1, 1);
      context.drawImage(
        video,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        CAPTURE_SIZE,
        CAPTURE_SIZE,
      );

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
        throw new Error("Failed to capture photo");
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      onCapture(dataUrl);
    } catch (error) {
      console.error("[ProfilePhoto] Capture failed", error);
      setCameraError("The photo could not be captured. Please try again.");
      setIsCapturing(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Take profile photo"
    >
      <motion.div
        initial={{ y: 24, opacity: 0, scale: 0.985 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 18, opacity: 0, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.9 }}
        className="w-full rounded-t-[28px] border border-black/[0.06] bg-white px-5 pb-[calc(18px+env(safe-area-inset-bottom))] pt-4 shadow-2xl dark:border-white/[0.08] dark:bg-[#161619] sm:max-w-[460px] sm:rounded-[28px] sm:p-6 lg:max-w-[500px]"
      >
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 active:scale-95 dark:bg-white/[0.08] dark:text-neutral-300"
            aria-label="Cancel camera"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="text-center">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-950 dark:text-white">
              Take Photo
            </h2>
            <p className="mt-0.5 text-[12px] font-medium text-neutral-500 dark:text-[#EBEBF599]">
              Center your face inside the frame
            </p>
          </div>

          <button
            type="button"
            onClick={() => void startCamera()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 active:scale-95 dark:bg-white/[0.08] dark:text-neutral-300"
            aria-label="Restart camera"
          >
            <RotateCcw className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="mx-auto w-full max-w-[320px] sm:max-w-[360px] lg:max-w-[390px]">
          <div className="relative aspect-square w-full overflow-hidden rounded-full bg-neutral-950 shadow-[0_18px_55px_rgba(0,0,0,0.28)] ring-1 ring-white/10">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full scale-x-[-1] object-cover"
            />

            {!isReady && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-950 text-white">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-blue-500" />
              </div>
            )}

            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-950 px-8 text-center text-sm font-medium leading-relaxed text-neutral-200">
                {cameraError}
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 rounded-full ring-[2px] ring-inset ring-white/70" />
          </div>
        </div>

        <button
          type="button"
          onClick={capturePhoto}
          disabled={!isReady || Boolean(cameraError) || isCapturing}
          className="mx-auto mt-6 flex min-h-12 w-full max-w-[320px] items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(0,122,255,0.24)] active:scale-[0.99] disabled:opacity-45 sm:max-w-[360px] lg:max-w-[390px]"
        >
          <Camera className="h-5 w-5" />
          {isCapturing ? "Capturing…" : "Capture Photo"}
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
