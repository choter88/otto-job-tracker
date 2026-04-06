# Otto Job Tracker -- UI & Design System Audit

**Generated:** 2026-04-04
**Codebase:** React 18.3 + Vite + Tailwind CSS 3.4 + Radix UI (shadcn/ui pattern)
**App type:** Electron desktop + web application for healthcare job/order tracking

---

## 1. Component Inventory

### 1.1 Primitive UI Components (shadcn/ui wrappers over Radix UI)

All located in `client/src/components/ui/`. Each wraps a Radix UI primitive, styled with Tailwind CSS via `class-variance-authority` (CVA) and the `cn()` utility (`client/src/lib/utils.ts`).

| File | Wraps | Variants/Notes |
|------|-------|----------------|
| `accordion.tsx` | `@radix-ui/react-accordion` | Chevron trigger, animated content |
| `alert-dialog.tsx` | `@radix-ui/react-alert-dialog` | Portal, overlay, content, action/cancel |
| `alert.tsx` | Custom (CVA) | `variant`: default, destructive |
| `avatar.tsx` | `@radix-ui/react-avatar` | Image + fallback |
| `badge.tsx` | Custom (CVA) | `variant`: default, secondary, destructive, outline |
| `breadcrumb.tsx` | `@radix-ui/react-slot` | Nav, list, item, link, separator, ellipsis |
| `button.tsx` | Custom (CVA + Slot) | `variant`: default, destructive, outline, secondary, ghost, link. `size`: default, sm, lg, icon |
| `calendar.tsx` | `react-day-picker` | Tailwind-styled DayPicker |
| `card.tsx` | Custom (div-based) | Header, footer, title, description, content |
| `carousel.tsx` | `embla-carousel-react` | Context-based with prev/next |
| `chart.tsx` | `recharts` | Container, tooltip, legend with theme support |
| `checkbox.tsx` | `@radix-ui/react-checkbox` | Check icon indicator |
| `collapsible.tsx` | `@radix-ui/react-collapsible` | Direct re-export |
| `command.tsx` | `cmdk` | Dialog, input, list, empty, group, item, separator |
| `context-menu.tsx` | `@radix-ui/react-context-menu` | Full menu tree with inset prop |
| `dialog.tsx` | `@radix-ui/react-dialog` | Portal, overlay, content, header, footer, close |
| `drawer.tsx` | `vaul` | Mobile drawer variant |
| `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | Full dropdown tree with inset prop |
| `form.tsx` | `react-hook-form` + `@radix-ui/react-label` | Field, item, label, control, description, message |
| `hover-card.tsx` | `@radix-ui/react-hover-card` | Trigger + content |
| `input-otp.tsx` | `input-otp` | Group + slot structure |
| `input.tsx` | Custom (native `<input>`) | Single styled element |
| `label.tsx` | `@radix-ui/react-label` | CVA-styled |
| `menubar.tsx` | `@radix-ui/react-menubar` | Full menubar tree |
| `navigation-menu.tsx` | `@radix-ui/react-navigation-menu` | List, item, trigger, content, viewport |
| `pagination.tsx` | Custom | Content, item, link, prev, next, ellipsis |
| `popover.tsx` | `@radix-ui/react-popover` | Trigger + portal content |
| `progress.tsx` | `@radix-ui/react-progress` | Single bar |
| `radio-group.tsx` | `@radix-ui/react-radio-group` | Group + item with circle indicator |
| `resizable.tsx` | `react-resizable-panels` | PanelGroup, panel, handle |
| `scroll-area.tsx` | `@radix-ui/react-scroll-area` | Viewport + custom scrollbar |
| `select.tsx` | `@radix-ui/react-select` | Trigger, content, item, separator, scroll buttons |
| `separator.tsx` | `@radix-ui/react-separator` | Horizontal/vertical divider |
| `sheet.tsx` | `@radix-ui/react-dialog` (side variant) | `side`: top, bottom, left, right. Default width `w-3/4 sm:max-w-sm` |
| `sidebar.tsx` | `react-resizable-panels` + custom context | Full sidebar system with provider, header, footer, menu, rail, trigger. CSS vars for widths. `Ctrl+B`/`Cmd+B` toggle. |
| `skeleton.tsx` | Custom | Animated placeholder (`animate-pulse`) |
| `slider.tsx` | `@radix-ui/react-slider` | Range slider |
| `switch.tsx` | `@radix-ui/react-switch` | Toggle switch |
| `table.tsx` | Custom (HTML `<table>`) | Header, body, footer, head, row, cell, caption |
| `tabs.tsx` | `@radix-ui/react-tabs` | List, trigger, content |
| `textarea.tsx` | Custom (native `<textarea>`) | Single styled element |
| `toast.tsx` | `@radix-ui/react-toast` | Provider, viewport, toast, title, description, action, close. `variant`: default, destructive |
| `toaster.tsx` | Custom (renders from `use-toast` hook) | Maps toast state to Toast components |
| `toggle-group.tsx` | `@radix-ui/react-toggle-group` | Group + item with context |
| `toggle.tsx` | `@radix-ui/react-toggle` | `variant`: default, outline. `size`: default, sm, lg |
| `tooltip.tsx` | `@radix-ui/react-tooltip` | Provider, trigger, content |

**Total: 46 primitive UI component files.**

### 1.2 Feature Components (Custom)

All located in `client/src/components/`.

| File | Type | Description |
|------|------|-------------|
| `sidebar.tsx` | Navigation | Custom sidebar (not using the shadcn SidebarProvider). Collapsible via localStorage state. Icons + labels + badge counts. |
| `jobs-table.tsx` | Table/Page | Main worklist. Card with search toolbar, filter bar, bulk action bar, horizontal-scroll table, row selection, inline status changes. |
| `job-dialog.tsx` | Modal/Form | Create/edit job dialog. react-hook-form + Zod. Fields: tray number, patient name, phone, job type, status, destination, date, redo flag, original job combobox, notes, custom columns. AlertDialog for duplicate tray confirmation. |
| `job-details-modal.tsx` | Modal | Large dialog (`max-w-5xl`, `h-[86vh]`). Tabbed: Overview, Comments, Related Jobs. Shows status history timeline, linked jobs, editable fields. |
| `job-comments-panel.tsx` | Panel | Comment thread for a job. Textarea with Enter-to-send, Shift+Enter for newline. Read receipts. Threaded display. |
| `comments-sidebar.tsx` | Sidebar overlay | Right-side overlay panel for comments. Fixed positioning with backdrop. |
| `overdue-jobs.tsx` | Page section | 4 severity stat cards (Critical/High/Medium/Low) + filtered table. Green "All caught up!" empty state. |
| `past-jobs.tsx` | Page section | Archived jobs. Date range filter, status filter, search. Alternating row colors. |
| `analytics-dashboard.tsx` | Dashboard | 4 metric cards + 4 chart panels (donut, bar, line via recharts). Date range picker. |
| `team-page.tsx` | Page section | Pending account requests, pending PIN resets, team member cards with role management. |
| `notification-bell.tsx` | Dropdown | Bell icon with unread count badge. Popover with ScrollArea listing notifications. Skeleton loading. |
| `notification-rules.tsx` | Panel | Card-based rule management. Switch toggles, select inputs, table of rules. |
| `settings-modal.tsx` | Modal | Tabbed dialog: Statuses, Job Types, Destinations, Custom Columns, Notification Rules, PIN Management, Invite Code. Drag-and-drop reordering (dnd-kit). Color pickers. |
| `user-settings-modal.tsx` | Modal | Font size slider, dark mode switch, other user preferences. |
| `health-modal.tsx` | Modal | System diagnostics. Metric cards with badges. |
| `import-wizard.tsx` | Modal | Multi-step wizard: template select, CSV upload, column mapping, confirmation, execution, results. |
| `import-template-select.tsx` | Component | Template picker with edit/delete via AlertDialog. |
| `import-mapping-step.tsx` | Wizard step | Table mapping CSV columns to job fields. Blue info banner. |
| `people-modal.tsx` | Modal | User/people management. Tabs, table, badges. |
| `job-message-templates-modal.tsx` | Modal | SMS/message template preview with colored badges. |
| `feedback-dialog.tsx` | Modal | Category select + textarea for in-app feedback. |
| `sync-manager.tsx` | Provider | WebSocket connection manager. WifiOff icon for disconnect state. No visible UI normally. |
| `sentry-error-boundary.tsx` | Error boundary | Fallback UI with inline styles (not Tailwind). "Something went wrong" + retry button. |
| `session-timeout-provider.tsx` | Provider | Session timeout detection. No visible UI (hook-based). |

### 1.3 Page Components

Located in `client/src/pages/`.

| File | Route | Description |
|------|-------|-------------|
| `dashboard.tsx` | `/`, `/dashboard/:tab?` | Shell layout: sidebar + header + tabbed content area. Manages modal state for settings, health, user-settings, feedback. |
| `auth-page.tsx` | `/auth` | Two-column layout (desktop). Sign-in, registration, forgot PIN, portal reset forms. |
| `important-jobs.tsx` | `/important` | Flagged/important jobs list. Badge color functions duplicated here. |
| `admin.tsx` | (internal) | Admin stats dashboard. Grid of metric cards. |
| `not-found.tsx` | `*` | Centered card with AlertCircle icon, "404 Not Found" message. Max width `md`. |

### 1.4 Hooks

| File | Purpose |
|------|---------|
| `hooks/use-auth.tsx` | Auth context: login/logout mutations, role checks, session state |
| `hooks/use-toast.ts` | Toast state management. `TOAST_LIMIT = 1`. Reducer pattern. |
| `hooks/use-mobile.tsx` | `useIsMobile()` -- `MOBILE_BREAKPOINT = 768`, uses `window.matchMedia` |

### 1.5 Third-Party Libraries Used for UI

| Library | Version | Used For |
|---------|---------|----------|
| `@radix-ui/react-*` (26 packages) | ^1.x--^2.x | All primitive interactive components |
| `tailwindcss` | ^3.4.17 | Utility-first CSS |
| `tailwind-merge` | ^2.6.0 | Class conflict resolution |
| `tailwindcss-animate` | ^1.0.7 | Animation utilities (`animate-in`, `animate-out`, etc.) |
| `class-variance-authority` | ^0.7.1 | Component variant definitions |
| `lucide-react` | ^0.453.0 | Icon library (sole icon set) |
| `recharts` | ^2.15.2 | Charts (bar, pie/donut, line) |
| `cmdk` | ^1.1.1 | Command palette |
| `embla-carousel-react` | ^8.6.0 | Carousel |
| `input-otp` | ^1.4.2 | OTP/PIN input |
| `framer-motion` | ^11.13.1 | Listed as dependency but **not used** in any TSX file |
| `react-resizable-panels` | ^2.1.7 | Resizable panel layouts |
| `vaul` | ^1.1.2 | Drawer component |
| `react-day-picker` | ^8.10.1 | Calendar/date picker |
| `next-themes` | ^0.4.6 | Dark mode toggle (class-based) |
| `react-hook-form` | ^7.55.0 | Form state management |
| `@hookform/resolvers` | ^3.10.0 | Zod integration for form validation |
| `date-fns` | ^3.6.0 | Date formatting |

---

## 2. Design Tokens / Theme

### 2.1 Token Architecture

Tokens are **centralized** via CSS custom properties in `client/src/index.css` and mapped into Tailwind via `tailwind.config.ts`. The app uses a **two-layer system**: CSS variables define semantic color roles, Tailwind config references those variables.

### 2.2 Color Tokens

**Light mode** (`:root` in `client/src/index.css`):

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `hsl(225, 25%, 96%)` | Page background |
| `--foreground` | `hsl(224, 40%, 16%)` | Primary text |
| `--card` | `hsl(0, 0%, 100%)` | Card surfaces |
| `--card-foreground` | `hsl(224, 40%, 16%)` | Card text |
| `--popover` | `hsl(0, 0%, 100%)` | Popover surfaces |
| `--popover-foreground` | `hsl(224, 40%, 16%)` | Popover text |
| `--primary` | `hsl(230, 70%, 56%)` | Primary actions |
| `--primary-foreground` | `hsl(0, 0%, 100%)` | Text on primary |
| `--secondary` | `hsl(225, 20%, 94%)` | Secondary surfaces |
| `--secondary-foreground` | `hsl(224, 30%, 22%)` | Secondary text |
| `--muted` | `hsl(225, 16%, 93%)` | Muted backgrounds |
| `--muted-foreground` | `hsl(220, 10%, 46%)` | Muted text |
| `--accent` | `hsl(225, 30%, 94%)` | Accent highlights |
| `--accent-foreground` | `hsl(224, 30%, 22%)` | Accent text |
| `--destructive` | `hsl(0, 72%, 56%)` | Destructive actions |
| `--destructive-foreground` | `hsl(0, 0%, 100%)` | Text on destructive |
| `--border` | `hsl(225, 15%, 90%)` | Border color |
| `--input` | `hsl(225, 15%, 85%)` | Input borders |
| `--ring` | `hsl(221.2, 83.2%, 53.3%)` | Focus ring |
| `--success` | `hsl(142, 71%, 45%)` | Success feedback |
| `--warning` | `hsl(38, 92%, 50%)` | Warning feedback |
| `--info` | `hsl(199, 89%, 48%)` | Info feedback |
| `--chart-1` | `hsl(221, 83%, 53%)` | Chart color 1 |
| `--chart-2` | `hsl(142, 71%, 45%)` | Chart color 2 |
| `--chart-3` | `hsl(38, 92%, 50%)` | Chart color 3 |
| `--chart-4` | `hsl(280, 65%, 60%)` | Chart color 4 |
| `--chart-5` | `hsl(340, 75%, 55%)` | Chart color 5 |

**Dark mode** (`.dark` in `client/src/index.css`):

| Token | Value |
|-------|-------|
| `--background` | `hsl(0, 0%, 0%)` |
| `--foreground` | `hsl(200, 6.67%, 91.18%)` |
| `--card` | `hsl(228, 9.8%, 10%)` |
| `--card-foreground` | `hsl(0, 0%, 85.1%)` |
| `--popover` | `hsl(0, 0%, 0%)` |
| `--popover-foreground` | `hsl(200, 6.67%, 91.18%)` |
| `--primary` | `hsl(203.77, 87.6%, 52.55%)` |
| `--primary-foreground` | `hsl(0, 0%, 100%)` |
| `--secondary` | `hsl(195, 15.38%, 94.9%)` |
| `--secondary-foreground` | `hsl(210, 25%, 7.84%)` |
| `--muted` | `hsl(0, 0%, 9.41%)` |
| `--muted-foreground` | `hsl(210, 3.39%, 46.27%)` |
| `--accent` | `hsl(210, 50%, 12%)` |
| `--accent-foreground` | `hsl(203.77, 87.6%, 52.55%)` |
| `--destructive` | `hsl(356.3, 90.56%, 54.31%)` |
| `--destructive-foreground` | `hsl(0, 0%, 100%)` |
| `--border` | `hsl(210, 5.26%, 14.9%)` |
| `--input` | `hsl(207.69, 27.66%, 18.43%)` |
| `--ring` | `hsl(202.82, 89.12%, 53.14%)` |

### 2.3 Border Radius

Defined in `tailwind.config.ts` (lines 55-58):

| Token | Value |
|-------|-------|
| `--radius` | `0.5rem` (8px) |
| `lg` | `var(--radius)` = 0.5rem |
| `md` | `calc(var(--radius) - 2px)` = 6px |
| `sm` | `calc(var(--radius) - 4px)` = 4px |

### 2.4 Box Shadows

Custom shadows in `tailwind.config.ts` (lines 93-97):

| Name | Value |
|------|-------|
| `soft` | `0 2px 8px rgba(0, 0, 0, 0.08)` |
| `medium` | `0 4px 16px rgba(0, 0, 0, 0.12)` |
| `hard` | `0 8px 24px rgba(0, 0, 0, 0.16)` |

Standard Tailwind shadows also used: `shadow-sm` (6 uses), `shadow-md` (10 uses), `shadow-lg` (9 uses), `shadow-xl` (1 use), `shadow-soft` (3 uses), `shadow-hard` (1 use).

### 2.5 Z-Index

Only two explicit z-index values found:
- `z-[1]` -- `client/src/components/ui/navigation-menu.tsx:107`
- `z-[100]` -- `client/src/components/ui/toast.tsx:17` (ToastViewport)
- `z-50` -- `client/src/components/ui/dialog.tsx` (DialogOverlay and DialogContent)

All other z-index management is handled by Radix UI portals.

### 2.6 Hardcoded Colors (Outside Token System)

**`client/src/lib/default-colors.ts`** -- Defines a high-contrast palette of 14 hex colors (lines 12-27) used for user-configurable status/type/destination badges:
- `#2563EB`, `#4F46E5`, `#7C3AED`, `#C026D3`, `#DB2777`, `#E11D48`, `#DC2626`, `#EA580C`, `#D97706`, `#16A34A`, `#059669`, `#0D9488`, `#0284C7`, `#475569`

