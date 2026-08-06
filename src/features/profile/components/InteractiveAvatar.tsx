import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
 Camera,
 Check,
 UploadCloud,
 RefreshCw,
 Sparkles,
 User,
 Smile,
 Eye,
} from "lucide-react";

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
 const [isUploading, setIsUploading] = useState(false);
 const [uploadProgress, setUploadProgress] = useState(0);
 const [imageError, setImageError] = useState<string | null>(null);

 const fileInputRef = useRef<HTMLInputElement>(null);

 const handleFileChange = (file: File) => {
 if (file.size > 4.5 * 1024 * 1024) {
 setImageError("File size exceeds 4MB");
 return;
 }
 setImageError(null);
 setIsUploading(true);
 setUploadProgress(0);

 // Simulate premium Apple-like fluid circular upload/processing progress
 let currentProgress = 0;
 const interval = setInterval(() => {
 currentProgress += Math.random() * 15 + 5;
 if (currentProgress >= 100) {
 setUploadProgress(100);
 clearInterval(interval);

 const reader = new FileReader();
 reader.onload = () => {
 const base64 = reader.result as string;
 onAvatarChange(base64);
 // Small delay before completing upload state for a elegant snap feel
 setTimeout(() => {
 setIsUploading(false);
 }, 300);
 };
 reader.readAsDataURL(file);
 } else {
 setUploadProgress(Math.min(currentProgress, 99));
 }
 }, 80);
 };

 const onDragOver = (e: React.DragEvent) => {
 if (!isEditable) return;
 e.preventDefault();
 setIsDragging(true);
 };

 const onDragLeave = () => {
 setIsDragging(false);
 };

 const onDrop = (e: React.DragEvent) => {
 if (!isEditable) return;
 e.preventDefault();
 setIsDragging(false);
 const file = e.dataTransfer.files?.[0];
 if (file && file.type.startsWith("image/")) {
 handleFileChange(file);
 }
 };

 const triggerUploadClick = () => {
 if (!isEditable || isUploading) return;
 fileInputRef.current?.click();
 };

  const initials = useMemo(() => {
    if (!name) return "?";
    const match = name.match(/[\p{L}]/u);
    if (match) return match[0].toUpperCase();
    return name.trim().charAt(0).toUpperCase() || "?";
  }, [name]);

 const hasCustomAvatar = avatarUrl && avatarUrl.trim() !== "" && !avatarUrl.includes("unsplash.com") && !avatarUrl.includes("/icon.svg") && !avatarUrl.includes("mock");

 return (
 <div className="relative flex flex-col items-center">
 {/* Invisible input element */}
 <input aria-label="Input field"
 ref={fileInputRef}
 type="file"
 accept="image/*"
 onChange={(e) => {
 const file = e.target.files?.[0];
 if (file) handleFileChange(file);
 }}
 className="hidden"
 />

 {/* Main Avatar Canvas Area */}
 <div className="relative group select-none">
 {/* Outer ambient glow based on dragging state */}
 <AnimatePresence>
 {isDragging && (
 <motion.div
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1.08 }}
 exit={{ opacity: 0, scale: 0.95 }}
 className="absolute -inset-2.5 rounded-full border-2 border-dashed border-[#007AFF] bg-[#007AFF]/5 dark:bg-[#0BE5FF]/5 blur-[2px] z-0"
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 />
 )}
 </AnimatePresence>

 {/* Dynamic tap feedback container */}
	<div>
 <motion.button
 type="button"
 onDragOver={onDragOver}
 onDragLeave={onDragLeave}
 onDrop={onDrop}
 onMouseEnter={() => setIsHovered(true)}
 onMouseLeave={() => setIsHovered(false)}
 onClick={triggerUploadClick}
 whileHover={{
 scale: 1.03,
 }}
 whileTap={{
 scale: 0.94,
 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className={`relative w-[96px] h-[96px] rounded-full flex items-center justify-center ${hasCustomAvatar ? "bg-transparent" : "bg-[#22C55E]"} border-[3px] ${
 isDragging
 ? "border-[#007AFF] dark:border-[#0BE5FF]"
 : "border-white dark:border-[#1E1E24] shadow-elevation-1"
 } overflow-hidden cursor-pointer select-none z-10 transition-colors duration-200`}
 style={{ transform: "translateZ(0)", WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}
 >
 {/* Shimmer overlay for standard images */}
 {hasCustomAvatar ? (
 <motion.img
 key={avatarUrl}
 src={avatarUrl}
 alt={name}
 initial={{ opacity: 0, scale: 1.08 }}
 animate={{ opacity: 1, scale: 1 }}
 exit={{ opacity: 0 }}
 whileHover={{ scale: 1.05 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 referrerPolicy="no-referrer"
 className="w-full h-full object-cover pointer-events-none select-none rounded-full"
 />
 ) : (
          <motion.svg
            key="letter"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full h-full bg-[#22C55E] rounded-full"
            viewBox="0 0 100 100"
            aria-label={`Avatar for ${name}`}
          >
            <text
              x="50%"
              y="50%"
              fill="#FFFFFF"
              className="font-sans pointer-events-none"
              fontSize="44"
              fontWeight="bold"
              textAnchor="middle"
              dy=".35em"
            >
              {initials}
            </text>
          </motion.svg>
 )}

 {/* iOS Soft Blurred Hover Overlay */}
 {isEditable && (
 <AnimatePresence>
 {(isHovered || isDragging) && !isUploading && (
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.18 }}
 className="absolute inset-0 bg-black/35 dark:bg-[#000000]/45 backdrop-blur-[3px] flex flex-col items-center justify-center text-white pointer-events-none"
 >
 <motion.div
 initial={{ y: 8, scale: 0.9 }}
 animate={{ y: 0, scale: 1 }}
 exit={{ y: -8, scale: 0.9 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className="flex flex-col items-center gap-1"
 >
 <Camera className="w-icon-md h-icon-md text-white/95" />
 <span className="text-caption font-semibold uppercase text-white/90">
 {isDragging ? "Drop Image" : "Edit"}
 </span>
 </motion.div>
 </motion.div>
 )}
 </AnimatePresence>
 )}

 {/* Premium iOS Circular Uploading State */}
 <AnimatePresence>
 {isUploading && (
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 className="absolute inset-0 bg-neutral-900/80 dark:bg-[#000000]/85 backdrop-blur-[4px] flex flex-col items-center justify-center text-white"
 >
 {/* SVG circular progress ring */}
 <div className="relative w-12 h-12 flex items-center justify-center">
 <svg className="absolute w-full h-full -rotate-90">
 <circle
 cx="24"
 cy="24"
 r="20"
 className="stroke-neutral-700/40"
 strokeWidth="3.5"
 fill="transparent"
 />
 <motion.circle
 cx="24"
 cy="24"
 r="20"
 className="stroke-[#007AFF] dark:stroke-[#0BE5FF]"
 strokeWidth="3.5"
 fill="transparent"
 strokeDasharray={2 * Math.PI * 20}
 strokeDashoffset={
 2 * Math.PI * 20 * (1 - uploadProgress / 100)
 }
 transition={{ type: "tween", ease: "easeOut" }}
 />
 </svg>
 <span className="text-caption font-mono font-semibold text-neutral-200">
 {Math.round(uploadProgress)}%
 </span>
 </div>
 <span className="text-caption font-semibold text-neutral-500 dark:text-[#EBEBF599] mt-2 uppercase select-none">
 Processing...
 </span>
 </motion.div>
 )}
 </AnimatePresence>
 </motion.button>
 </div>
 </div>



 {/* Under-avatar inline file error message */}
 <AnimatePresence>
 {imageError && (
 <motion.div
 initial={{ opacity: 0, y: -6 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -6 }}
 className="text-caption text-rose-500 bg-rose-500/5 px-3 py-1 rounded-lg border border-rose-500/10 font-mono mt-2 flex items-center gap-1 max-w-xs text-center"
 >
 <span>⚠️ {imageError}</span>
 </motion.div>
 )}
 </AnimatePresence>

 </div>
 );
});
