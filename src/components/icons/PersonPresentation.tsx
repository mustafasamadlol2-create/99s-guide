import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { LucideProps } from 'lucide-react';

export const PersonPresentation = React.forwardRef<SVGSVGElement, LucideProps>(
 ({ color = 'currentColor', size = 24, strokeWidth = 2, className = '', ...rest }, ref) => {
 return (
 <svg
 ref={ref}
 xmlns="http://www.w3.org/2000/svg"
 width={size}
 height={size}
 viewBox="0 0 24 24"
 fill="none"
 stroke={color}
 strokeWidth={strokeWidth}
 strokeLinecap="round"
 strokeLinejoin="round"
 className={`lucide ${className}`}
 {...rest}
 >
 {/* Presentation Screen */}
 <rect x="8" y="3" width="15" height="11" rx="2" />
 
 {/* Screen Stand */}
 <path d="M15.5 14v5" />
 <path d="M11.5 19h8" />
 
 {/* Presentation Bars */}
 <path d="M12 10.5V7.5" />
 <path d="M15.5 10.5V5.5" />
 <path d="M19 10.5V8" />
 
 {/* Person Head */}
 <circle cx="4.5" cy="7" r="2.5" />
 
 {/* Person Body */}
 <path d="M1.5 21v-5a3 3 0 0 1 6 0v5" />
 
 {/* Pointer Arm */}
 <path d="M7 14.5l4-3" />
 </svg>
 );
 }
);

PersonPresentation.displayName = 'PersonPresentation';