These are intentionally outside the theme system because they are user-customizable per office.

**Inline `style=` hardcoded colors (not using CSS variables):**
- `client/src/components/jobs-table.tsx:1223` -- `color: 'hsl(221 83% 53%)'` (linked jobs indicator)
- `client/src/components/jobs-table.tsx:1248` -- `backgroundColor: 'hsl(38 92% 50% / 0.15)'` (redo badge)
- `client/src/components/jobs-table.tsx:1260` -- `backgroundColor: 'hsl(0 84% 60% / 0.15)'` (overdue badge)
- `client/src/components/job-details-modal.tsx:487,530` -- `backgroundColor: 'hsl(0 84% 60% / 0.15)'` (overdue badge)
- `client/src/components/sentry-error-boundary.tsx:21,27-34` -- `color: "#666"`, `border: "1px solid #ccc"`, `background: "#fff"` (error boundary fallback, inline styles)
- `client/src/components/job-message-templates-modal.tsx:70` -- default color fallback `"#64748B"`

**Badge color fallback** (repeated in 4 files): `{ background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' }`

### 2.7 Sidebar CSS Variables

Defined in `client/src/components/ui/sidebar.tsx` (lines 140-145):

| Variable | Value |
|----------|-------|
| `--sidebar-width` | `16rem` (256px) |
| `--sidebar-width-icon` | `3rem` (48px) |
| `--sidebar-width-mobile` | `18rem` (288px) |

