# Otto Job Tracker -- Critical Design Review

**Reviewer context:** Senior product designer evaluating a desktop worklist application for independent optometry practices. Primary users are opticians and front desk staff (ages 30-60+), often sharing a single workstation all day. Adoption depends on whether the app feels faster and more reliable than the spreadsheet it replaces.

---

## 1. INFORMATION DENSITY & READABILITY

### The base font size is too small for the target demographic. **P1**

84% of all font-size declarations are `text-sm` (14px) or `text-xs` (12px). `text-base` (16px) appears only 5 times in the entire app. The table body is set to `text-[13px]` (`jobs-table.tsx:1078`), and badge text drops to `text-[10px]` (`jobs-table.tsx:1246,1258`).

This matters because opticians and front desk staff are often 40-60 years old. They're reading tray numbers, patient names, and status badges all day under fluorescent lighting. 13px body text with 10px indicator badges requires squinting. The user-settings font size slider exists (`user-settings-modal.tsx`), but personalization doesn't excuse bad defaults -- most users will never find or use that setting, and the first impression during a sales demo is the default.

**Specific problems:**
- `jobs-table.tsx:1078` -- Table body at `text-[13px]` is below the minimum comfortable reading size (14px) for all-day use. The custom value also breaks out of Tailwind's type scale for no clear benefit over `text-sm`.
- `jobs-table.tsx:1246,1258` -- REDO and OVERDUE badges at `text-[10px]` are functionally unreadable at arm's length. These are critical status indicators.
- `jobs-table.tsx:1365,1369` -- Date sub-lines at `text-[11px]` are another custom breakout from the type scale.
- `jobs-table.tsx:1383` -- Comment count badges at `text-[9px]` on a 16px circle. This is decorative, not legible.

### Table cell padding is too tight and off-grid. **P1**

`jobs-table.tsx:1078` sets `[&_td]:px-2.5 [&_td]:py-2` (10px horizontal, 8px vertical). The 10px breaks the 4px spacing grid for no reason (`px-2` = 8px or `px-3` = 12px would be on-grid). More importantly, 8px vertical padding on 13px text with badges, linked-job indicators, and truncated notes creates a wall of tightly packed information. Users cannot scan rows quickly.

For comparison, most healthcare EMR worklists use 12-16px vertical padding per row to reduce scan errors. A misread patient name in an optometry context could mean wrong prescription lenses.

### Information hierarchy in the table is flat. **P1**

Every column renders at approximately the same visual weight:
- Patient name: `font-medium` at 13px (`jobs-table.tsx:1217`)
- Job type badge: `text-xs font-semibold` with color
- Status badge: same weight as type, rendered as a select trigger (`jobs-table.tsx:1287-1300`)
- Destination badge: same weight as type
- Date: `text-muted-foreground` at 13px
- Comment count: tiny red/gray circle

The patient name (the primary lookup key) is not visually dominant enough. It sits at the same size and weight as everything else, differentiated only by not having a colored background. A user scanning 30 rows for "Johnson" is reading every cell equally.

### The loading state for the primary view is inadequate. **P2**

`jobs-table.tsx:775-783` shows `<div className="text-center">Loading jobs...</div>` in a card with `p-8`. This is the screen users see every time the app opens. A bare text string with no visual weight (no spinner, no skeleton, no animation) makes the app feel broken during the 1-2 seconds of initial load. The notification bell gets skeleton loading (`notification-bell.tsx:156-167`) but the main worklist does not.

---

## 2. VISUAL HIERARCHY & CONTRAST

### Light mode surface differentiation is borderline. **P2**

- Background: `hsl(225, 25%, 96%)` -- luminance ~94%
- Card: `hsl(0, 0%, 100%)` -- luminance 100%
- Muted: `hsl(225, 16%, 93%)` -- luminance ~92%

The 6% luminance gap between background and card is adequate. The 2% gap between background and muted is not perceptible in many lighting conditions, especially in a brightly-lit retail optometry shop. Muted surfaces (table header `bg-muted/50`, alternating rows `bg-muted/30`) effectively disappear.

### Badge readability is fragile. **P1**

`default-colors.ts:257-278` -- The `getColorForBadge()` function renders all badges with a 15% opacity background and full-saturation text:

