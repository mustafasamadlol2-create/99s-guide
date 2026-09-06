import React from 'react';
import {
 Book,
 FileText,
 Megaphone,
 ClipboardCheck,
 BookOpenText,
 ListTodo,
 CalendarMinus,
 PartyPopper,
 NotebookPen,
 Bell,
 CircleCheck,
 CircleX,
} from "lucide-react";
import { CalendarEvent } from "../../../core/types";

export const PRIORITY = {
 EXAM: 1,
 QUIZ: 2,
 LECTURE: 3,
 ASSIGNMENT: 4,
 ANNOUNCEMENT: 5,
 HOLIDAY: 6,
 OTHER: 7,
};

export const getEventPriority = (ev: CalendarEvent) => {
 const type = (ev.eventType || ev.type || "").toUpperCase();
 if (type === "EXAM" || type === "IMPORTANT EXAM") return PRIORITY.EXAM;
 if (type === "QUIZ" || type === "DAILY EXAM") return PRIORITY.QUIZ;
 if (type === "LECTURE" || type === "CLASS" || type === "LECTURES") return PRIORITY.LECTURE;
 if (type === "ASSIGNMENT" || type === "HOMEWORK") return PRIORITY.ASSIGNMENT;
 if (type === "ANNOUNCEMENT" || type === "BULLETIN") return PRIORITY.ANNOUNCEMENT;
 if (type === "HOLIDAY" || ev.type === "holiday") return PRIORITY.HOLIDAY;
 return PRIORITY.OTHER;
};

export const getEventIconInfo = (ev: CalendarEvent) => {
 const evType = (ev.eventType || ev.type || "").toUpperCase();
 
 if (evType === "EXAM" || evType === "IMPORTANT EXAM") {
 return {
 Icon: FileText,
 colorClass: "text-red-500 dark:text-red-400",
 bgClass: "bg-red-50 dark:bg-red-900/20",
 accentColor: "#EF4444",
 };
 } else if (evType === "QUIZ" || evType === "DAILY EXAM") {
 return {
 Icon: ClipboardCheck,
 colorClass: "text-orange-500 dark:text-orange-400",
 bgClass: "bg-orange-50 dark:bg-orange-900/20",
 accentColor: "#F97316",
 };
 } else if (evType === "ANNOUNCEMENT" || evType === "BULLETIN") {
 return {
 Icon: Megaphone,
 colorClass: "text-green-500 dark:text-green-400",
 bgClass: "bg-green-50 dark:bg-green-900/20",
 accentColor: "#22C55E",
 };
 } else if (evType === "HOLIDAY") {
 return {
 Icon: PartyPopper,
 colorClass: "text-emerald-500 dark:text-emerald-400",
 bgClass: "bg-emerald-50 dark:bg-emerald-900/20",
 accentColor: "#10B981",
 };
 } else if (evType === "ASSIGNMENT" || evType === "HOMEWORK") {
 return {
 Icon: NotebookPen,
 colorClass: "text-purple-500 dark:text-purple-400",
 bgClass: "bg-purple-50 dark:bg-purple-900/20",
 accentColor: "#A855F7",
 };
 } else if (evType === "REMINDER") {
 return {
 Icon: Bell,
 colorClass: "text-yellow-500 dark:text-yellow-400",
 bgClass: "bg-yellow-50 dark:bg-yellow-900/20",
 accentColor: "#EAB308",
 };
 } else if (evType === "CANCELLED") {
 return {
 Icon: CircleX,
 colorClass: "text-neutral-500 dark:text-[#EBEBF599]",
 bgClass: "bg-neutral-50 dark:bg-[#1C1C1E]/20",
 accentColor: "#737373",
 };
 } else if (ev.isCompleted) {
 return {
 Icon: CircleCheck,
 colorClass: "text-emerald-500 dark:text-emerald-400",
 bgClass: "bg-emerald-50 dark:bg-emerald-900/20",
 accentColor: "#10B981",
 };
 }
 
 // Default Lecture
 return {
 Icon: BookOpenText,
 colorClass: "text-blue-600 dark:text-blue-400",
 bgClass: "bg-blue-50 dark:bg-blue-900/20",
 accentColor: "#2563EB",
 };
};

export const getEventCardStyles = (ev: CalendarEvent) => {
 const priority = getEventPriority(ev);
 
 // Base configuration
 const baseCardClass = "transition duration-200";
 let itemClass = "bg-blue-100/80 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300";
 let leftBorderClass = "";
 let iconColorClass = "text-blue-800 dark:text-blue-300";
 const titleWeight = "font-normal";
 const titleSize = "text-sm sm:text-sm";
 const elevationClass = "";

 if (priority === PRIORITY.EXAM) {
 itemClass = "bg-red-100/80 dark:bg-red-900/40 text-red-800 dark:text-red-300";
 leftBorderClass = "";
 iconColorClass = "text-red-800 dark:text-red-300";
 } else if (priority === PRIORITY.QUIZ) {
 itemClass = "bg-orange-100/80 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300";
 leftBorderClass = "";
 iconColorClass = "text-orange-800 dark:text-orange-300";
 } else if (priority === PRIORITY.ANNOUNCEMENT) {
 itemClass = "bg-green-100/80 dark:bg-green-900/40 text-green-800 dark:text-green-300";
 leftBorderClass = "";
 iconColorClass = "text-green-800 dark:text-green-300";
 } else if (priority === PRIORITY.ASSIGNMENT) {
 itemClass = "bg-purple-100/80 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300";
 leftBorderClass = "";
 iconColorClass = "text-purple-800 dark:text-purple-300";
 } else if (priority === PRIORITY.HOLIDAY) {
 itemClass = "bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300";
 leftBorderClass = "";
 iconColorClass = "text-emerald-800 dark:text-emerald-300";
 }
 
 if (ev.isCompleted) {
 itemClass += " opacity-60 grayscale-[0.5]";
 }
 
 return {
 cardClass: `${baseCardClass} ${itemClass} ${elevationClass}`,
 leftBorderClass,
 textColorClass: iconColorClass,
 iconColorClass,
 titleWeight,
 titleSize,
 };
};

