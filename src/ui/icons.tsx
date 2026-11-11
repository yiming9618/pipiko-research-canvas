// One small line-icon set: 24px grid, 1.5 stroke, round caps.
// Icons are decorative next to text; icon-only buttons carry their own aria-label.

import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconSettings = () => (
  <Icon>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
)

export const IconArrowDown = () => (
  <Icon>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
)

export const IconBack = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const IconCopy = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 9V6.5A2.5 2.5 0 0 0 12.500 4h-6A2.500 2.500 0 0 0 4 6.500v6A2.500 2.500 0 0 0 6.500 15H9" />
  </Icon>
)

export const IconCheck = () => (
  <Icon>
    <path d="M5 12.500l4.500 4.500L19 7.500" />
  </Icon>
)

export const IconUndo = () => (
  <Icon>
    <path d="M8 5L4 9l4 4" />
    <path d="M4 9h10a5 5 0 0 1 0 10h-3" />
  </Icon>
)

export const IconChevron = () => (
  <Icon>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const IconPlus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IconImage = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M5 17l4.500-4 3.500 3 2.500-2 3.500 3" />
  </Icon>
)

export const IconDownload = () => (
  <Icon>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </Icon>
)

export const IconUpload = () => (
  <Icon>
    <path d="M12 16V5M7 9l5-5 5 5M5 20h14" />
  </Icon>
)

export const IconForward = () => (
  <Icon>
    <path d="M9 5l7 7-7 7" />
  </Icon>
)

export const IconHand = () => (
  <Icon>
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </Icon>
)

export const IconLink = () => (
  <Icon>
    <circle cx="5.500" cy="18.500" r="2.500" />
    <path d="M7.500 16.500C11 13 13 11 18 6M13 6h5v5" />
  </Icon>
)

export const IconPen = () => (
  <Icon>
    <path d="M4 20l1-4.500L16.500 4a2.120 2.120 0 0 1 3 3L8 18.500 4 20z" />
    <path d="M14.500 6l3 3" />
  </Icon>
)

export const IconText = () => (
  <Icon>
    <path d="M5 6V5h14v1M12 5v14M9 19h6" />
  </Icon>
)

export const IconSearch = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.500" />
    <path d="M16 16l4 4" />
  </Icon>
)

export const IconEdit = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
)

export const IconChat = () => (
  <Icon>
    <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  </Icon>
)