```typescript
background: `hsl(${raw} / 0.15)`,
text: `hsl(${raw})`
```

Full-saturation HSL text on a near-white background works for some hues (blue, red) but fails for others. Specifically:
- Yellow/amber (`#D97706` = `hsl(38, 92%, 50%)`) renders as bright orange text on a nearly invisible background. On the light theme this is borderline; in dark mode it's worse because `hsl(38 92% 50%)` text on a dark surface has poor contrast.
- Green (`#16A34A` = green-600) at full saturation against light backgrounds is fine, but at 15% opacity the background badge is invisible.

The 14 hex colors in `HIGH_CONTRAST_COLOR_PALETTE` (`default-colors.ts:12-27`) were chosen for a light background. There is no dark-mode variant of this palette. The same colors are used in both themes.

### Overdue severity cards rely solely on color. **P2**

`overdue-jobs.tsx:23-28` defines four severity levels using only color to distinguish them: red, orange, blue, green. For users with red-green color blindness (~8% of males), Critical (red) and Low (green) could be confused. The labels ("Critical", "High", "Medium", "Low") help, but the dot indicators in the table (`overdue-jobs.tsx:242`, `w-2.5 h-2.5 rounded-full` with only color differentiation) have no label fallback. A colorblind user scanning the table sees same-looking dots for different severities.

### Status badge in the table has no background, creating inconsistency. **P1**

`jobs-table.tsx:1291` sets `backgroundColor: 'transparent'` on the status badge specifically because it's a select trigger. The job type badge and destination badge both have colored backgrounds. This means three adjacent badge columns use three different visual treatments: colored bg (type), transparent bg with colored text only (status), colored bg (destination). This breaks the visual rhythm and makes status harder to read.

---

## 3. INTERACTION PATTERNS & AFFORDANCES

### Table row click target collision. **P1**

A single table row in `jobs-table.tsx:1180-1428` supports all of these interactions:
1. **Row click** (line 1188-1196): Opens job details in normal mode, toggles selection in select/link mode
2. **Star button** (line 1199-1213): Flags/unflags the job, uses `e.stopPropagation()`
3. **Status select** (line 1282-1318): Inline status change dropdown, uses `e.stopPropagation()`
4. **Linked-job indicator click** (line 1225): Opens related tab, uses `e.stopPropagation()`
5. **Patient count indicator click** (line 1237): Opens related tab, uses `e.stopPropagation()`
6. **Custom column checkbox** (line 1337-1354): Toggle, uses conditional `e.stopPropagation()`
7. **Comment button** (line 1373-1393): Opens comments sidebar
8. **Dropdown menu** (line 1394-1426): Edit, Delete, Messages

That is 8 distinct click targets per row, at least 5 of which require `stopPropagation()` to prevent the row click from firing. The star button (`h-7 w-7`, 28px) and comment button (`h-7 w-7`) are adjacent to text that also accepts clicks. On a shared workstation where users may not have a precise mouse, accidental clicks will open the wrong thing. The row-click-to-open pattern also means there's no obvious "open" button -- users must know to click the row or find "Edit" in the three-dot menu.

### Enter-to-send vs Cmd+Enter inconsistency. **P1**

`job-comments-panel.tsx:374-375` -- Comments use Enter to send, Shift+Enter for newline. The placeholder text says this explicitly.

`job-details-modal.tsx:610-613` -- Group notes use Cmd/Ctrl+Enter to send. There is no placeholder or hint indicating this shortcut.

These are both text input fields that send messages in the same modal (job details). A user types a comment with Enter-to-send, then tabs to the group notes textarea and presses Enter expecting the same behavior -- instead they get a newline. Or the reverse: they learn Cmd+Enter in group notes, go back to comments, and press Cmd+Enter expecting it to send, but Enter already sent halfway through their message.

### Filter discoverability is poor. **P2**

`jobs-table.tsx:940-949` -- The filter button is a ghost button labeled "Filters" in a secondary toolbar row. When filters are active and the panel is collapsed, the only indicator is a small primary-colored dot (line 949: an empty `<span>` styled as a 16px circle). This dot has no number, no text, and no tooltip explaining what's filtered.

