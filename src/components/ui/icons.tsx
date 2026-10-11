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
