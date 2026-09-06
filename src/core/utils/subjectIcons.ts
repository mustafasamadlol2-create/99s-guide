import { PersonPresentation } from "../../components/icons/PersonPresentation";

import { Virus } from "../../components/icons/Virus";

import {
  Bug,
  Apple,
  ClipboardList,
  Hospital,
  Users,
  Dna, ShieldPlus,
  Presentation,
  BookOpen,
} from "lucide-react";

export const getSubjectIconInfo = (id: string) => {
  switch (id) {
    case "ID":
      return {
        icon: Virus,
        bg: "bg-emerald-100 dark:bg-[rgba(94,234,212,0.15)]",
        text: "text-emerald-600 dark:text-[rgba(94,234,212,1)]",
        glow: "#10b981",
        badge: "ID CORE",
      };
    case "NT":
      return {
        icon: Apple,
        bg: "bg-violet-100 dark:bg-[rgba(196,181,253,0.15)]",
        text: "text-violet-600 dark:text-[rgba(196,181,253,1)]",
        glow: "#8b5cf6",
        badge: "NT CORE",
      };
    case "RM":
      return {
        icon: ClipboardList,
        bg: "bg-sky-100 dark:bg-[rgba(186,230,253,0.15)]",
        text: "text-sky-600 dark:text-[rgba(186,230,253,1)]",
        glow: "#0ea5e9",
        badge: "RM CORE",
      };
    case "CA":
      return {
        icon: Hospital,
        bg: "bg-rose-100 dark:bg-[rgba(253,164,175,0.15)]",
        text: "text-rose-600 dark:text-[rgba(253,164,175,1)]",
        glow: "#f43f5e",
        badge: "CA CORE",
      };
    case "PHC":
      return {
        icon: Users,
        bg: "bg-amber-100 dark:bg-[rgba(253,216,165,0.15)]",
        text: "text-amber-600 dark:text-[rgba(253,216,165,1)]",
        glow: "#f59e0b",
        badge: "PHC CORE",
      };
    case "ImD":
      return {
        icon: ShieldPlus,
        bg: "bg-indigo-100 dark:bg-[rgba(191,219,254,0.15)]",
        text: "text-indigo-600 dark:text-[rgba(191,219,254,1)]",
        glow: "#6366f1",
        badge: "ImD CORE",
      };
    case "SSC":
      return {
        icon: PersonPresentation,
        bg: "bg-neutral-100 dark:bg-[rgba(229,231,235,0.15)]",
        text: "text-neutral-700 dark:text-[rgba(229,231,235,1)]",
        glow: "#64748b",
        badge: "SSC CORE",
      };
    default:
      return {
        icon: BookOpen,
        bg: "bg-[#E8EDF9] dark:bg-[rgba(191,219,254,0.15)]",
        text: "text-blue-600 dark:text-[rgba(191,219,254,1)]",
        glow: "#3b82f6",
        badge: "CORE",
      };
  }
};