A user (or their coworker on a shared workstation) looking at a seemingly empty worklist won't easily realize filters are hiding jobs. In a medical context, missing a job because of an invisible filter is an operational risk.

### Collapsed sidebar icons are ambiguous. **P2**

`sidebar.tsx:75-107` defines nav items with icons: `Briefcase` (Worklist), `Star` (Important), `Archive` (Past Jobs), `AlertTriangle` (Overdue), `BarChart3` (Analytics), `Users` (Team). When collapsed (`w-20`), only icons are visible. Tooltips appear on hover (`sidebar.tsx:189-205`) but are not visible by default.

For an optician who uses the app intermittently, Archive (past jobs) and Briefcase (worklist) are not self-evident. The icons are also rendered at `h-5 w-5` (20px) inside a 48px icon-column area, which is appropriately sized, but the cognitive mapping from abstract icon to function is weak without labels.

### Delete confirmation uses browser `confirm()` dialog. **P2**

`jobs-table.tsx:926` -- `if (confirm(...))` for bulk delete. This is a browser-native confirm dialog that looks jarring in a polished Electron app. The rest of the app uses `AlertDialog` from Radix for confirmations. This is inconsistent and makes the bulk delete flow feel unfinished.

---

## 4. MODAL OVERLOAD

### The job details "modal" is not a modal -- it's a page pretending to be one. **P1**

`job-details-modal.tsx` opens at `max-w-5xl` (1280px) and `h-[86vh]` (86% of viewport height). At this size, it covers nearly the entire screen. It contains tabs (Overview, Comments, Related), a scrollable status history timeline, a related jobs table, a full comment thread with input, and an edit button that opens another modal (the job dialog). This is a full page of content in a dialog wrapper.

The problems:
- Users lose their scroll position and context in the worklist behind it.
- The 86vh height means the overlay background is barely visible -- users may not realize they're in a modal.
- Opening the edit dialog from within the details modal creates a modal-on-modal stack. Opening the messages template modal from the action menu creates another layer. There's no visible stacking indicator.
- The details modal fetches 4 separate queries on open (office, status history, related data, group notes), meaning the content appears incrementally. This is fine for a page load but feels janky for a modal opening.

### Settings modal contains an entire admin interface. **P2**

`settings-modal.tsx` has 7+ tabs (Statuses, Job Types, Destinations, Custom Columns, Notification Rules, PIN Management, Invite Code). Each tab contains forms, sortable lists with drag-and-drop, and mutation logic. The notification rules tab embeds the full `NotificationRules` component (`settings-modal.tsx:31`), which is itself a card-based form with a table.

This exceeds what a modal should contain. Settings is a destination, not an interruption. Making it a full page (or at minimum a sheet/drawer that slides in from the right) would give users a sense of place and allow for better navigation between tabs.

### Modal-inside-modal patterns exist. **P1**

Confirmed chains:
1. **Job details modal -> Job dialog (edit)**: Clicking "Edit Job" in `job-details-modal.tsx` opens `job-dialog.tsx` on top. Two overlays stack.
2. **Job dialog -> AlertDialog (duplicate tray)**: The job creation form can trigger a duplicate tray confirmation dialog.
3. **Settings modal -> implicit sub-modals**: Delete confirmations within settings tabs.

The double-overlay is disorienting. When a user edits a job from the details modal, closes the edit dialog, and returns to the details modal, they need to mentally track which layer they're on. There's no breadcrumb or back-navigation affordance.

---

## 5. EMPTY STATES & ONBOARDING

### No zero-state onboarding exists. **P1**

A brand-new office installation shows:
- **Worklist tab**: An empty table with headers but no rows, plus a search bar and "New Job" button. No guidance like "Create your first job to get started" or "Import jobs from your EHR system."
- **Team tab**: Shows a generic "New account onboarding" info card (`team-page.tsx:236-253`) that explains how account requests work, but doesn't prompt the owner to invite team members.
- **Settings**: Defaults are pre-populated (statuses, types, destinations), so this is actually okay.
- **Analytics**: Will show zeroed-out metric cards and empty charts with no helpful message.
- **Overdue**: Shows "All caught up!" (`overdue-jobs.tsx:139-150`) which is technically correct but gives no context about configuring notification rules to make overdue detection work.

