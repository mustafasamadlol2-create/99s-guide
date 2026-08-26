import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Camera, Eye, ImagePlus, Pencil, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fileToDataUrl } from "../../../core/utils/imageUtils";
import AvatarCropEditor from "./AvatarCropEditor";
import AvatarCameraCapture from "./AvatarCameraCapture";
import CapExternalOpener from "../../../core/device/capacitor/externalOpener";

interface InteractiveAvatarProps {
  avatarUrl: string;
  name: string;
  onAvatarChange: (base64: string) => void;
  onAvatarRemove?: () => void;
  isEditable?: boolean;
}

export default memo(function InteractiveAvatar({
  avatarUrl,
  name,
  onAvatarChange,
  onAvatarRemove,
  isEditable = true,
}: InteractiveAvatarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pendingCropSource, setPendingCropSource] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showPhotoActions, setShowPhotoActions] = useState(false);
  const [showWebCamera, setShowWebCamera] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showPreview && !showPhotoActions) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showPhotoActions, showPreview]);

  const openCropEditorForFile = async (file: File) => {
    if (file.size > 4.5 * 1024 * 1024) {
      setImageError("File size exceeds 4MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setImageError("Please select a valid image file.");
      return;
    }

    setImageError(null);
    setIsReadingImage(true);
    try {
      const source = await fileToDataUrl(file);
      if (!source || !source.startsWith("data:image/")) {
        throw new Error("Invalid image data");
      }
      setPendingCropSource(source);
    } catch {
      setImageError("Failed to read file. Please try again.");
    } finally {
      setIsReadingImage(false);
    }
  };

  const onDragOver = (event: React.DragEvent) => {
    if (!isEditable) return;
    event.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (event: React.DragEvent) => {
    if (!isEditable) return;
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void openCropEditorForFile(file);
  };

  const setNativePhotoResult = (result: { cancelled: boolean; dataUrl?: string }) => {
    if (result.cancelled) return;
    const source = result.dataUrl;
    if (!source || !source.startsWith("data:image/")) {
      throw new Error("Invalid native photo result");
    }
    setPendingCropSource(source);
  };

  const choosePhoto = async () => {
    if (!isEditable || isReadingImage) return;
    setShowPhotoActions(false);

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      setImageError(null);
      setIsReadingImage(true);
      try {
        const result = await CapExternalOpener.pickProfilePhoto();
        setNativePhotoResult(result);
      } catch (error) {
        console.error("[ProfilePhoto] Native photo picker failed", error);
        setImageError("Failed to open the photo library. Please try again.");
      } finally {
        setIsReadingImage(false);
      }
      return;
    }

    fileInputRef.current?.click();
  };

  const takePhoto = async () => {
    if (!isEditable || isReadingImage) return;
    setShowPhotoActions(false);

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      setImageError(null);
      setIsReadingImage(true);
      try {
        const result = await CapExternalOpener.takeProfilePhoto();
        setNativePhotoResult(result);
        return;
      } catch (error) {
        console.error("[ProfilePhoto] Native camera failed", error);
        if (navigator.mediaDevices?.getUserMedia) {
          setShowWebCamera(true);
          return;
        }
        setImageError("Failed to open the camera. Please try again.");
      } finally {
        setIsReadingImage(false);
      }
      return;
    }

    if (navigator.mediaDevices?.getUserMedia) {
      setShowWebCamera(true);
      return;
    }

    cameraFallbackInputRef.current?.click();
  };

  const initials = useMemo(() => {
    if (!name) return "?";
    const match = name.match(/[\p{L}]/u);
    if (match) return match[0].toUpperCase();
    return name.trim().charAt(0).toUpperCase() || "?";
  }, [name]);

  const hasCustomAvatar = Boolean(
    avatarUrl &&
      avatarUrl.trim() !== "" &&
      !avatarUrl.includes("unsplash.com") &&
      !avatarUrl.includes("/icon.svg") &&
      !avatarUrl.includes("mock"),
  );

  const removePhoto = () => {
    setShowPhotoActions(false);
    setShowPreview(false);
    setImageError(null);
    onAvatarRemove?.();
  };

  const avatarVisual = (preview = false) =>
    hasCustomAvatar ? (
      <img
        src={avatarUrl}
        alt={name}
        referrerPolicy="no-referrer"
        draggable={false}
        className={`pointer-events-none h-full w-full select-none rounded-full object-cover ${
          preview ? "shadow-[0_28px_80px_rgba(0,0,0,0.35)]" : ""
        }`}
      />
    ) : (
      <svg
        className="h-full w-full rounded-full bg-[#22C55E]"
        viewBox="0 0 100 100"
        aria-label={`Avatar for ${name}`}
      >
        <text
          x="50%"
          y="50%"
          fill="#FFFFFF"
          className="pointer-events-none font-sans"
          fontSize="44"
          fontWeight="bold"
          textAnchor="middle"
          dy=".35em"
        >
          {initials}
        </text>
      </svg>
    );

  const canUsePortal = typeof document !== "undefined";

  return (
    <div className="relative flex flex-col items-center">
      <input
        aria-label="Choose profile photo"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openCropEditorForFile(file);
        }}
        className="hidden"
      />
      <input
        aria-label="Take profile photo"
        ref={cameraFallbackInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openCropEditorForFile(file);
        }}
        className="hidden"
      />

      <div className="group relative select-none">
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1.08 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute -inset-2.5 z-0 rounded-full border-2 border-dashed border-[#007AFF] bg-[#007AFF]/5 blur-[2px] dark:bg-[#0BE5FF]/5"
              transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
            />
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={() => setShowPreview(true)}
          whileHover={{ scale: 1.025 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
          className={`relative z-10 flex h-[96px] w-[96px] cursor-zoom-in select-none items-center justify-center overflow-hidden rounded-full border-[3px] sm:h-[108px] sm:w-[108px] lg:h-[116px] lg:w-[116px] ${
            hasCustomAvatar ? "bg-transparent" : "bg-[#22C55E]"
          } ${
            isDragging
              ? "border-[#007AFF] dark:border-[#0BE5FF]"
              : "border-white shadow-elevation-1 dark:border-[#1E1E24]"
          } transition-colors duration-200`}
          style={{ transform: "translateZ(0)", WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}
          aria-label="Preview profile photo"
        >
          {avatarVisual()}

          <AnimatePresence>
            {(isHovered || isDragging) && !isReadingImage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/30 text-white backdrop-blur-[2px] dark:bg-black/40"
              >
                <Eye className="h-5 w-5 text-white/95 sm:h-6 sm:w-6" />
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/90 sm:text-[11px]">
                  {isDragging ? "Drop Image" : "Preview"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isReadingImage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/80 text-white backdrop-blur-[4px] dark:bg-black/85"
              >
                <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/20 border-t-[#007AFF] dark:border-t-[#0BE5FF] sm:h-8 sm:w-8" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {isEditable && (
          <motion.button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!isReadingImage) setShowPhotoActions(true);
            }}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.8 }}
            className="absolute -bottom-0.5 -right-0.5 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#007AFF] text-white shadow-[0_7px_18px_rgba(0,122,255,0.35)] dark:border-[#11131A] dark:bg-[#0A84FF] sm:h-9 sm:w-9 lg:-bottom-1 lg:-right-1"
            aria-label="Edit profile photo"
          >
            <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.3} />
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {imageError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mt-3 flex max-w-xs items-center gap-1 rounded-lg border border-rose-500/10 bg-rose-500/5 px-3 py-1.5 text-center text-[12px] font-medium text-rose-500"
          >
            <span>⚠️ {imageError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingCropSource && (
          <AvatarCropEditor
            imageSrc={pendingCropSource}
            onCancel={() => setPendingCropSource(null)}
            onApply={(cropped) => {
              setPendingCropSource(null);
              onAvatarChange(cropped);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showWebCamera && (
          <AvatarCameraCapture
            onCancel={() => setShowWebCamera(false)}
            onCapture={(source) => {
              setShowWebCamera(false);
              setPendingCropSource(source);
            }}
          />
        )}
      </AnimatePresence>

      {canUsePortal && showPreview &&
        createPortal(
          <motion.div
            className="fixed inset-0 z-[240] flex items-center justify-center bg-black/78 px-5 py-[calc(24px+env(safe-area-inset-top))] backdrop-blur-lg sm:px-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPreview(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Profile photo preview"
          >
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="absolute right-5 top-[calc(18px+env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur-xl active:scale-95 sm:right-8 sm:h-11 sm:w-11"
              aria-label="Close profile photo preview"
            >
              <X className="h-5 w-5 sm:h-5.5 sm:w-5.5" />
            </button>

            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: "spring", stiffness: 440, damping: 35, mass: 0.9 }}
              onClick={(event) => event.stopPropagation()}
              className="aspect-square w-[78vw] max-w-[310px] overflow-hidden rounded-full ring-1 ring-white/20 sm:max-w-[390px] lg:max-w-[440px]"
            >
              {avatarVisual(true)}
            </motion.div>
          </motion.div>,
          document.body,
        )}

      {canUsePortal && showPhotoActions &&
        createPortal(
          <motion.div
            className="fixed inset-0 z-[245] flex items-end justify-center bg-black/45 px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-10 backdrop-blur-sm sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPhotoActions(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Edit profile photo"
          >
            <motion.div
              initial={{ y: 26, opacity: 0, scale: 0.99 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 18, opacity: 0, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 430, damping: 36, mass: 0.9 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-[430px] overflow-hidden rounded-[24px] border border-black/[0.06] bg-white/96 shadow-2xl backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1B1B1F]/96 sm:max-w-[360px] sm:rounded-[26px] lg:max-w-[380px]"
            >
              <div className="px-5 pb-3 pt-4 text-center">
                <h2 className="text-[16px] font-semibold text-neutral-950 dark:text-white">Profile Photo</h2>
                <p className="mt-0.5 text-[12px] font-medium text-neutral-500 dark:text-[#EBEBF599]">
                  Choose how you want to update it
                </p>
              </div>

              <div className="border-t border-black/[0.06] dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => void choosePhoto()}
                  className="flex min-h-[54px] w-full items-center gap-3 border-b border-black/[0.06] px-5 text-left text-[15px] font-medium text-neutral-900 active:bg-neutral-100 dark:border-white/[0.08] dark:text-white dark:active:bg-white/[0.06]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 dark:bg-blue-400/10 dark:text-blue-400">
                    <ImagePlus className="h-4.5 w-4.5" />
                  </span>
                  Choose Photo
                </button>

                <button
                  type="button"
                  onClick={() => void takePhoto()}
                  className={`flex min-h-[54px] w-full items-center gap-3 px-5 text-left text-[15px] font-medium text-neutral-900 active:bg-neutral-100 dark:text-white dark:active:bg-white/[0.06] ${
                    hasCustomAvatar ? "border-b border-black/[0.06] dark:border-white/[0.08]" : ""
                  }`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400">
                    <Camera className="h-4.5 w-4.5" />
                  </span>
                  Take Photo
                </button>

                {hasCustomAvatar && (
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="flex min-h-[54px] w-full items-center gap-3 px-5 text-left text-[15px] font-medium text-red-500 active:bg-red-500/[0.06] dark:text-red-400 dark:active:bg-red-400/[0.06]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 text-red-500 dark:bg-red-400/10 dark:text-red-400">
                      <Trash2 className="h-4.5 w-4.5" />
                    </span>
                    Remove Photo
                  </button>
                )}
              </div>

              <div className="border-t border-black/[0.06] p-2 dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowPhotoActions(false)}
                  className="min-h-[48px] w-full rounded-[16px] text-[15px] font-semibold text-blue-500 active:bg-blue-500/[0.06] dark:text-blue-400"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>,
          document.body,
        )}
    </div>
  );
});
