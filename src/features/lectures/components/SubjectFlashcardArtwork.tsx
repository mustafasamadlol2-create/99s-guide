import React from "react";
import type { SubjectId } from "../../../core/types";

interface SubjectFlashcardArtworkProps {
  subjectId?: SubjectId | string;
  rgb: string;
  className?: string;
}

const commonProps = {
  fill: "none",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SubjectFlashcardArtwork({
  subjectId,
  rgb,
  className = "",
}: SubjectFlashcardArtworkProps) {
  const stroke = `rgba(${rgb}, 0.26)`;
  const faint = `rgba(${rgb}, 0.11)`;
  const soft = `rgba(${rgb}, 0.07)`;

  const art = (() => {
    switch (subjectId) {
      case "ID":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.1">
              <path d="M111 58c20-19 52-17 69 4 17 21 14 53-7 70-21 17-53 14-70-7-17-21-13-49 8-67Z" />
              <path d="M138 43v-20m0 130v22m-56-77H58m157 0h-25m-91-50-16-15m109 109 15 15m-112 3-15 15m114-114 17-17" />
              <path d="M116 82c9-8 25-8 34 1 10 9 10 24 1 34-9 9-25 10-35 1-10-9-10-26 0-36Z" />
              <circle cx="132" cy="99" r="5" fill={faint} />
              <circle cx="163" cy="80" r="4" fill={faint} />
              <circle cx="105" cy="120" r="4" fill={faint} />
              <path d="M229 48c16 8 27 24 29 42 3 18-5 37-20 48-14 12-35 15-52 9" />
              <path d="M214 68c8 5 13 14 13 24 0 10-5 19-13 25" />
            </g>
            <g fill={soft}>
              <ellipse cx="252" cy="56" rx="18" ry="7" transform="rotate(-18 252 56)" />
              <ellipse cx="271" cy="135" rx="21" ry="8" transform="rotate(25 271 135)" />
              <ellipse cx="66" cy="57" rx="16" ry="6" transform="rotate(15 66 57)" />
            </g>
          </>
        );
      case "NT":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.1">
              <path d="M122 39c12 14 13 27 6 39" />
              <path d="M126 78c-22-18-54-7-59 20-6 31 21 65 55 65 15 0 23-8 33-8 11 0 18 8 33 8 34 0 61-34 55-65-5-27-37-38-59-20-16 13-42 13-58 0Z" />
              <path d="M139 36c16-13 33-15 47-7-5 16-19 26-39 27" />
              <path d="M91 113c21 7 42 7 62 0m-51 26c15 5 30 5 45 0" />
              <path d="M229 73c17 3 29 18 29 35 0 18-12 33-29 36" />
              <path d="M235 92h34m-17-17v34" />
            </g>
            <circle cx="232" cy="151" r="18" fill={soft} />
            <circle cx="74" cy="68" r="11" fill={soft} />
          </>
        );
      case "RM":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.05">
              <rect x="64" y="45" width="122" height="99" rx="14" />
              <path d="M86 117 109 92l20 13 33-38" />
              <circle cx="109" cy="92" r="4" fill={faint} />
              <circle cx="129" cy="105" r="4" fill={faint} />
              <circle cx="162" cy="67" r="4" fill={faint} />
              <path d="M83 65h36m-36 13h23" />
              <path d="M211 57h43c9 0 16 7 16 16v63c0 9-7 16-16 16h-43" />
              <path d="M222 82h31m-31 15h22m-22 15h31m-31 15h18" />
              <path d="m192 126 19 19m-9-32 21 21" />
            </g>
            <rect x="45" y="126" width="54" height="34" rx="10" fill={soft} />
          </>
        );
      case "CA":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.15">
              <path d="M91 47v44c0 26 18 47 41 47s41-21 41-47V47" />
              <path d="M78 47h26m56 0h26" />
              <circle cx="132" cy="139" r="9" />
              <path d="M141 145c9 17 24 25 43 24 26-1 42-20 42-43v-9" />
              <circle cx="226" cy="103" r="14" />
              <path d="M219 103h14m-7-7v14" />
              <path d="M66 154h55m-27-15v31" />
            </g>
            <path d="M214 49c25 9 42 34 40 61-1 16-8 30-19 41" stroke={faint} strokeWidth="10" strokeLinecap="round" />
          </>
        );
      case "PHC":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.05">
              <path d="M62 150V92l39-24 39 24v58m-61 0v-29h44v29" />
              <path d="M153 150v-71h52v71m12 0v-48h44v48" />
              <path d="M169 96h20m-10-10v20" />
              <path d="M50 151h226" />
              <circle cx="80" cy="52" r="13" />
              <circle cx="112" cy="46" r="10" />
              <circle cx="244" cy="66" r="12" />
              <path d="M67 72c7-8 19-11 27-5m6-3c5-6 14-8 21-4m111 26c7-6 17-7 24-3" />
            </g>
            <rect x="198" y="111" width="40" height="39" rx="9" fill={soft} />
          </>
        );
      case "ImD":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.1">
              <path d="M145 39c-38 0-69 29-69 65 0 35 27 58 69 72 42-14 69-37 69-72 0-36-31-65-69-65Z" />
              <path d="M145 58v87" />
              <path d="M145 91c-17-20-34-27-52-31m52 31c17-20 34-27 52-31" />
              <path d="M106 139c9-18 21-31 39-41m39 41c-9-18-21-31-39-41" />
              <path d="M239 58c12 0 22 9 22 21s-10 21-22 21-22-9-22-21 10-21 22-21Z" />
              <path d="m231 79 6 6 11-14" />
              <path d="M55 80c13-11 31-14 46-8" />
            </g>
            <circle cx="57" cy="123" r="22" fill={soft} />
            <circle cx="250" cy="137" r="17" fill={soft} />
          </>
        );
      case "SSC":
        return (
          <>
            <g {...commonProps} stroke={stroke} strokeWidth="2.05">
              <path d="m72 80 72-34 72 34-72 34-72-34Z" />
              <path d="M99 96v30c15 17 31 25 45 25 15 0 31-8 46-25V96" />
              <path d="M216 82v43" />
              <circle cx="216" cy="132" r="5" fill={faint} />
              <path d="M55 153h89m25 0h90" />
              <path d="M189 48h65v45" />
              <path d="M202 66h37m-37 13h24" />
            </g>
            <path d="M49 49h43v31H49z" fill={soft} />
          </>
        );
      default:
        return (
          <g {...commonProps} stroke={stroke} strokeWidth="2.1">
            <path d="M73 143h166M91 143V58h130v85" />
            <path d="M118 80h76m-76 22h55m-55 22h69" />
            <circle cx="230" cy="59" r="20" fill={soft} />
          </g>
        );
    }
  })();

  return (
    <svg
      viewBox="0 0 320 200"
      className={className}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`fade-${subjectId || "default"}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`rgba(${rgb}, 0.02)`} />
          <stop offset="100%" stopColor={`rgba(${rgb}, 0.12)`} />
        </linearGradient>
      </defs>
      <rect x="18" y="18" width="284" height="164" rx="40" fill={`url(#fade-${subjectId || "default"})`} opacity="0.45" />
      {art}
    </svg>
  );
}