For a practice evaluating the product, the empty worklist is the first thing they see. It should actively guide them toward the first valuable action (creating a job or importing from their EHR).

### Empty states are inconsistent in style. **P2**

| View | Empty State | Icon | Style |
|------|-------------|------|-------|
| Overdue | "All caught up!" | Green CheckCircle2 in green-100 circle | `py-16`, green accent, encouraging |
| Notifications | "No notifications" | Bell at `opacity-20` | `p-8`, muted, minimal |
| Past Jobs | "No Past Jobs" | Clipboard icon | `p-8`, generic |
| Worklist | *(none)* | *(none)* | Bare empty table |

These feel like they were designed by different people at different times. The overdue empty state is the most polished (icon in colored circle, heading, description). The notification empty state is the most minimal. The worklist has no empty state at all.

### Complex features lack inline guidance. **P2**

- **CSV Import wizard** (`import-wizard.tsx`): Multi-step process with column mapping. The blue info banner (`import-mapping-step.tsx:205-220`) uses hardcoded colors and only appears for notes/destination edge cases. There's no overall explanation of what the mapping does or how to fix errors.
- **Notification rules** (`notification-rules.tsx`): A card-based form for configuring per-status overdue thresholds. No explanation of what happens when a rule triggers or how thresholds interact.
- **Custom columns** (settings-modal.tsx): No explanation of what column types do or where they appear.

---

## 6. CONSISTENCY & CODE HYGIENE

### Badge color function duplication has UX consequences. **P1**

The same badge color lookup logic is implemented in 4 files:
- `jobs-table.tsx:605-694` (3 functions)
- `past-jobs.tsx:176-230` (3 functions)
- `job-details-modal.tsx:178-212` (3 functions, one named differently: `getJobTypeBadgeColor`)
- `important-jobs.tsx:134-160` (3 functions)

The implementations differ subtly:
- `jobs-table.tsx` and `job-details-modal.tsx` use memoized arrays from parent scope.
- `past-jobs.tsx` fetches from `office?.settings` inline each call.
- `job-details-modal.tsx` has a different name (`getJobTypeBadgeColor` vs `getTypeBadgeColor`).

User impact: if a badge rendering bug is fixed in one file but not the others, the same job could appear with different colors on different screens. This undermines trust -- "why does this job look different on the Past Jobs tab?"

### Error boundary will render a white box in dark mode. **P0**

`sentry-error-boundary.tsx:6-38` uses inline styles exclusively:
- `background: "#fff"` (line 32)
- `color: "#666"` (line 21)
- `border: "1px solid #ccc"` (line 31)
- `fontFamily: "system-ui"` (line 15)

This completely bypasses the Tailwind theme system. In dark mode, users will see a bright white rectangle with light gray text on a black background. The contrast is jarring and the component looks broken. More importantly, this is the error fallback -- it appears when something has already gone wrong, and looking broken makes a bad situation worse.

### Import info banner bypasses the component library. **P2**

`import-mapping-step.tsx:205-220` uses hardcoded Tailwind color classes (`border-blue-200 bg-blue-50 text-blue-700`) instead of the existing `Alert` component from `ui/alert.tsx`. The Alert component uses theme tokens and would work correctly in dark mode. The hardcoded blue classes will render as bright blue boxes in dark mode because `bg-blue-50` is a light color.

### Button size overrides create phantom variants. **P2**

`jobs-table.tsx:802-810` uses `size="sm" className="h-8 text-xs"`. The button component's `sm` size already sets `h-9 rounded-md px-3` (36px height). The override forces it to 32px with 12px text. This creates an implicit "extra small" button variant that exists only in the worklist toolbar. Other `size="sm"` buttons elsewhere render at the standard 36px.

### Unused dependencies are dead weight. **P2**

- `framer-motion` (^11.13.1) is in `package.json` but imported in zero component files. It adds ~32KB to the client bundle.
- The full shadcn `SidebarProvider` system (`ui/sidebar.tsx`, 600+ lines) is defined but never used. The app uses a completely separate custom `sidebar.tsx` with different width values and localStorage-based state instead of the shadcn cookie-based state.

---

## 7. DARK MODE QUALITY

### Primary color hue shifts between themes. **P1**

