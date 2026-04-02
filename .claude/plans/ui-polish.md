# UI/UX Polish Plan

## 1. Header / Sidebar Alignment (Hard Constraint)

**Problem:** The sidebar header row (`h-14` = 56px) and the main content header (`px-6 py-4` = variable height based on content) are different heights, causing a visible horizontal misalignment at the top border.

**Fix:** Set both to the same fixed height. The sidebar header is `h-14` (56px). Change the main content `<header>` to also use `h-14` with `items-center` so the two top rows match perfectly. Remove `py-4` and use fixed height instead.

**Files:** `client/src/pages/dashboard.tsx`

---

## 2. Sidebar Expand/Collapse

**Problem:** The sidebar is only expandable by clicking the logo icon when collapsed. There's no visible affordance (like a small arrow or toggle handle at the edge) to indicate it's expandable — users think it's stuck collapsed.

**Fix:** When collapsed, add a small expand chevron/arrow at the bottom of the sidebar (or at the edge) that's always visible. Also allow clicking anywhere in the collapsed sidebar header area to expand. Keep the current logo-click behavior too.

**Files:** `client/src/components/sidebar.tsx`

---

## 3. Help & Feedback Button Vertical Centering

**Problem:** The Help & Feedback button sits in a `py-2 px-2` bottom section with `border-t`. It's only 10px tall visually with minimal padding, making it feel cramped against the footer/bottom of the window.

**Fix:** Change the bottom container to use `py-3` for more breathing room, and ensure the button is vertically centered in its tile. The `h-10` button height plus `py-3` padding gives a comfortable footer area.

**Files:** `client/src/components/sidebar.tsx`

---

## 4. Settings Modal Tab Highlighting

**Problem:** Active tab in the settings modal uses `data-[state=active]:bg-background data-[state=active]:shadow-sm` — a very subtle white-on-nearly-white change that's almost invisible, especially on the transparent TabsList background.

**Fix:** Add stronger active-state styling to the settings modal TabsTriggers: use `bg-accent text-accent-foreground` with a left blue border (matching the sidebar pattern) for the active tab. This creates visual consistency across the app — the sidebar and settings use the same active-state language.

**Files:** `client/src/components/settings-modal.tsx`

---

## 5. Overdue Jobs Page Redesign

**Problem:** The current overdue page is essentially a list of cards, but it doesn't add much value over filtering the worklist by "Overdue Only". It shows raw destination IDs, doesn't display last notes/contact, and doesn't help the user triage quickly.

**Redesign approach — "Triage Dashboard":**

### A. Summary Stats Bar (top)
At the top, show 4 stat cards in a row:
- **Critical** (red): count + "7+ days"
- **High** (orange): count + "3-7 days"
- **Medium** (blue): count + "1-3 days"
- **Low** (green): count + "< 1 day"

Clicking a stat card filters to that severity (current toggle behavior but as clickable stat cards instead of buttons).

### B. Compact Table Layout
Replace the large cards with a **compact table/list** layout that shows more jobs at a glance:

| Severity | Patient | Job Type | Status | Destination | Days Overdue | Last Note | Actions |
|----------|---------|----------|--------|-------------|--------------|-----------|---------|

Each row has:
- Colored severity dot (red/orange/blue/green) instead of big badges
- Patient name (bold)
- Job type pill
- Current status as a small dropdown (inline)
- Destination name (resolved, not raw ID)
- Days overdue in bold with color coding
- Last overdue note preview (truncated, with tooltip for full text) — this is the key differentiator from the main worklist
- Quick action: "Add Note" icon button

### C. Move "Overdue Rules" to a collapsible section or info tooltip
Don't take up screen space with the rules summary card at the bottom — tuck it into a small info icon or collapsible accordion at the top.

**Files:** `client/src/components/overdue-jobs.tsx`

---

## Implementation Order

1. Header/sidebar alignment (hard constraint — do first)
2. Settings modal tab highlighting
3. Help & Feedback button spacing
4. Sidebar expand affordance
5. Overdue page redesign
