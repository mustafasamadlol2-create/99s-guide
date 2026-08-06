import { getApiUrl } from "../../core/api/api";
import { safeJsonParse } from "../../core/utils/safeJson";
import React, { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect, Suspense, memo, lazy } from "react";
import {
 Search,
 X,
 Clock,
 ChevronRight,
 BookOpen,
 FileText,
 PlayCircle,
 Layers,
 HelpCircle,
 File,
 Folder,
 Settings,
 Command,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import fuzzysort from "fuzzysort";

type SearchResultType =
 | "subject"
 | "lecture"
 | "pdf"
 | "notes"
 | "video"
 | "mcq"
 | "flashcard"
 | "setting";

export interface SearchResultItem {
 id: string;
 title: string;
 subtitle?: string;
 type: SearchResultType;
 lectureId?: string;
 subjectId?: string;
 action?: () => void;
 raw?: any;
}

interface CommandPaletteProps {
 isOpen: boolean;
 onClose: () => void;
 data?: SearchResultItem[];
 onSelectResult?: (result: SearchResultItem) => void;
 inline?: boolean;
}

const TYPE_ICONS: Record<SearchResultType, any> = {
 subject: Folder,
 lecture: BookOpen,
 pdf: FileText,
 notes: File,
 video: PlayCircle,
 mcq: HelpCircle,
 flashcard: Layers,
 setting: Settings,
};

const TYPE_COLORS: Record<SearchResultType, string> = {
 subject: "text-med-blue bg-blue-50  ",
 lecture: "text-med-gold bg-amber-50  ",
 pdf: "text-rose-500 bg-rose-50  ",
 notes: "text-purple-500 bg-purple-50  ",
 video: "text-cyan-500 bg-cyan-50  ",
 mcq: "text-emerald-500 bg-emerald-50  ",
 flashcard: "text-orange-500 bg-orange-50  ",
 setting: "text-neutral-500 bg-neutral-50  ",
};

export const CommandPalette = memo(function CommandPalette({
 isOpen,
 onClose,
 data = [],
 onSelectResult,
 inline = false,
}: CommandPaletteProps) {
 const [value, setValue] = useState("");
 const [recentSearches, setRecentSearches] = useState<SearchResultItem[]>([]);
 const [selectedIndex, setSelectedIndex] = useState(0);
 const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
 const [isLoading, setIsLoading] = useState(false);
 const inputRef = useRef<HTMLInputElement>(null);
 const containerRef = useRef<HTMLDivElement>(null);

 // Click-outside: blur & clear inline search when user taps elsewhere
 useEffect(() => {
  if (!inline) return;
  const handleClickOutside = (e: MouseEvent) => {
   if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
    setValue("");
    inputRef.current?.blur();
   }
  };
  document.addEventListener("mousedown", handleClickOutside);
  return () => document.removeEventListener("mousedown", handleClickOutside);
 }, [inline]);

 useEffect(() => {
 try {
 const stored = localStorage.getItem("recent_global_searches");
 if (stored) {
 setRecentSearches(safeJsonParse(stored, []));
 }
 } catch (e) {
 // ignore
 }
 }, []);

 useEffect(() => {
 if (isOpen) {
 setValue("");
 setSearchResults([]);
 setSelectedIndex(0);
 if (!inline) {
 setTimeout(() => inputRef.current?.focus(), 50);
 }
 }
 }, [isOpen, inline]);

 const saveRecentSearch = (item: SearchResultItem) => {
 try {
 const current = recentSearches.filter((s) => s.id !== item.id);
 const updated = [item, ...current].slice(0, 5);
 setRecentSearches(updated);
 localStorage.setItem("recent_global_searches", JSON.stringify(updated));
 } catch (e) {
 // ignore
 }
 };

 useEffect(() => {
 if (!value.trim()) {
 setSearchResults([]);
 setIsLoading(false);
 return;
 }

 setIsLoading(true);
 const controller = new AbortController();

 const timeoutId = setTimeout(async () => {
 try {
 let fetchedResults: any[] = [];
 try {
 const token = localStorage.getItem("token") || "";
 const response = await fetch(getApiUrl(`api/search?q=${encodeURIComponent(value.trim())}`), {
 headers: {
 "Authorization": `Bearer ${token}`
 },
 signal: controller.signal
 });
 
 if (response.ok) {
 fetchedResults = await response.json();
 }
 } catch (err: any) {
 if (err.name !== "AbortError") {
 }
 }
 
 // Enhance with client-side fallback (fuzzysort on static data if they match, primarily subjects)
 if (data.length > 0) {
 const localResults = fuzzysort.go(value, data, {
 keys: ["title", "subtitle"],
 limit: 5,
 threshold: -10000,
 }).map(res => res.obj);
 
 // Merge avoiding duplicates
 const seen = new Set(fetchedResults.map((r: any) => r.id));
 localResults.forEach((lr: any) => {
 if (!seen.has(lr.id)) {
 fetchedResults.push(lr);
 }
 });
 }
 
 setSearchResults(fetchedResults);
 } catch (err: any) {
 if (err.name !== "AbortError") {
 }
 } finally {
 setIsLoading(false);
 }
 }, 250);

 return () => {
 clearTimeout(timeoutId);
 controller.abort();
 };
 }, [value, data]);

 const activeList = value ? searchResults : recentSearches;

 useEffect(() => {
 setSelectedIndex(0);
 }, [value, searchResults]);

 const handleSelect = (item: SearchResultItem) => {
 saveRecentSearch(item);
 onClose();
 if (item.action) {
 item.action();
 } else if (onSelectResult) {
 onSelectResult(item);
 }
 // Inline: clear text and remove focus after selection
 if (inline) {
  setValue("");
  setTimeout(() => inputRef.current?.blur(), 0);
 }
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === "Enter" && activeList.length > 0) {
 handleSelect(activeList[selectedIndex]);
 } else if (e.key === "Escape") {
 onClose();
 } else if (e.key === "ArrowDown") {
 e.preventDefault();
 setSelectedIndex((prev) => (prev + 1) % activeList.length);
 } else if (e.key === "ArrowUp") {
 e.preventDefault();
 setSelectedIndex((prev) =>
 prev === 0 ? activeList.length - 1 : prev - 1
 );
 }
 };

 const renderResultItem = (
 item: SearchResultItem,
 index: number,
 isRecent: boolean = false
 ) => {
 const Icon = TYPE_ICONS[item.type] || Search;
 const colorClass =
 TYPE_COLORS[item.type] || "text-neutral-500 bg-neutral-100";
 const isSelected = index === selectedIndex;

 return (
 <div
 key={`${isRecent ? "recent" : "search"}-${item.id}`}
        role="option"
        aria-selected={isSelected}
 onMouseEnter={() => setSelectedIndex(index)}
 onClick={() => handleSelect(item)}
 className={`w-full flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200 group mx-2 max-w-[calc(100%-1rem)] rounded-xl active:scale-[0.98] active:opacity-90 ${
 isSelected
 ? "bg-black/5 dark:bg-white/[0.12]"
 : "hover:bg-neutral-50 dark:hover:bg-white/[0.06]"
 }`}
 >
 <div
 className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}
 >
 {isRecent ? (
 <Clock className="w-icon-sm h-icon-sm opacity-70" />
 ) : (
 <Icon className="w-icon-sm h-icon-sm" />
 )}
 </div>
 <div className="flex-1 min-w-0 flex flex-col justify-center">
 <span className="text-base font-semibold text-neutral-900 dark:text-white truncate">
 {item.title}
 </span>
 {item.subtitle && (
 <span className="text-xs font-medium text-neutral-500 dark:text-[#EBEBF599] truncate">
 {item.subtitle}
 </span>
 )}
 </div>
 <ChevronRight className={`w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] transition-opacity ${ isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-80" }`} />
 </div>
 );
 };

 if (inline) {
 return (
 <div className="relative w-full" ref={containerRef}>
 <div className="w-full bg-white dark:bg-[#1C1C1E] edge-light rounded-xl shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-white/10 overflow-hidden flex flex-col relative z-40 transition duration-normal ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}>
 <div className="flex items-center p-4 shrink-0 gap-3">
 <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-amber-50 dark:bg-[rgba(251,191,36,0.12)] text-amber-500 dark:text-amber-300 relative z-10 shadow-elevation-1 ring-1 ring-black/[0.04] dark:ring-white/10">
   <Search className="w-icon-md h-icon-md" />
 </div>
 <input aria-label="Input field"
 ref={inputRef}
 type="text"
 value={value}
 onChange={(e) => setValue(e.target.value)}
 onKeyDown={handleKeyDown}
 placeholder="Search subjects, lectures..."
 className="flex-1 bg-transparent text-secondary-label font-display font-semibold text-neutral-600 dark:text-[var(--text-secondary)] placeholder:text-neutral-400 dark:placeholder:text-white/30 placeholder:font-semibold min-w-0 outline-none relative z-10"
 />
 {value && (
 <button aria-label="Clear search"
 onClick={() => { setValue(""); inputRef.current?.blur(); }}
 className="p-1 rounded-full text-neutral-400 dark:text-white/40 hover:text-neutral-600 dark:hover:text-white/70 transition-colors shrink-0 relative z-10"
 >
 <X className="w-icon-sm h-icon-sm" />
 </button>
 )}
 </div>
 </div>

 {value && (
 <div className="absolute top-[100%] mt-2 left-0 right-0 z-50 bg-white dark:bg-[var(--bg-surface-1)] rounded-xl shadow-elevation-3 ring-1 ring-black/[0.03] dark:ring-white/10 flex flex-col overflow-hidden transition duration-normal">
 <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[40vh] overscroll-y-contain">
 {searchResults.length > 0 && !isLoading && (
 <div className="py-2">
 {searchResults.map((item, index) =>
 renderResultItem(item, index)
 )}
 </div>
 )}

 {isLoading && (
 <div className="px-4 py-4 flex flex-col gap-3">
 {[...Array(3)].map((_, i) => (
 <div key={i} className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-lg bg-neutral-200 dark:bg-[#2C2C2E] animate-pulse shrink-0" />
 <div className="flex-1 space-y-2">
 <div className="h-4 bg-neutral-200 dark:bg-[#2C2C2E] rounded w-1/2 animate-pulse" />
 <div className="h-3 bg-neutral-200 dark:bg-[#2C2C2E] rounded w-1/3 animate-pulse" />
 </div>
 </div>
 ))}
 </div>
 )}
 {searchResults.length === 0 && !isLoading && (
 <div className="px-4 py-8 text-center flex flex-col items-center justify-center gap-3">
 <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-[#2C2C2E]/80 flex items-center justify-center">
 <Search className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599]" />
 </div>
 <p className="text-sm font-semibold text-neutral-900 dark:text-white">
 No results found
 </p>
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 );
 }

 return (
 <AnimatePresence>
 {isOpen && (
 <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 onClick={onClose}
 className="absolute inset-0 bg-black/40 backdrop-blur-sm"
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.95, y: -20 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.95, y: -20 }}
 transition={{
 type: "spring",
 stiffness: 400,
 damping: 40,
 mass: 1,
 }}
 role="dialog" aria-modal="true" aria-label="Command Palette"
            className="relative w-full max-w-2xl bg-[#ffffff]/90 dark:bg-[var(--bg-surface-1)]/90 backdrop-blur-3xl rounded-lg shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] border border-white/20 dark:border-white/[0.12] overflow-hidden flex flex-col max-h-[60vh]"
 >
 <div className="flex items-center px-4 py-3 border-b border-black/5 dark:border-white/[0.12] shrink-0">
 <Search className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599] mr-3" />
 <input aria-label="Input field"
 ref={inputRef}
 type="text"
 value={value}
 onChange={(e) => setValue(e.target.value)}
 onKeyDown={handleKeyDown}
 placeholder="Search subjects, lectures, settings..."
 className="flex-1 bg-transparent text-base text-neutral-900 dark:text-white placeholder:text-neutral-500 dark:text-[#EBEBF599]"
 />
 <div className="flex items-center gap-2">
 {value && (
 <button aria-label="Clear search"
 onClick={() => setValue("")}
 className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/[0.12] text-neutral-500 dark:text-[#EBEBF599] transition-colors mr-1"
 >
 <X className="w-icon-sm h-icon-sm" />
 </button>
 )}
 <div className="hidden sm:flex items-center gap-1 text-xs font-semibold text-neutral-500 dark:text-[#EBEBF599] bg-neutral-100 dark:bg-white/[0.08] px-2 py-1 rounded-md">
 <Command className="w-3 h-3" />
 <span>K</span>
 </div>
 </div>
 </div>

 <div className="flex-1 overflow-y-auto custom-scrollbar overscroll-y-contain" id="command-palette-results" role="listbox">
 {value && searchResults.length > 0 && !isLoading && (
 <div className="py-2">
 <div className="px-4 py-2">
 <span className="text-xs font-semibold text-neutral-500 uppercase">
 Results
 </span>
 </div>
 {searchResults.map((item, index) =>
 renderResultItem(item, index)
 )}
 </div>
 )}

        {isLoading && (
          <div className="px-4 py-4 flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-neutral-200 dark:bg-[#2C2C2E] animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-neutral-200 dark:bg-[#2C2C2E] rounded w-1/2 animate-pulse" />
                  <div className="h-3 bg-neutral-200 dark:bg-[#2C2C2E] rounded w-1/3 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}
        {searchResults.length === 0 && !isLoading && value && (
          <div className="px-4 py-12 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-[#2C2C2E]/80 flex items-center justify-center">
              <Search className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599]" />
            </div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              No results found
            </p>
          </div>
        )}
        {!value && recentSearches.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-500 uppercase">
                Recent Searches
              </span>
            </div>
            {recentSearches.map((item, index) =>
              renderResultItem(item, index, true)
            )}
          </div>
        )}
        {!value && recentSearches.length === 0 && (
          <div className="px-4 py-12 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-[#2C2C2E]/80 flex items-center justify-center">
              <Search className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599]" />
            </div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              Search for anything
            </p>
          </div>
        )}
      </div>
    </motion.div>
  </div>
)}
</AnimatePresence>
);
});
