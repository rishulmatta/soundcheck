import type { ReactNode } from "react";

/** Lucide-style icons, 1.5px stroke, drawn inline so no icon package is needed. Decorative: always sits beside words or inside a labelled control. */
function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0">
      {children}
    </svg>
  );
}

export const ChevronRight = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const ArrowRight = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const ArrowLeft = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const Check = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const Link2 = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
  </Svg>
);
export const FileText = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);
export const Download = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </Svg>
);
export const Play = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7 5v14l12-7z" />
  </Svg>
);
export const Shuffle = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 8h12l-3-3M20 16H8l3 3" />
  </Svg>
);
export const Printer = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2" />
    <path d="M7 14h10v6H7z" />
  </Svg>
);
export const Lock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const Unlock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-1.9" />
  </Svg>
);
export const X = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const Trash = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
  </Svg>
);
export const GripVertical = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="9" cy="6" r="0.9" />
    <circle cx="15" cy="6" r="0.9" />
    <circle cx="9" cy="12" r="0.9" />
    <circle cx="15" cy="12" r="0.9" />
    <circle cx="9" cy="18" r="0.9" />
    <circle cx="15" cy="18" r="0.9" />
  </Svg>
);
export const ArrowUp = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const ArrowDown = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const Undo = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
);
export const ChevronDown = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const ChevronLeft = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const Calendar = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </Svg>
);