- Light mode: `--primary: hsl(230, 70%, 56%)` -- blue-indigo
- Dark mode: `--primary: hsl(203.77, 87.6%, 52.55%)` -- blue-cyan

This is a 26-degree hue shift. The primary button, active sidebar indicator, focus rings, and all primary-colored UI elements change hue between themes. Users who switch modes (or whose system auto-switches) will perceive two different brand colors. This either needs to be intentional (documented as a design decision) or fixed to maintain the same hue with adjusted lightness/saturation for dark backgrounds.

### Hardcoded color values break in dark mode. **P1**

Multiple files use hardcoded HSL values that assume a light background:
- `jobs-table.tsx:1248` -- Redo badge: `backgroundColor: 'hsl(38 92% 50% / 0.15)'`. On a dark surface, 15% opacity amber is barely visible.
- `jobs-table.tsx:1260` -- Overdue badge: `backgroundColor: 'hsl(0 84% 60% / 0.15)'`. Same problem -- nearly invisible on dark.
- `jobs-table.tsx:1223` -- Linked job indicator: `color: 'hsl(221 83% 53%)'`. This specific blue is fine on dark but there's no guarantee it meets WCAG contrast.
- `overdue-jobs.tsx:24-27` -- `bg-red-50`, `bg-orange-50`, `bg-blue-50`, `bg-green-50` are all light-mode-only colors. The severity stat cards will look washed out and wrong on a dark background.

### Error boundary renders a white box in dark mode. **P0**

(Repeated from Section 6 because the dark mode impact is the primary concern.)

`sentry-error-boundary.tsx:32` -- `background: "#fff"` is a bright white surface that ignores `prefers-color-scheme` and the `.dark` class. When the app crashes in dark mode, users see a full-screen white flash. At minimum this needs to use CSS variables or Tailwind classes.

### Badge palette has no dark mode adaptation. **P1**

`default-colors.ts:257-278` -- `getColorForBadge()` always returns `hsl(X / 0.15)` background and `hsl(X)` text. On a dark card surface (`hsl(228, 9.8%, 10%)`), a 15% opacity colored background is nearly invisible, reducing badges to text-only. The visual grouping effect that badges provide on light mode disappears. The text colors (full saturation) may also fail WCAG contrast on the dark card background for certain hues (especially yellows and light greens).

---

## 8. LOADING & PERFORMANCE PERCEPTION

### Main worklist has no skeleton loading. **P1**

`jobs-table.tsx:775-783` shows a bare "Loading jobs..." text string in a padded card. This is the first thing users see on every app launch, and the primary view they return to all day.

`notification-bell.tsx:156-167` demonstrates that the skeleton pattern is already in use elsewhere. The worklist should show a skeleton table (3-5 rows of skeleton cells matching the column layout) instead of a text string. This is a standard pattern for data-heavy tables and would make the app feel significantly faster during the initial load.

### No optimistic UI for status changes. **P2**

