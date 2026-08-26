import React, { memo, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fileToDataUrl } from "../../../core/utils/imageUtils";
import AvatarCropEditor from "./AvatarCropEditor";
import CapExternalOpener from "../../../core/device/capacitor/externalOpener";

interface InteractiveAvatarProps {
  avatarUrl: string;
  name: string;
  onAvatarChange: (base64: string) => void;
  isEditable?: boolean;
}

export default memo(function InteractiveAvatar({
  avatarUrl,
  name,
  onAvatarChange,
  isEditable = true,
}: InteractiveAvatarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pendingCropSource, setPendingCropSource] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const triggerUploadClick = async () => {
    if (!isEditable || isReadingImage) return;

    // Native iOS uses a small native UIImagePickerController bridge instead of
    // the WKWebView <input type="file"> picker. This intentionally removes the
    // extra Apple/WebKit preview-confirmation screen seen on iPhone and avoids
    // the blank preview panel seen on iPad. The next app-owned screen is the
    // existing Adjust Photo crop/zoom editor.
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      setImageError(null);
      setIsReadingImage(true);
      try {
        const result = await CapExternalOpener.pickProfilePhoto();
        if (result.cancelled) return;

        const source = result.dataUrl;
        if (!source || !source.startsWith("data:image/")) {
          throw new Error("Invalid native photo result");
        }
        setPendingCropSource(source);
      } catch (error) {
        console.error("[ProfilePhoto] Native photo picker failed", error);
        setImageError("Failed to open the photo library. Please try again.");
      } finally {
        setIsReadingImage(false);
      }
      return;
    }

    // PWA / desktop / non-iOS native fallback.
    fileInputRef.current?.click();
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

      <div className="relative group select-none">
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
          onClick={() => void triggerUploadClick()}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
          className={`relative z-10 flex h-[96px] w-[96px] cursor-pointer select-none items-center justify-center overflow-hidden rounded-full border-[3px] ${
            hasCustomAvatar ? "bg-transparent" : "bg-[#22C55E]"
          } ${
            isDragging
              ? "border-[#007AFF] dark:border-[#0BE5FF]"
              : "border-white shadow-elevation-1 dark:border-[#1E1E24]"
          } transition-colors duration-200`}
          style={{ transform: "translateZ(0)", WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}
          aria-label={hasCustomAvatar ? "Change profile photo" : "Add profile photo"}
        >
          {hasCustomAvatar ? (
            <motion.img
              key={avatarUrl}
              src={avatarUrl}
              alt={name}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18 }}
              referrerPolicy="no-referrer"
              className="pointer-events-none h-full w-full select-none rounded-full object-cover"
            />
          ) : (
            <motion.svg
              key="letter"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
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
            </motion.svg>
          )}

          {isEditable && (
            <AnimatePresence>
              {(isHovered || isDragging) && !isReadingImage && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/35 text-white backdrop-blur-[3px] dark:bg-black/45"
                >
                  <motion.div
                    initial={{ y: 8, scale: 0.9 }}
                    animate={{ y: 0, scale: 1 }}
                    exit={{ y: -8, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                    className="flex flex-col items-center gap-1"
                  >
                    <Camera className="h-icon-md w-icon-md text-white/95" />
                    <span className="text-caption font-semibold uppercase text-white/90">
                      {isDragging ? "Drop Image" : "Edit"}
                    </span>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          <AnimatePresence>
            {isReadingImage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/80 text-white backdrop-blur-[4px] dark:bg-black/85"
              >
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-[#007AFF] dark:border-t-[#0BE5FF]" />
                <span className="text-caption mt-2 select-none font-semibold uppercase text-neutral-300">Preparing…</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      <AnimatePresence>
        {imageError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="text-caption mt-2 flex max-w-xs items-center gap-1 rounded-lg border border-rose-500/10 bg-rose-500/5 px-3 py-1 text-center font-mono text-rose-500"
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
    </div>
  );
});
