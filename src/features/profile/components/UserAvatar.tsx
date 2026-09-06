import React, { useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  className?: string; // used to set width/height and positioning
}

function extractFirstLetter(name: string): string {
  if (!name) return "";
  // Find first alphabetic character (including Arabic)
  const match = name.match(/[\p{L}]/u);
  if (match) {
    return match[0].toUpperCase();
  }
  return name.trim().charAt(0).toUpperCase() || "?";
}

export const UserAvatar = memo(function UserAvatar({ name, avatarUrl, className = "w-10 h-10" }: UserAvatarProps) {
  const letter = useMemo(() => extractFirstLetter(name), [name]);
  
  const hasCustomAvatar = avatarUrl && avatarUrl.trim() !== "" && !avatarUrl.includes("unsplash.com") && !avatarUrl.includes("/icon.svg") && !avatarUrl.includes("mock");

  return (
    <div className={`relative rounded-full shrink-0 flex items-center justify-center overflow-hidden ${hasCustomAvatar ? 'bg-transparent' : 'bg-[#22C55E]'} ${className}`} style={{ transform: "translateZ(0)", WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}>
      <AnimatePresence>
        {hasCustomAvatar ? (
          <motion.img
            key="image"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            src={avatarUrl}
            alt={name || "Avatar"}
            className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none rounded-full"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <motion.svg
            key="letter"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 w-full h-full rounded-full"
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
              {letter}
            </text>
          </motion.svg>
        )}
      </AnimatePresence>
    </div>
  );
});