`jobs-table.tsx:1283-1318` -- The inline status select triggers a mutation. During the pending state, the button is not visually disabled (the select remains interactive). There's no optimistic update -- the badge doesn't change until the server responds. For the most frequent user action (changing a job's status), this creates a perceptible delay between selecting "Ready for Pickup" and seeing the badge update. The `onMutate` callback pattern from TanStack Query is available but not used here.

### Toast limit of 1 means feedback can be lost. **P2**

`use-toast.ts:8` -- `TOAST_LIMIT = 1`. If a user performs two rapid actions (e.g., flags a job, then changes a status), only the second toast will be visible. The first is immediately dismissed. The remove delay (`TOAST_REMOVE_DELAY = 1000000`, ~16 minutes) means dismissed toasts linger in memory but this is a leak concern, not a UX one. The real problem is that success confirmations for rapid actions are silently swallowed.

---

## 9. ACCESSIBILITY GAPS

### No skip navigation link. **P1**

The sidebar is the first focusable region. A keyboard user must tab through 6+ sidebar items before reaching the main content area. In a shared workstation where someone might use keyboard navigation (injury, preference, or accessibility need), this is a friction point on every page load.

Given that the app is an Electron desktop app, keyboard users are more likely than in a typical web app -- desktop users expect keyboard shortcuts to work.

### No aria-live regions for dynamic content. **P1**

When a job status is changed, a new job is created, or a comment is added, the UI updates silently. There are no `aria-live` regions to announce these changes to screen reader users. The toast notifications use Radix Toast, which may internally handle `aria-live`, but this should be verified. The real-time WebSocket sync updates (`sync-manager.tsx`) update the table with no announcement at all.

### TOAST_LIMIT = 1 is also an accessibility problem. **P2**

Screen reader users rely on live region announcements for feedback. If the toast limit silently replaces one announcement with another, the first feedback is lost entirely. This compounds with the lack of aria-live regions elsewhere.

### Severity dots use color alone. **P2**

`overdue-jobs.tsx:242` -- `<span className={cn("inline-block w-2.5 h-2.5 rounded-full", config.dot)} title={config.label} />`. The `title` attribute provides a tooltip on hover but is not accessible to keyboard users and is not read by screen readers unless the element is focusable. The dot's only accessible property is its color.

---

## 10. OVERALL DESIGN COHESION

### The app is competent but generic.

The UI is built almost entirely from shadcn/ui defaults with minimal customization. The color scheme (blue-indigo primary, gray muted, standard destructive red) is the default shadcn palette with minor HSL adjustments. There is no unique visual signature -- no custom illustrations, no branded empty states, no distinctive component treatments.

For an optometry practice comparing this against competitors or against "we just use a spreadsheet," the UI is functional but doesn't inspire confidence through visual craft. It looks like a developer tool, not a healthcare product. The density, small text, and developer-centric patterns (Enter-to-send, keyboard shortcuts with no hints, collapsed filters) reinforce this impression.

### The app feels like a collection of competently-built screens rather than a unified product.

The worklist table, analytics dashboard, team page, and auth page each feel like they were built independently:
- Worklist: Dense, utility-focused, lots of interaction patterns
- Analytics: Clean, spacious, view-only with charts
- Team: Card-based, generous padding
- Auth: Marketing-style two-column layout with gradient
- Settings: Dense tabbed modal with drag-and-drop

The spacing, padding, and density are noticeably different across these views. The worklist uses `px-5 py-2-3`, team uses `space-y-6` with `p-4` cards, analytics uses `space-y-6` with `p-4` metric cards. These aren't dramatically different, but the cumulative effect is that each tab feels slightly different in "air."

### Single highest-impact visual improvement:

**Increase the worklist table row height and font size.** Change the table body from `text-[13px]` to `text-sm` (14px), increase cell padding from `py-2` (8px) to `py-3` (12px), and make badge text `text-[11px]` minimum instead of `text-[10px]`. This single change would make the primary view -- the one users stare at all day -- more readable, more scannable, and more professional. It's a 30-minute code change with outsized impact on perceived quality and usability.

---

## PUNCH LIST

### P0 (Ship-blocking)

**`client/src/components/sentry-error-boundary.tsx:6-38`**
- Replace all inline `style=` attributes with Tailwind classes that respect the theme system. Use `bg-background text-foreground` for the container, `text-muted-foreground` for the description, and the `Button` component for the reload action.
- Why: Renders a bright white box in dark mode. This is the error fallback -- looking broken during a crash destroys user trust.
- Backwards compatibility: None. Visual-only change.

---

### P1 (Fix before next sales push)

**`client/src/components/jobs-table.tsx:1078`**
- Change `text-[13px]` to `text-sm` (14px). Change `[&_td]:py-2` to `[&_td]:py-2.5` or `[&_td]:py-3`. Change `[&_td]:px-2.5` to `[&_td]:px-3` (back on the 4px grid).
- Why: Primary view is too dense for target users. Non-standard sizes break the type scale.
- Backwards compatibility: Rows will be taller; fewer visible without scroll. Existing users will notice the change.

**`client/src/components/jobs-table.tsx:1246,1258`**
- Change REDO and OVERDUE badge `text-[10px]` to `text-[11px]` minimum.
- Why: 10px text is below minimum legible size for status-critical indicators.
- Backwards compatibility: None. Badges slightly larger.

**`client/src/components/jobs-table.tsx:1383`**
- Change comment count badge `text-[9px]` to `text-[10px]`.
- Why: 9px text is decorative, not functional.
- Backwards compatibility: None.

**`client/src/components/jobs-table.tsx:1291`**
- Give the status badge a colored background (matching type/destination), not `backgroundColor: 'transparent'`.
- Why: Three adjacent badge columns with three different visual treatments breaks scanning rhythm.
- Backwards compatibility: Status column will look different. Users will notice but should find it more consistent.

**`client/src/components/jobs-table.tsx:775-783`**
- Replace "Loading jobs..." text with a skeleton table (3-5 rows of `Skeleton` cells matching column widths).
- Why: First thing users see on every launch. Bare text makes the app feel slow/broken.
- Backwards compatibility: None.

**`client/src/components/jobs-table.tsx:926`**
- Replace `confirm(...)` with `AlertDialog` for bulk delete confirmation, matching the rest of the app.
- Why: Browser-native dialog looks out of place in an Electron app and is inconsistent with other confirmations.
- Backwards compatibility: None. Better UX.

**`client/src/components/jobs-table.tsx:940-949`**
- When filters are active and the panel is collapsed, show a count inside the filter indicator dot (currently an empty `<span>`). Add a tooltip or inline text like "3 filters active."
- Why: Hidden filters on a shared workstation can cause missed jobs. Medical context makes this a safety concern.
- Backwards compatibility: None. Additive.

**`client/src/components/jobs-table.tsx:605-694`, `client/src/components/past-jobs.tsx:176-230`, `client/src/components/job-details-modal.tsx:178-212`, `client/src/pages/important-jobs.tsx:134-160`**
- Extract `getStatusBadgeColor`, `getTypeBadgeColor`, `getDestinationBadgeColor` into a single shared utility (e.g., in `lib/default-colors.ts` or a new `lib/badge-colors.ts`). Replace all 4 duplicated implementations.
- Why: Divergent implementations mean the same job can render with different colors on different screens.
- Backwards compatibility: None if done correctly. Badge colors should be identical.

**`client/src/lib/default-colors.ts:257-278`**
- Add dark-mode-aware badge color computation. When on a dark surface, increase background opacity from 0.15 to 0.25-0.30 and ensure text color meets WCAG AA (4.5:1) against `--card` background. This could check for a `.dark` class or accept a theme parameter.
- Why: Badges are nearly invisible in dark mode at 15% opacity on a dark surface.
- Backwards compatibility: Dark mode badges will look different (better). Light mode unchanged.

**`client/src/index.css` (dark mode section)**
- Reconcile the primary hue shift. Either: (a) use the same hue (230) with adjusted lightness for dark mode, or (b) document the cyan shift as an intentional design decision.
- Why: 26-degree hue shift between themes makes the brand feel inconsistent.
- Backwards compatibility: Dark mode primary color will change. Users in dark mode will notice.

**`client/src/components/overdue-jobs.tsx:24-27`**
- Add `dark:` variants for severity stat card backgrounds. `bg-red-50` -> add `dark:bg-red-950/30`. Same for orange, blue, green.
- Why: Light-mode-only background colors look wrong on dark surfaces.
- Backwards compatibility: None. Dark mode only.

**`client/src/components/jobs-table.tsx:1248,1260` and `client/src/components/job-details-modal.tsx:487,530`**
- Replace hardcoded HSL inline styles for redo/overdue badges with theme-aware values or add dark-mode overrides.
- Why: 15% opacity colored backgrounds are invisible on dark cards.
- Backwards compatibility: None. Dark mode only.

**`client/src/components/job-comments-panel.tsx:374-375` and `client/src/components/job-details-modal.tsx:610-613`**
- Standardize on one send shortcut across both textareas. Recommendation: Use `Cmd/Ctrl+Enter` for both, since the textareas are for professional notes (not chat). Update the placeholder text on both to indicate the shortcut.
- Why: Same modal, same user, two different keyboard shortcuts for the same action.
- Backwards compatibility: **Yes, this changes behavior.** Users who muscle-memorized Enter-to-send for comments will need to adjust.

**Empty state for worklist (new file or addition to `client/src/components/jobs-table.tsx`)**
- Add a zero-state component when there are no jobs: icon, heading ("No jobs yet"), description ("Create your first job or import from your EHR"), and primary action button.
- Why: New practices see an empty table during onboarding. No guidance means they fumble.
- Backwards compatibility: None. New UI for an edge case.

**Accessibility: Skip navigation**
- Add a skip link in `client/src/pages/dashboard.tsx` (or `App.tsx`) that targets the main content area. Standard pattern: visually hidden, visible on focus.
- Why: Keyboard users must tab through the entire sidebar on every page load.
- Backwards compatibility: None. Hidden unless focused.

**Accessibility: aria-live for toasts**
- Verify that Radix Toast provides `aria-live` announcements. If not, add `aria-live="polite"` to the `ToastViewport` in `client/src/components/ui/toast.tsx`.
- Why: Screen reader users get no feedback for actions.
- Backwards compatibility: None.

---

### P2 (Quality-of-life, fix when convenient)

**`client/src/components/jobs-table.tsx:1365,1369`**
- Change `text-[11px]` date sub-lines to `text-xs` (12px).
- Why: Non-standard size for minimal gain.
- Backwards compatibility: None.

**`client/src/components/jobs-table.tsx:802-810`**
- Remove `h-8 text-xs` overrides on `size="sm"` buttons, or create an explicit `xs` button size variant in `ui/button.tsx` if smaller buttons are needed.
- Why: Implicit variant via class override is undocumented and inconsistent.
- Backwards compatibility: Toolbar buttons will be slightly taller if override is removed.

**`client/src/components/import-mapping-step.tsx:205-220`**
- Replace hardcoded blue banner with the `Alert` component from `ui/alert.tsx` (or create an `info` variant). This will respect dark mode.
- Why: Bypasses the component library and breaks in dark mode.
- Backwards compatibility: None. Visual parity.

**`client/src/components/overdue-jobs.tsx:242`**
- Add a shape or pattern differentiator to severity dots (e.g., different shapes or icons) in addition to color.
- Why: Colorblind users cannot distinguish red/green dots.
- Backwards compatibility: None. Additive.

**`client/src/hooks/use-toast.ts:8`**
- Increase `TOAST_LIMIT` from 1 to 3, and reduce `TOAST_REMOVE_DELAY` from 1000000 to 5000.
- Why: Rapid actions lose feedback. 16-minute remove delay is a memory leak.
- Backwards compatibility: Users will see more toasts. The remove delay change fixes a resource issue.

**`package.json`**
- Remove `framer-motion` from dependencies. It is not imported anywhere.
- Why: ~32KB dead weight in the bundle.
- Backwards compatibility: None.

**`client/src/components/ui/sidebar.tsx`**
- Either remove the unused shadcn SidebarProvider system or migrate `components/sidebar.tsx` to use it.
- Why: 600+ lines of dead code that will confuse future contributors.
- Backwards compatibility: If removed, none. If migrated, sidebar state persistence changes from localStorage to cookie.

**`client/src/components/job-details-modal.tsx`**
- Long-term: Consider converting to a full page or a right-panel (Sheet) rather than a dialog. At 1280px x 86vh, it is already page-sized.
- Why: Modal-on-modal stacking, loss of worklist context, and the size all argue against the dialog pattern.
- Backwards compatibility: **Yes.** Significant navigation change. Would need user testing.

**`client/src/components/settings-modal.tsx`**
- Long-term: Consider converting to a full page or right-panel (Sheet). 7 tabs of admin configuration exceeds what a modal should contain.
- Why: Admin settings is a destination, not an interruption.
- Backwards compatibility: **Yes.** Navigation change.

**Empty state consistency**
- Standardize empty states across all views: icon in a lightly colored circle, heading (bold, `text-lg`), description (`text-sm text-muted-foreground`), optional action button. Use the overdue empty state (`overdue-jobs.tsx:139-150`) as the template.
- Why: Inconsistent empty states make the app feel piecemeal.
- Backwards compatibility: None. Visual improvement.

**`client/src/index.css` (light mode surface tokens)**
- Increase separation between `--background` and `--muted`. Current gap is 2% luminance. Recommendation: darken muted to `hsl(225, 16%, 90%)` for a 4% gap.
- Why: Muted surfaces (table headers, alternating rows) are imperceptible in bright lighting.
- Backwards compatibility: Muted surfaces will be slightly darker. Subtle change.