The custom sidebar (`client/src/components/sidebar.tsx`) uses `w-20` (80px) collapsed and `w-64` (256px) expanded, which does **not** match the shadcn sidebar CSS variables above.

---

## 3. Layout Patterns

### 3.1 App Shell

**File:** `client/src/App.tsx`

```
SentryErrorBoundary
  QueryClientProvider
    AuthProvider
      SessionTimeoutProvider
        TooltipProvider
          Toaster (global)
          SyncManager (WebSocket)
          Router (wouter)
            Switch
              ProtectedRoute "/" -> Dashboard
              ProtectedRoute "/dashboard/:tab?" -> Dashboard
              ProtectedRoute "/important" -> Dashboard
              Route "/auth" -> AuthPage
              Route * -> NotFound
```

### 3.2 Dashboard Layout

**File:** `client/src/pages/dashboard.tsx`

```
div.flex.h-screen.bg-background.pb-[33px]
  Sidebar (left, collapsible)
  div.flex-1.flex.flex-col.overflow-hidden
    header.h-14.border-b.bg-card.px-6 (top bar)
      Left: Tab title text
      Right: NotificationBell + User dropdown (avatar + name)
    main.flex-1.overflow-y-auto.p-6.pb-8
      {active tab content}
    Modals (settings, health, user-settings, feedback)
```

