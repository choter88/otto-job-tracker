# Otto Tracker Design Guidelines

## Design Approach: Medical Productivity System
**Framework**: Drawing from Linear's precision, Apple HIG's clarity, and medical UI best practices. Professional, efficient, and accessible for high-volume optical practice workflows.

## Core Design Elements

### A. Color Palette

**Light Mode:**
- Background: 0 0% 100% (pure white)
- Surface: 0 0% 98% (cards, panels)
- Border: 220 13% 91%
- Text Primary: 222 47% 11%
- Text Secondary: 215 16% 47%

**Dark Mode:**
- Background: 224 71% 4%
- Surface: 217 33% 10%
- Border: 217 33% 17%
- Text Primary: 213 31% 91%
- Text Secondary: 215 20% 65%

**Status Colors** (Default assignments):
- New Orders: 217 91% 60% (clear blue)
- In Progress: 38 92% 50% (warm amber)
- Ready: 142 76% 36% (success green)
- Delivered: 262 83% 58% (completion purple)
- Cancelled: 0 84% 60% (alert red)

**Job Type Colors**:
- Standard: 220 13% 60% (neutral slate)
- Rush: 25 95% 53% (urgent orange)
- Insurance: 199 89% 48% (info blue)
- Warranty: 283 39% 53% (service purple)

### B. Typography
**Font Stack**: Inter (via Google Fonts)
- Display (Job IDs, Headers): 600 weight, tracking-tight
- Body (Job details): 400 weight, text-sm
- Labels: 500 weight, text-xs, uppercase tracking-wide
- Metrics (if any): 700 weight, tabular-nums

### C. Layout System
**Spacing Primitives**: Use 2, 3, 4, 6, 8, 12 units
- Component padding: p-4 to p-6
- Section spacing: space-y-6 to space-y-8
- Card gaps: gap-4
- Tight groupings: space-y-2 to space-y-3

**Grid Structure**:
- Main container: max-w-7xl mx-auto px-4
- Job cards: Single column on mobile, grid-cols-1 lg:grid-cols-2 for side-by-side comparison views
- Table layouts: Full-width with sticky headers

### D. Component Library

**Navigation**:
- Top bar: Fixed height h-16, border-b, contains logo + main tabs
- Tab pills: Rounded-full, px-4 py-2, active state with solid background using primary color
- No separate Dashboard - "All Jobs" is default view with inline filters

**Job Cards/Rows**:
- Elevated surface with subtle border, rounded-lg
- Left accent bar (4px width) matching status color
- Compact header: Job ID (bold) + Patient name + Creation date
- Status badge: Rounded-full px-3 py-1 with status color background at 15% opacity, text at full saturation
- Type badge: Outline variant, rounded-md, subtle
- Action buttons: Ghost variant, icon-only, h-8 w-8

**Enhanced Comment System**:
- Thread view: Nested with left border indicators (2px)
- Comment composer: Floating at bottom when active, rounded-xl with shadow-lg
- Quick actions: @mention dropdown, emoji picker, file attachment (icons only)
- Comment bubbles: Background tint based on user role (staff vs. doctor), rounded-2xl
- Timestamps: Relative (e.g., "2h ago"), text-xs text-muted

**Modals** (Fixed sizing):
- Small (Job details): max-w-lg
- Medium (Edit forms): max-w-2xl  
- Large (Multi-step workflows): max-w-4xl
- All modals: rounded-xl, p-6, backdrop blur

**Filters & Search**:
- Persistent filter bar: Sticky below nav, bg-surface, border-b
- Multi-select dropdowns: Checkbox groups with "Apply" button
- Search: Full-width on mobile, w-72 on desktop, with kbd shortcuts hint
- Active filters: Dismissible pills with x button

**Data Display**:
- Priority 1: Table view with sortable columns, sticky header
- Priority 2: Kanban board with status columns (drag-drop zones)
- Empty states: Icon + heading + descriptive text + primary CTA

**Optical-Specific Elements**:
- Prescription viewer: Monospace font for Rx values, grid layout for OD/OS
- Lens options: Visual selectors with thumbnails (coating types, tints)
- Frame visualization: Image placeholder with overlay specs

### E. Interactions
**Micro-interactions** (Minimal):
- Status change: 200ms color transition
- Card hover: Subtle shadow lift, no scale transform
- Success actions: Green checkmark fade-in (500ms)
- Loading: Skeleton screens, not spinners

**Keyboard Navigation**:
- Tab focus: 2px ring-offset with status color ring
- Shortcuts displayed: Subtle kbd tag styling (bg-muted, rounded, text-xs)

## Accessibility & Polish
- All interactive elements: min-height h-10 (40px touch target)
- Color contrast: AAA for text, AA for UI components
- Focus indicators: Always visible, never hidden
- Modal traps: Proper focus management with escape key support
- Dark mode: Consistently applied to all components including form inputs, dropdowns, and popovers

## No Images Required
This is a data-centric application interface - no hero sections or decorative imagery needed. Focus on clarity, speed, and information density.