import type { SVGProps } from 'react';

// Stroke icons from the design (design/icons.js), 24px grid.
const PATHS = {
  select: <path d="M5 3l14 8-6 2-2 6z" />,
  arrow: <path d="M5 19L19 5M9 5h10v10" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6" />,
  line: <path d="M5 19L19 5" />,
  box: <rect x="4" y="5" width="16" height="14" rx="2" />,
  pen: <path d="M4 20l1-4L16 5l3 3L8 19z" />,
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  blur: <path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z" />,
  steps: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M11 9l1-1v8" />
    </>
  ),
  crop: <path d="M7 3v14h14M3 7h14v14" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" />,
  screen: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <path d="M9 20h6" />
    </>
  ),
  visible: <path d="M4 9V6a2 2 0 012-2h3M15 4h3a2 2 0 012 2v3M20 15v3a2 2 0 01-2 2h-3M9 20H6a2 2 0 01-2-2v-3" />,
  region: <rect x="4" y="5" width="16" height="14" rx="1" strokeDasharray="3 3" />,
  fullpage: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="1" />
      <path d="M12 8v8M9.5 13.5L12 16l2.5-2.5" />
    </>
  ),
  element: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="1" />
      <path d="M12 12l8 3-3.5 1.5L15 20z" />
    </>
  ),
  delay: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4l2.5 1.5M9.5 3h5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  warn: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M9 21h6" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.6, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