### 3.3 Sidebar

**File:** `client/src/components/sidebar.tsx`

- **Collapsed:** `w-20` (80px), icon-only with tooltip labels
- **Expanded:** `w-64` (256px), icons + text labels + badges
- **Transition:** `transition-[width] duration-200`
- **State persistence:** `localStorage` key `otto.sidebar.collapsed`
- **Structure:**
  - Logo + office name (h-14 header)
  - Nav items: Worklist, Important, Past Jobs, Overdue, Analytics (with divider), Team
  - Active indicator: `border-l-[3px] border-l-primary bg-accent`
  - Badge counts fetched via React Query
  - Footer: User Settings, Help & Feedback buttons

### 3.4 Responsive Behavior

- **Mobile breakpoint:** 768px (`client/src/hooks/use-mobile.tsx:3`)
- **Tailwind breakpoints used:** `sm:` (640px), `md:` (768px), `lg:` (1024px)
- **Auth page:** Single column on mobile, two-column grid at `lg:` (`grid-cols-[1.05fr_0.95fr]`)
- **Dialog footer:** Stacked vertically on mobile (`flex-col-reverse`), horizontal at `sm:` (`sm:flex-row`)
- **Sheet width:** `w-3/4` on mobile, `sm:max-w-sm` on desktop
- **Admin page:** `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- **No responsive sidebar collapse** -- sidebar collapse is manual (click/keyboard), not breakpoint-driven

### 3.5 Navigation Model

- **Primary:** Collapsible sidebar with icon + text navigation items
- **Secondary:** URL-based tab routing via `wouter` (`/dashboard/:tab?`)
- **Tertiary:** Tabs within modals (job details: Overview/Comments/Related; settings: multiple config tabs)
- **Modals:** Triggered by React state, rendered via Radix Dialog portals
- **No breadcrumbs** in active use (component exists in ui/ but unused in feature code)

---

## 4. Typography

### 4.1 Font Family

**System font stack** defined as CSS variable in `client/src/index.css:34`:
```css
--font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
```

Mapped in `tailwind.config.ts:59`: `fontFamily: { sans: ["var(--font-sans)"] }`

Applied at body level: `@apply font-sans antialiased` (`client/src/index.css:65`)

No Google Fonts. No custom font files. No `@font-face` declarations. No monospace or serif fonts used.

### 4.2 Font Sizes

Distribution across all TSX files:

| Class | Tailwind Size | Occurrences |
|-------|---------------|-------------|
| `text-xs` | 0.75rem (12px) | 142 |
| `text-sm` | 0.875rem (14px) | 221 |
| `text-base` | 1rem (16px) | 5 |
| `text-lg` | 1.125rem (18px) | 32 |
| `text-xl` | 1.25rem (20px) | 4 |
| `text-2xl` | 1.5rem (24px) | 11 |
| `text-3xl` | 1.875rem (30px) | 11 |
| `text-4xl` | 2.25rem (36px) | 1 |

The app heavily skews toward `text-sm` (14px) and `text-xs` (12px), which together account for 84% of all font-size declarations. `text-base` (the browser default 16px) is rarely used (5 instances).

**Hardcoded font sizes:** `fontSize: 12` appears in recharts tick configuration (`analytics-dashboard.tsx:812,847,879`). `fontSize: "1.5rem"` and `fontSize: "1rem"` appear in the Sentry error boundary fallback (`sentry-error-boundary.tsx:18,28`).

### 4.3 Font Weights

| Class | Occurrences |
|-------|-------------|
| `font-medium` (500) | 117 |
| `font-semibold` (600) | 68 |
| `font-bold` (700) | 22 |
| `font-normal` (400) | 6 |

`font-medium` dominates. `font-light` and `font-thin` are never used.

### 4.4 Line Height & Letter Spacing

| Class | Occurrences |
|-------|-------------|
| `leading-none` (1) | 12 |
| `leading-tight` (1.25) | 2 |
| `leading-relaxed` (1.625) | 1 |
| `tracking-wide` | 7 |
| `tracking-tight` | 5 |
| `tracking-widest` | 4 |

### 4.5 Notable Typography Patterns

- **Card titles:** `text-2xl font-semibold leading-none tracking-tight` (`card.tsx:39`)
- **Buttons:** `text-sm font-medium` (`button.tsx`)
- **Badges:** `text-xs font-semibold` (`badge.tsx`)
- **Table headers:** `text-sm font-medium` (via muted-foreground)
- **Table cells:** `text-sm` default
- **Section headings in modals:** `text-lg font-semibold`
- **User-configurable font size:** `user-settings-modal.tsx` exposes a slider that applies a dynamic `fontSize` CSS property

---

## 5. Spacing and Alignment

### 5.1 Spacing Scale

The app uses Tailwind's default 4px-based spacing scale. No custom spacing tokens are defined in `tailwind.config.ts`.

### 5.2 Common Spacing Values

**Gap values (flex/grid gap):**
| Class | Occurrences |
|-------|-------------|
| `gap-1` (4px) | 26 |
| `gap-2` (8px) | 41 |
| `gap-3` (12px) | 31 |
| `gap-4` (16px) | 11 |

**Vertical spacing (space-y):**
| Class | Occurrences |
|-------|-------------|
| `space-y-2` (8px) | 16 |
| `space-y-3` (12px) | 11 |
| `space-y-4` (16px) | 14 |
| `space-y-6` (24px) | 9 |

### 5.3 Container Padding Patterns

| Context | File | Padding |
|---------|------|---------|
| Dashboard main content | `dashboard.tsx` | `p-6 pb-8` |
| Jobs table header row | `jobs-table.tsx:789` | `px-5 py-3` |
| Jobs table toolbar | `jobs-table.tsx:817` | `px-5 py-2` |
| Jobs table cells | `jobs-table.tsx:1078` | `px-2.5 py-2` |
| Past jobs card header | `past-jobs.tsx:247` | `p-6 pb-4` |
| Loading state card content | `jobs-table.tsx:778` | `p-8` |
| Metric cards | `analytics-dashboard.tsx` | `p-4` |
| Health modal cards | `health-modal.tsx` | `p-4` |
| Empty state containers | Various | `p-8`, `py-16` |
| Notification rules | `notification-rules.tsx` | Mixed `p-8` and `p-4` |

### 5.4 Page-Level Section Spacing

Most page-level components use `space-y-6` (24px) as the vertical gap between sections:
- `analytics-dashboard.tsx` -- `space-y-6`
- `team-page.tsx` -- `space-y-6`
- `notification-rules.tsx` -- `space-y-6`

---

## 6. State Feedback

### 6.1 Loading States

| Pattern | Location | UI |
|---------|----------|----|
| Skeleton placeholders | `notification-bell.tsx:156-167` | Array of `<Skeleton>` elements matching content layout |
| Spinner icon | Multiple files (15 instances of `animate-spin`) | `<Loader2 className="animate-spin" />` from lucide-react |
| Button pending text | `overdue-jobs.tsx:349` | Button text changes from "Add Note" to "Adding..." while `isPending` |
| Button disabled during mutation | Various | `disabled={mutation.isPending}` prevents double-submission |
| Full-page loading | `lib/protected-route.tsx` | Centered `Loader2` spinner while auth state resolves |

### 6.2 Empty States

| Context | File:Lines | UI |
|---------|------------|----|
| Overdue jobs | `overdue-jobs.tsx:139-150` | Green `CheckCircle2` icon + "All caught up!" + descriptive text. `py-16` centered. `data-testid="overdue-jobs-empty"` |
| Notifications | `notification-bell.tsx:168-175` | Bell icon at `opacity-20` + "No notifications". `p-8 text-center` |
| Filtered table (no matches) | `overdue-jobs.tsx:225-229` | Single table row spanning all columns. `h-24 text-center text-muted-foreground` |
| Past jobs | `past-jobs.tsx:307,314` | Clipboard icon + "No Past Jobs" message. `p-8` |

### 6.3 Error Handling

| Pattern | Implementation | Styling |
|---------|---------------|---------|
| **Toast (destructive)** | `toast({ title: "Error", description: error.message, variant: "destructive" })` | Red border + background via `variant="destructive"` class |
| **Error boundary** | `sentry-error-boundary.tsx` | Inline-styled fallback: "Something went wrong" + retry button. Not using Tailwind. |
| **Form validation** | `react-hook-form` + Zod | `<FormMessage>` renders below fields in `text-sm font-medium text-destructive` |
| **Alert component** | `alert.tsx` (destructive variant) | `border-destructive/50 text-destructive` |

Toast errors are the primary error feedback mechanism. Used in: `jobs-table.tsx` (4 mutation error handlers), `overdue-jobs.tsx` (2), `import-template-select.tsx` (1), and others.

### 6.4 Success Feedback

All success feedback uses the default (non-destructive) toast variant:

| Context | File | Message |
|---------|------|---------|
| Job updated | `jobs-table.tsx:168` | "Success" / "Job updated successfully." |
| Job deleted | `jobs-table.tsx:202` | "Success" / "Job deleted successfully." |
| Bulk update | `jobs-table.tsx:224` | "Success" / "Updated N job(s)" |
| Bulk delete | `jobs-table.tsx:243` | "Success" / "Deleted N job(s)" |
| Status change | `overdue-jobs.tsx:69` | "Status updated" / "Job status has been changed." |
| Note added | `overdue-jobs.tsx:90` | "Note added" / "Your note has been saved." |

### 6.5 Disabled States

- Buttons: `disabled` prop triggers `disabled:pointer-events-none disabled:opacity-50` (defined in `button.tsx` CVA)
- Toast action: `disabled:pointer-events-none disabled:opacity-50` (`toast.tsx:63`)
- Select items: `disabled` prop prevents selection (e.g., already-mapped fields in `import-mapping-step.tsx:188`)
- Conditional rendering: Some buttons only render when conditions are met rather than showing disabled state

### 6.6 Connection Status

- `sync-manager.tsx` maintains WebSocket `connected` state
- `WifiOff` icon imported for disconnect indication
- Auto-reconnect with exponential backoff (max 10s)

### 6.7 Info Banners

- `import-mapping-step.tsx:205-220` -- Custom blue info banner: `border-blue-200 bg-blue-50 text-blue-700` with `Info` icon. Not using the `Alert` component.

---

## 7. Animation / Transitions

### 7.1 Animation Library

**Primary:** `tailwindcss-animate` plugin (Tailwind-native animation utilities).
**Secondary:** Radix UI built-in animations via `data-[state=open]` / `data-[state=closed]` attributes.
**Note:** `framer-motion` is listed as a dependency (`^11.13.1`) but is **not imported or used** in any component file.

### 7.2 Custom Keyframes

Defined in `tailwind.config.ts` (lines 61-92) and `client/src/index.css` (lines 61-126):

| Name | Duration | Easing | Description |
|------|----------|--------|-------------|
| `accordion-down` | 0.2s | ease-out | Height 0 -> full |
| `accordion-up` | 0.2s | ease-out | Height full -> 0 |
| `fadeIn` | 0.3s | ease-in-out | Opacity 0->1 + translateY(10px)->0 |
| `slideInRight` | 0.3s | ease-out | translateX(100%)->0 |

### 7.3 Animation Usage

| Class | Occurrences | Used In |
|-------|-------------|---------|
| `animate-in` | 21 | Dialog, sheet, toast, popover, select, tooltip, dropdown, context-menu |
| `animate-out` | 20 | Same as above (exit animations) |
| `animate-spin` | 15 | Loading spinners (`Loader2` icon) |
| `animate-fade-in` | 3 | Custom fade-in |
| `animate-pulse` | 1 | Skeleton loading placeholder |
| `animate-slide-in-right` | 1 | Slide-in panel |
| `animate-caret-blink` | 1 | OTP input cursor |

### 7.4 Transition Classes

| Class | Occurrences |
|-------|-------------|
| `transition-colors` | 20 |
| `transition-all` | 8 |
| `transition-transform` | 4 |
| `transition-shadow` | 4 |
| `transition-opacity` | 3 |
| `duration-200` | 8 (most common) |
| `duration-300` | 1 |
| `duration-500` | 1 |

### 7.5 Dialog/Popover Animations

Standard pattern for overlays (`dialog.tsx`, `sheet.tsx`, `popover.tsx`, etc.):
- **Enter:** `animate-in fade-in-0 zoom-in-95` + directional `slide-in-from-*`
- **Exit:** `animate-out fade-out-0 zoom-out-95` + directional `slide-out-to-*`
- **Overlay:** `fade-in-0` / `fade-out-0`
- **Sheet:** `duration-300` (close), `duration-500` (open)

---

## 8. Accessibility

### 8.1 ARIA Attributes

**`aria-label`** (13+ instances):
- Sidebar navigation buttons: `client/src/components/sidebar.tsx:160,189,243,267,291,316`
- Auth page dismiss buttons: `client/src/pages/auth-page.tsx:396,412`
- Pagination: `client/src/components/ui/pagination.tsx:10,67,83`
- Breadcrumb nav: `client/src/components/ui/breadcrumb.tsx:12`
- Sidebar toggle: `client/src/components/ui/sidebar.tsx:306`

**`aria-expanded`:**
- `client/src/components/job-dialog.tsx:590` -- combobox for original job selection

**`aria-describedby` + `aria-invalid`:**
- `client/src/components/ui/form.tsx:116-121` -- Form fields auto-associate error/description IDs

**`aria-hidden`:**
- Breadcrumb separators (`breadcrumb.tsx:82,97`), navigation chevron (`navigation-menu.tsx:59`), pagination ellipsis (`pagination.tsx:99`)

**`aria-current`:**
- Breadcrumb current page (`breadcrumb.tsx:68`), pagination active page (`pagination.tsx:49`)

**`aria-roledescription`:**
- Carousel: "carousel" on container, "slide" on items (`carousel.tsx:140,183`)

### 8.2 Roles

| Role | File |
|------|------|
| `role="combobox"` | `job-dialog.tsx:589` |
| `role="alert"` | `alert.tsx:28` |
| `role="link"` | `breadcrumb.tsx:66` (disabled current page) |
| `role="presentation"` | `breadcrumb.tsx:81,96` (separators) |
| `role="region"` | `carousel.tsx:139` |
| `role="group"` | `carousel.tsx:182` |
| `role="separator"` | `input-otp.tsx:63` |
| `role="navigation"` | `pagination.tsx:9` |

### 8.3 Keyboard Navigation

- **Sidebar toggle:** `Ctrl+B` / `Cmd+B` (`client/src/components/ui/sidebar.tsx:31`)
- **Comment submission:** `Enter` to send, `Shift+Enter` for newline (`job-comments-panel.tsx:374`)
- **Group note submission:** `Cmd+Enter` / `Ctrl+Enter` (`job-details-modal.tsx:610`)
- **Carousel:** `onKeyDownCapture` for arrow key navigation (`carousel.tsx:137`)
- All Radix UI primitives provide built-in keyboard navigation (arrow keys in menus, Escape to close, Tab to move focus)

### 8.4 Focus Management

- Consistent pattern: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- Applied to: buttons, checkboxes, inputs, radio groups, sliders, switches, tabs, toggles, textareas, resizable handles (12+ component files)
- `focus-within` used in calendar cells and sidebar menu items
- `tabIndex={-1}` on sidebar rail toggle (`sidebar.tsx:307`)

### 8.5 Screen Reader Support

`sr-only` class used in 7 files:
- Dialog close button text (`dialog.tsx:49`)
- Sheet close button text (`sheet.tsx:70`)
- Carousel prev/next button labels (`carousel.tsx:218,247`)
- Pagination "More pages" (`pagination.tsx:104`)
- Sidebar toggle label (`sidebar.tsx:290`)
- Breadcrumb "More" ellipsis (`breadcrumb.tsx:102`)
- Settings template labels (`settings-modal.tsx:918`)

### 8.6 HTML Lang

`<html lang="en">` -- set in `client/index.html:2`.

### 8.7 Notable Gaps

- **No skip navigation link** -- no mechanism to skip sidebar and jump to main content
- **No `aria-live` regions** -- toast notifications, real-time sync updates, and dynamic content changes have no explicit live regions (Radix Toast may handle this internally)
- **No alt text audit needed** -- only one `<img>` tag exists (`sidebar.tsx:140`, `alt="Otto"` -- present)

---

## 9. Visual Inconsistencies

### 9.1 Duplicate Badge Color Logic

The functions `getStatusBadgeColor()`, `getTypeBadgeColor()`, and `getDestinationBadgeColor()` are **implemented independently in 4 files** rather than shared:

| File | Functions | Notes |
|------|-----------|-------|
| `client/src/components/jobs-table.tsx:605-694` | All 3 | Uses memoized arrays from parent scope |
| `client/src/components/past-jobs.tsx:176-230` | All 3 | Fetches from `office?.settings` inline (less efficient) |
| `client/src/components/job-details-modal.tsx:178-212` | All 3 (named `getJobTypeBadgeColor`) | Uses parent scope + different destination logic |
| `client/src/pages/important-jobs.tsx:134-160` | All 3 | Same fallback pattern |

All share the same fallback: `{ background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' }`.

### 9.2 Inconsistent Container Padding

Similar card containers use different padding values:
- Metric cards: `p-4` (`analytics-dashboard.tsx`, `health-modal.tsx`)
- Empty state cards: `p-8` (`jobs-table.tsx:778`, `past-jobs.tsx:307`, `notification-rules.tsx`)
- Table header: `px-5 py-3` (`jobs-table.tsx:789`)
- Table toolbar: `px-5 py-2` (`jobs-table.tsx:817`)
- Past jobs header: `p-6 pb-4` (`past-jobs.tsx:247`)

### 9.3 Info Banner Style Divergence

`import-mapping-step.tsx:205-220` uses a custom blue info banner with hardcoded Tailwind color classes (`border-blue-200 bg-blue-50 text-blue-700`) instead of the existing `Alert` component from `ui/alert.tsx`. The Alert component's "default" variant uses theme tokens (`bg-background text-foreground`), which is visually different.

### 9.4 Error Boundary Styling

`sentry-error-boundary.tsx` uses **inline `style=` attributes** with hardcoded values (`color: "#666"`, `border: "1px solid #ccc"`, `background: "#fff"`, `borderRadius: "6px"`) instead of Tailwind classes. This bypasses the theme system entirely and will not respond to dark mode.

### 9.5 Icon Size Inconsistencies

Primary icon sizes and their frequency:

| Size | Occurrences | Typical Context |
|------|-------------|-----------------|
| `h-4 w-4` | 92 | General UI icons |
| `h-5 w-5` | 23 | Metric card icons, primary accents |
| `h-3.5 w-3.5` | 19 | Small toolbar buttons |
| `h-3 w-3` | 16 | Comment/detail contexts |
| `h-6 w-6` | 5 | Large icons |
| `h-7 w-7` | 4 | Overdue checkmark |
| `h-8 w-8` | 7 | Loading spinners, modal icons |

**Asymmetric icon dimensions** (width != height):
- `jobs-table.tsx`: `h-5 w-2`, `h-4 w-6`, `h-4 w-2`, `h-8 w-5`, `h-7 w-3`
- `overdue-jobs.tsx`: `h-8 w-4`
- `notification-bell.tsx`: `h-3 w-1`

These appear to be intentional for specific visual effects (narrow indicators, wide badges) but are non-standard.

### 9.6 Button Size Overrides

Some buttons use `size="sm"` from the Button CVA but then override with explicit height classes:
- `jobs-table.tsx:802-810`: `size="sm" className="h-8 text-xs"` (explicit height + smaller text)
- `import-template-select.tsx:127`: `size="sm"` alone (no override)

The Button component's `sm` variant already defines sizing, so the `h-8 text-xs` overrides create a non-standard variant.

### 9.7 Unused shadcn Sidebar System

The full shadcn `SidebarProvider` system exists in `client/src/components/ui/sidebar.tsx` (with context, cookie persistence, CSS variables, mobile sheet behavior) but is **not used**. The app uses a completely custom sidebar implementation in `client/src/components/sidebar.tsx` with its own localStorage-based state management and different width values (`w-20`/`w-64` vs `--sidebar-width: 16rem`/`--sidebar-width-icon: 3rem`).

### 9.8 Unused Framer Motion

`framer-motion` (`^11.13.1`) is listed in `package.json` dependencies but is not imported or used in any component file.

### 9.9 Table Cell Padding

`jobs-table.tsx:1078` uses `[&_th]:px-2.5 [&_th]:py-2` -- the `2.5` (10px) is a non-standard spacing value that doesn't align with the 4px grid (which would be `px-2` = 8px or `px-3` = 12px).

---

## 10. Key Screen Descriptions

### 10.1 Dashboard / Worklist (Default View)

**Route:** `/` or `/dashboard/all`

**Layout:** Full-screen, two-panel horizontal split.
- **Left:** Collapsible sidebar (80px collapsed, 256px expanded). Logo at top, 6 navigation items with icon + label + badge count, settings/help buttons at bottom.
- **Right:** Flex column filling remaining width.
  - **Header bar** (56px): Tab title on left, notification bell + user avatar dropdown on right.
  - **Content area** (remaining height, scrollable, `p-6` padding): Contains the active tab's content.

**Worklist tab content** (`jobs-table.tsx`):
- **Card** containing:
  - **Primary toolbar row:** Search input (left), "Import from EHR" button (outline) + "New Job" button (primary) on right.
  - **Secondary toolbar row:** Filters button with active filter count badge. When expanded: dropdowns for Status, Type, Destination + Overdue checkbox + custom column filters.
  - **Table:** Fixed header row (`bg-muted/50`). Columns: Star (flag), Patient/Tray, Job Type (colored badge), Status (colored badge), Destination (colored badge), Days Since, Notes (truncated), Order Date, Actions (dropdown menu). Horizontal scroll if content overflows.
  - **Select mode toolbar** (conditional): Selection count, Link Jobs button, bulk status dropdown, bulk delete button (red/destructive).

### 10.2 Important Jobs

**Route:** `/important`

**Layout:** Same dashboard shell. Content area shows:
- **Card** with flagged jobs list
- Each row: Patient name, status badge, type badge, destination badge, flag note, date flagged
- Click to open job details modal

### 10.3 Overdue Jobs

**Route:** `/dashboard/overdue`

**Layout:** Same dashboard shell. Content area shows:
- **4 severity stat cards** in a horizontal row (grid): Critical (red), High (orange), Medium (blue), Low (green). Each shows count + days-overdue range. Clickable to filter.
- **Threshold info line** below cards showing configured rules.
- **Filtered table:** Severity dot, Patient, Type, Status, Destination, Days Overdue, Actions.
- **Empty state:** Large green checkmark + "All caught up!" + description text, centered with generous padding (`py-16`).

### 10.4 Past Jobs

**Route:** `/dashboard/past`

**Layout:** Same dashboard shell. Content area shows:
- **Card header:** "Past Jobs" title + "Total Completed: N" stat on right.
- **Filter row:** Search input + date range dropdown (with presets: Last 7 days, 30 days, etc.) + status filter.
- **Table:** Patient, Job Type (badge), Destination (badge), Final Status (checkmark/X icon + badge), Completed Date + time, Original Date, Actions. Alternating row backgrounds (`even:bg-muted/30`).
- **Empty state:** Clipboard icon + "No Past Jobs" message.

### 10.5 Analytics

**Route:** `/dashboard/analytics`

**Layout:** Same dashboard shell. Content area shows:
- **Date range picker** at top (calendar popover with presets).
- **4 metric cards** in a row: Submitted, Completed (+ redo rate), Cancelled (+ cancellation rate), Avg Completion Time (+ median + P90).
- **2x2 chart grid:**
  - Top-left: "Backlog by status" donut chart (240px) + legend
  - Top-right: "Jobs created by type" bar chart (300px)
  - Bottom-left: "Jobs created by destination" bar chart (300px)
  - Bottom-right: "Avg completion time by type" bar chart (300px)

### 10.6 Team

**Route:** `/dashboard/team`

**Layout:** Same dashboard shell. Content area shows:
- **Info card** about onboarding process (clock icon + description).
- **Pending Account Requests card** (conditional): Destructive badge with count. Each request row: name, login ID, timestamp, optional message, role dropdown, Approve (green) / Reject (outline) buttons.
- **Pending PIN Resets card** (conditional): KeyRound icon, destructive badge. Approve/Reject buttons.
- **Team Members section:** Users icon + "Team Members" title + count badge. Card per member: avatar circle with initials, name, login ID, role dropdown + delete button.
- **Empty state:** Users icon + "No Team Members" + explanatory text.

### 10.7 Auth Page

**Route:** `/auth`

**Layout:** Gradient background (`from-background via-primary/5 to-accent/10`). Centered container (`max-w-6xl`).
- **Desktop (`lg:`):** Two-column grid.
  - **Left column:** Glasses icon badge, "Otto Tracker Desktop" label, welcome heading, description card with station mode info.
  - **Right column:** Card (`min-h-[480px]`) with:
    - Header: Title + "Request a new account" toggle button.
    - Form area (scrollable): Sign-in form (Login ID + PIN inputs + "Unlock with PIN" button + "Forgot PIN?" link) OR Registration form (first/last name 2-col grid + Login ID + PIN + confirm PIN + submit button).
- **Mobile:** Single column, stacked (left column hidden or stacked above).

### 10.8 Job Details Modal

**Trigger:** Double-click table row or Actions menu.
**Size:** `max-w-5xl` (1280px), `h-[86vh]`.

**Layout:**
- **Header:** Patient/Tray name (large), created date, row of colored badges (Status, Type, Destination, optional Redo), Edit button (top-right).
- **Tab bar:** 2-3 tabs (Overview, Comments, Related Jobs). Grid layout, active tab highlighted with primary color + shadow.
- **Tab content** (fills remaining space):
  - **Overview:** Job fields, status history timeline, notes.
  - **Comments:** Threaded comment list with textarea input (Enter to send).
  - **Related Jobs** (conditional): Linked job cards.

### 10.9 Settings Modal

**Trigger:** User dropdown menu > "Office Settings".
**Size:** Default dialog width (`max-w-lg` or wider).

**Layout:**
- **Header:** Settings icon + "Office Settings" title.
- **Tab bar:** Statuses, Job Types, Destinations, Custom Columns, Notification Rules, PIN Management, Invite Code.
- **Tab content:**
  - **Statuses/Types/Destinations:** Sortable list of items. Each row: drag handle (left), label input (center), color picker square (right), delete button (right). "Add" button below. Drag-and-drop reordering.
  - **Custom Columns:** Column name input, type dropdown, active toggle.
  - **Notification Rules:** Switch toggles, selects, table of rules.
  - **PIN Management:** Reset controls.
  - **Invite Code:** Code display with copy button, expiration info.

### 10.10 Not Found (404)

**Route:** `*` (catch-all)

**Layout:** Full screen centered (`min-h-screen flex items-center justify-center`).
- **Card** (`max-w-md`): AlertCircle icon + "404 Page Not Found" heading + description text.

---

## Appendix: File Index

### Pages
- `client/src/pages/dashboard.tsx`
- `client/src/pages/auth-page.tsx`
- `client/src/pages/important-jobs.tsx`
- `client/src/pages/admin.tsx`
- `client/src/pages/not-found.tsx`

### Feature Components
- `client/src/components/sidebar.tsx`
- `client/src/components/jobs-table.tsx`
- `client/src/components/job-dialog.tsx`
- `client/src/components/job-details-modal.tsx`
- `client/src/components/job-comments-panel.tsx`
- `client/src/components/comments-sidebar.tsx`
- `client/src/components/overdue-jobs.tsx`
- `client/src/components/past-jobs.tsx`
- `client/src/components/analytics-dashboard.tsx`
- `client/src/components/team-page.tsx`
- `client/src/components/notification-bell.tsx`
- `client/src/components/notification-rules.tsx`
- `client/src/components/settings-modal.tsx`
- `client/src/components/user-settings-modal.tsx`
- `client/src/components/health-modal.tsx`
- `client/src/components/import-wizard.tsx`
- `client/src/components/import-template-select.tsx`
- `client/src/components/import-mapping-step.tsx`
- `client/src/components/people-modal.tsx`
- `client/src/components/job-message-templates-modal.tsx`
- `client/src/components/feedback-dialog.tsx`
- `client/src/components/sync-manager.tsx`
- `client/src/components/sentry-error-boundary.tsx`
- `client/src/components/session-timeout-provider.tsx`

### UI Primitives
- `client/src/components/ui/` (46 files -- see Section 1.1)

### Styling/Config
- `client/src/index.css` (CSS variables, scrollbar styles, utility classes)
- `tailwind.config.ts` (theme extensions, animations, shadows)
- `postcss.config.js` (Tailwind + Autoprefixer)

### Hooks
- `client/src/hooks/use-auth.tsx`
- `client/src/hooks/use-toast.ts`
- `client/src/hooks/use-mobile.tsx`

### Utilities
- `client/src/lib/utils.ts` (`cn()` helper)
- `client/src/lib/queryClient.ts` (API fetch + React Query config)
- `client/src/lib/default-colors.ts` (badge color palette + defaults)
- `client/src/lib/protected-route.tsx` (auth guard)
