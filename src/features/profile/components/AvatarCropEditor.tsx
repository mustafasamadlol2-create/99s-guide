import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Move, Plus, X } from "lucide-react";
import { motion } from "motion/react";

interface AvatarCropEditorProps {
  imageSrc: string;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_SIZE = 400;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function AvatarCropEditor({
  imageSrc,
  onCancel,
  onApply,
}: AvatarCropEditorProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);

  const [previewSize, setPreviewSize] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      sourceImageRef.current = image;
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = imageSrc;
    return () => {
      sourceImageRef.current = null;
    };
  }, [imageSrc]);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;

    const updateSize = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setPreviewSize(next);
    };

    updateSize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSize) : null;
    observer?.observe(node);
    window.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  const baseScale = useMemo(() => {
    if (!previewSize || !naturalSize.width || !naturalSize.height) return 1;
    return Math.max(previewSize / naturalSize.width, previewSize / naturalSize.height);
  }, [naturalSize.height, naturalSize.width, previewSize]);

  const renderedSize = useMemo(
    () => ({
      width: naturalSize.width * baseScale * zoom,
      height: naturalSize.height * baseScale * zoom,
    }),
    [baseScale, naturalSize.height, naturalSize.width, zoom],
  );

  const clampOffset = useCallback(
    (next: { x: number; y: number }) => {
      if (!previewSize) return next;
      const maxX = Math.max(0, (renderedSize.width - previewSize) / 2);
      const maxY = Math.max(0, (renderedSize.height - previewSize) / 2);
      return {
        x: clamp(next.x, -maxX, maxX),
        y: clamp(next.y, -maxY, maxY),
      };
    },
    [previewSize, renderedSize.height, renderedSize.width],
  );

  useEffect(() => {
    setOffset((current) => clampOffset(current));
  }, [clampOffset]);

  const updateZoom = useCallback((nextZoom: number) => {
    setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const pointerDistance = () => {
    const points = Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>;
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    } else if (pointersRef.current.size === 2) {
      pinchStartRef.current = { distance: pointerDistance(), zoom };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2 && pinchStartRef.current) {
      const currentDistance = pointerDistance();
      if (currentDistance > 0 && pinchStartRef.current.distance > 0) {
        updateZoom(pinchStartRef.current.zoom * (currentDistance / pinchStartRef.current.distance));
      }
      return;
    }

    if (pointersRef.current.size === 1) {
      const start = dragStartRef.current;
      setOffset(
        clampOffset({
          x: start.offsetX + event.clientX - start.x,
          y: start.offsetY + event.clientY - start.y,
        }),
      );
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    pinchStartRef.current = null;

    const remaining = (Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>)[0];
    if (remaining) {
      dragStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    }
  };

  const handleApply = async () => {
    const image = sourceImageRef.current;
    if (!image || !previewSize || isApplying) return;

    setIsApplying(true);
    try {
      const scale = baseScale * zoom;
      const renderedWidth = naturalSize.width * scale;
      const renderedHeight = naturalSize.height * scale;
      const imageLeft = previewSize / 2 + offset.x - renderedWidth / 2;
      const imageTop = previewSize / 2 + offset.y - renderedHeight / 2;

      const sourceSize = Math.min(previewSize / scale, naturalSize.width, naturalSize.height);
      const sourceX = clamp(-imageLeft / scale, 0, Math.max(0, naturalSize.width - sourceSize));
      const sourceY = clamp(-imageTop / scale, 0, Math.max(0, naturalSize.height - sourceSize));

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas unavailable");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE,
      );

      const cropped = canvas.toDataURL("image/jpeg", 0.88);
      if (!cropped.startsWith("data:image/jpeg;base64,")) {
        throw new Error("Failed to crop image");
      }
      onApply(cropped);
    } finally {
      setIsApplying(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Adjust profile photo"
    >
      <motion.div
        initial={{ y: 24, opacity: 0, scale: 0.985 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 18, opacity: 0, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.9 }}
        className="w-full rounded-t-[28px] border border-black/[0.06] bg-white px-5 pb-[calc(18px+env(safe-area-inset-bottom))] pt-4 shadow-2xl dark:border-white/[0.08] dark:bg-[#161619] sm:max-w-[500px] sm:rounded-[28px] sm:p-6 lg:max-w-[560px] lg:p-7"
      >
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 active:scale-95 dark:bg-white/[0.08] dark:text-neutral-300"
            aria-label="Cancel photo adjustment"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="text-center">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-950 dark:text-white">Adjust Photo</h2>
            <p className="mt-0.5 text-[12px] font-medium text-neutral-500 dark:text-[#EBEBF599]">Drag and zoom to frame your photo</p>
          </div>
          <button
            type="button"
            onClick={handleApply}
            disabled={!naturalSize.width || isApplying}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm active:scale-95 disabled:opacity-45"
            aria-label="Use adjusted photo"
          >
            <Check className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-auto w-full max-w-[320px] px-2 sm:max-w-[360px] lg:max-w-[400px]">
          <div
            ref={previewRef}
            className="relative aspect-square w-full cursor-grab overflow-hidden rounded-full bg-neutral-200 shadow-[0_16px_50px_rgba(0,0,0,0.16)] ring-1 ring-black/10 active:cursor-grabbing dark:bg-neutral-900 dark:ring-white/10"
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
          >
            {naturalSize.width > 0 && previewSize > 0 && (
              <img
                src={imageSrc}
                alt="Profile crop preview"
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: `${renderedSize.width}px`,
                  height: `${renderedSize.height}px`,
                  left: `calc(50% + ${offset.x}px)`,
                  top: `calc(50% + ${offset.y}px)`,
                  transform: "translate(-50%, -50%)",
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-0 rounded-full ring-[1.5px] ring-inset ring-white/75 dark:ring-white/55" />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateZoom(zoom - 0.2)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 active:scale-95 dark:bg-white/[0.08] dark:text-neutral-200"
              aria-label="Zoom out"
            >
              <Minus className="h-5 w-5" />
            </button>
            <input
              aria-label="Photo zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              onChange={(event) => updateZoom(Number(event.target.value))}
              className="h-2 w-full cursor-pointer accent-blue-500"
            />
            <button
              type="button"
              onClick={() => updateZoom(zoom + 0.2)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 active:scale-95 dark:bg-white/[0.08] dark:text-neutral-200"
              aria-label="Zoom in"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] font-medium text-neutral-500 dark:text-[#EBEBF599]">
            <Move className="h-3.5 w-3.5" />
            <span>Drag to reposition · Pinch or use slider to zoom</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleApply}
          disabled={!naturalSize.width || isApplying}
          className="mt-5 flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-500 px-4 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(0,122,255,0.24)] active:scale-[0.99] disabled:opacity-45"
        >
          {isApplying ? "Applying…" : "Use Photo"}
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
