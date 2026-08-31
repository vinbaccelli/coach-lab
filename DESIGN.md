---
name: AngleMotion
description: Coaching intelligence platform — a precision analysis instrument that recedes so the athlete's movement is the only thing with colour.
colors:
  system-blue: "#007AFF"
  system-blue-pressed: "#DCEBFF"
  system-blue-soft: "rgba(0, 122, 255, 0.12)"
  system-green: "#34C759"
  system-red: "#FF3B30"
  system-orange: "#FF9500"
  label: "#1D1D1F"
  secondary-label: "#6E6E73"
  tertiary-label: "#8E8E93"
  separator: "#D1D1D6"
  separator-subtle: "rgba(209, 209, 214, 0.65)"
  panel: "#FFFFFF"
  grouped-background: "#F5F5F7"
  secondary-background: "#F2F2F7"
  overlay-scrim: "rgba(0, 0, 0, 0.72)"
  overlay-panel: "#1C1C1E"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif"
    fontSize: "clamp(32px, 6vw, 56px)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif"
    fontSize: "clamp(24px, 4vw, 34px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  xxl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.system-blue}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    typography: "{typography.body}"
    height: "44px"
  button-primary-pressed:
    backgroundColor: "{colors.system-blue-pressed}"
    textColor: "{colors.system-blue}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.label}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    typography: "{typography.body}"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.system-red}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "44px"
  tool-row-active:
    backgroundColor: "{colors.system-blue}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "44px"
  tool-row-icon-only:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.label}"
    rounded: "{rounded.md}"
    padding: "0"
    width: "44px"
    height: "44px"
  status-toast:
    backgroundColor: "rgba(250, 249, 247, 0.97)"
    textColor: "{colors.label}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
    typography: "{typography.body}"
  dialog-light:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.label}"
    rounded: "{rounded.lg}"
    padding: "22px 20px"
  dialog-dark:
    backgroundColor: "{colors.overlay-panel}"
    textColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "24px"
  inline-error:
    backgroundColor: "#FFF7ED"
    textColor: "#9A3412"
    rounded: "{rounded.md}"
    padding: "8px 4px"
    typography: "{typography.label}"
---

# Design System: AngleMotion

## Overview

**Creative North Star: "The Quiet Instrument"**

AngleMotion is a precision instrument, and an instrument does not compete with
what it measures. The chrome is neutral — white panels, graphite text, hairline
separators — so that the only saturated colour on screen belongs to the coach's
own marks and the athlete's movement underneath them. When a coach draws an angle
across a player's shoulder line, that mark must be the loudest thing in the
frame. Every decision in this system is downstream of that.

The system is Apple-derived and unapologetic about it. It uses the iOS system
palette and the platform font stack, because the product is used one-handed on a
phone at the side of a court and on a laptop afterwards, and platform-native
conventions are what a coach already knows how to operate under sunlight with
three seconds to spare. This is not a stylistic preference borrowed for polish;
it is the shortest path to a control that reads correctly at a glance.

Restraint here is structural, not decorative. Surfaces are flat while you work
and lift only to say "this floats above your work." Controls hold hairline
borders and generous padding and stay quiet until touched. Nothing blurs, nothing
glows, nothing animates for its own sake. The interface earns its keep by being
unnoticeable — and then by being exactly where the coach expects when they reach
for it.

**Key Characteristics:**
- Neutral chrome; a single blue voice used sparingly
- Flat at rest, shadow only for floating layers
- Platform-native type and colour, light theme only
- 44px touch targets everywhere — parity between phone and desktop is a product requirement, not a courtesy
- Hairline (1px) borders as the default separator, not shadow

## Colors

The iOS system palette on a white and near-white ground: five semantic hues, four
neutrals, and nothing else. Colour carries meaning here — it is never applied for
variety.

### Primary
- **System Blue** (`{colors.system-blue}`): the only interactive voice. Active tool rows, primary actions, selected states, links, focus. It is also the PWA theme colour. If something is blue, it is either interactive or currently selected — never merely emphasised.
- **System Blue Pressed** (`{colors.system-blue-pressed}`): the momentary press fill on toolbar controls, paired with blue text. It exists so a tap registers visually within one frame on a touch device.
- **System Blue Soft** (`{colors.system-blue-soft}`): translucent wash for selection ranges and highlight bands over content.

### Secondary
- **System Green** (`{colors.system-green}`): confirmation that a human made a decision. It marks `ready` frame status in the Coach Override chain, the ✓ on completed steps, timeline trim accents, and the live-recording dot. Green means *a coach signed off* or *this is live right now* — it never means "good" in the abstract.
- **System Red** (`{colors.system-red}`): destructive and stop only. Clear All, delete, stop recording. Red is never a brand colour on this product.
- **System Orange** (`{colors.system-orange}`): caution and degraded state — a capability unavailable on this device, a fallback in effect. Rare by design.

### Neutral
- **Label** (`{colors.label}`): all primary text and icon fills on light surfaces.
- **Secondary Label** (`{colors.secondary-label}`): sub-labels, helper text, inactive metadata.
- **Tertiary Label** (`{colors.tertiary-label}`): timestamps, counts, the quietest supporting text.
- **Separator** (`{colors.separator}`): the 1px border that does nearly all structural work in this system, in place of shadow.
- **Panel** (`{colors.panel}`): every control and card surface.
- **Grouped Background** (`{colors.grouped-background}`): the app ground behind panels.
- **Secondary Background** (`{colors.secondary-background}`): nested and inset surfaces.
- **Overlay Scrim** (`{colors.overlay-scrim}`) and **Overlay Panel** (`{colors.overlay-panel}`): the one sanctioned dark context — full-screen editors and dialogs that sit directly over video, where a light panel would blow out the frame beneath.

### Named Rules

**The One Voice Rule.** System Blue is the only colour that means "you can act on
this." If a surface needs emphasis and the thing is not interactive, it gets
weight or spacing, never blue.

**The Earned Colour Rule.** Green, red and orange each carry one meaning and are
spent only on it: green for coach-confirmed or live, red for destructive, orange
for degraded. A hue with no state behind it does not appear.

**The Hairline-Over-Shadow Rule.** Structure is drawn with a 1px Separator
border. Reach for shadow only when a surface genuinely floats (see Elevation).

## Typography

**Display Font:** the platform stack — `-apple-system`, `BlinkMacSystemFont`, `SF Pro Display`, `SF Pro Text`, `system-ui`, `sans-serif`
**Body Font:** the same stack. One family throughout.
**Label/Mono Font:** none distinct. Monospace appears only in developer diagnostics, which are not part of the shipped system.

**Character:** SF is invisible in the best way — a coach reads a measurement, not
a typeface. Hierarchy is built almost entirely from weight and size, with
letter-spacing left alone except on the largest marketing display sizes, where
slight negative tracking keeps big text from feeling loose.

### Hierarchy
- **Display** (800, `clamp(32px, 6vw, 56px)`, 1.05): marketing surfaces only — the landing hero. Never inside the app.
- **Headline** (700, `clamp(24px, 4vw, 34px)`, 1.15): marketing section heads.
- **Title** (700, 16px, 1.3): dialog and panel titles inside the app. 18px is permitted for the largest modal titles.
- **Body** (500, 13px, 1.45): the workhorse. Tool row labels, panel copy, status text. This is the app's default size.
- **Label** (600, 11px, 1.35): sub-labels beneath a control, captions, helper and error text.
- **Micro** (600, 10px): reserved for the icon-only rail and dense on-canvas chrome, where nothing smaller is legible on a phone.

### Named Rules

**The Two-Size Rule.** Inside the app, body copy is 13px and its supporting label
is 11px. Reaching for a third in-between size is how a scale rots — 12px, 14px
and 15px exist in the codebase today and are drift to be resolved toward 13/11,
not precedent to follow.

**The Weight-First Rule.** Build hierarchy with weight (500 → 600 → 700) before
size. The app surface has very little room; a heavier 13px outranks a lighter
15px and costs no space.

## Layout

The app is a fixed-viewport workspace, not a scrolling document: `body` is
`100dvh` with `overflow: hidden`, and scrolling belongs to individual panels. The
analysis surface is a video stage with a vertical tool rail beside it; the rail
collapses to a 44px icon-only strip on narrow viewports and expands to labelled
rows when there is room.

Spacing runs on a 2px-derived scale — 4, 6, 8, 10, 12, 16 — with 8px and 10px
doing most of the work as control gaps and internal padding. Control padding is
`10px 12px` for labelled rows and `8px 12px` for compact ones.

Responsive behaviour is driven by capability, not width alone: the mobile layout
triggers on `(max-width: 768px)` **or** `(hover: none) and (pointer: coarse) and
(max-width: 1024px)`, so a landscape phone gets touch chrome rather than being
misread as a small desktop. Safe-area insets are honoured on fixed elements.

**The Parity Rule.** Every capability is reachable on both phone and desktop.
Layout may differ; the feature set may not. A control that exists only on desktop
is a defect, not a tier.

## Elevation & Depth

Flat at rest; lift only to float. Working surfaces — panels, tool rows, cards,
the video stage — carry no shadow at all. They are separated by 1px Separator
borders and by tonal steps between Panel white and Grouped Background. Shadow is
reserved for one job: signalling that a layer sits *above* the work and will go
away.

### Shadow Vocabulary
- **Toast** (`0 12px 36px rgba(0,0,0,0.12)`): the transient status pill.
- **Panel Float** (`0 16px 44px rgba(0,0,0,0.12)`): floating side panels and popovers.
- **Dialog** (`0 20px 48px rgba(0,0,0,0.18)`): light modal dialogs.
- **Dialog Over Video** (`0 24px 60px rgba(0,0,0,0.35)`): dark dialogs on the overlay scrim, which need more separation against moving footage.
- **Video Chrome** (`0 8px 32px rgba(0,0,0,0.4)`): the webcam PiP and controls that sit directly on the video.

### Named Rules

**The No-Blur Rule.** `backdrop-filter` is banned on any surface over the video.
A live blur forces the compositor to re-blur every presented frame, and this is a
video product. Four files carry this as a code comment; it is a design rule, not
only a performance note. Use an opaque or high-alpha fill instead.

**The Flat-Work Rule.** If a surface is part of the work, it has no shadow. If it
has a shadow, it must be dismissible.

## Shapes

Corners are gently rounded and consistent: **8px** for compact inline controls
and chips, **10px** for the default control and tool row, **16px** for cards,
dialogs and floating panels, and **999px** for true pills — status dots, badges,
segmented indicators. Larger surfaces get larger radii; the ratio of radius to
element size stays roughly constant, which is why a 44px row at 10px reads the
same as a 480px dialog at 16px.

Borders are 1px and use Separator. Border-radius and border together do the
structural work that shadow does in other systems.

The tool rail is a column of equal 44px units — the silhouette a coach learns
with their thumb. Icon-only mode holds that 44px square exactly; labelled mode
grows only vertically, wrapping label text to a second line rather than
truncating it.

**The 44 Rule.** No interactive target is under 44px in either dimension. This is
a courtside product used one-handed; it is not negotiable, and it outranks
density.

## Components

### Buttons
- **Shape:** gently rounded (10px), 1px Separator border, 44px minimum height.
- **Primary:** System Blue fill, Panel white text, weight 600, padding `10px 16px`. Used for the single most likely action in a view.
- **Secondary:** Panel white fill, Label text, Separator border, padding `10px 12px`. The default.
- **Destructive:** Panel white fill, System Red text, Separator border — red text, never a red fill, except for an active Stop control.
- **Pressed:** fill shifts to System Blue Pressed with System Blue text, plus a `scale(0.95)` transform over 0.12s. Touch devices get a 10ms haptic on the same event.
- **Disabled:** 50% opacity, `cursor: not-allowed`. Opacity must reflect the control's real disabled state — a live control styled as inert is a bug this product has shipped before.

### Tool Rows (signature component)
The vertical rail's row is the most-used control in the app. Labelled mode is an
icon in a fixed 26px box plus a left-aligned label that **wraps to two lines**
rather than truncating; icon-only mode is a centred 44×44 square. Active state is
a full System Blue fill. Rows never ellipsise — a coach must be able to read the
whole tool name.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Panel white on Grouped Background.
- **Shadow Strategy:** none at rest; see Elevation.
- **Border:** 1px Separator.
- **Internal Padding:** 16px, or `22px 20px` for dialogs.

### Dialogs
Two families. **Light dialogs** (Panel white, 16px radius, Dialog shadow) for
ordinary confirmations. **Dark dialogs** (Overlay Panel `#1C1C1E` on a 0.72 scrim,
`rgba(255,255,255,0.12)` border) only when the dialog sits over video and a white
sheet would blow out the frame. Never mix the two families in one flow.

### Status Toast
A centred, top-anchored pill on `rgba(250,249,247,0.97)` with Label text at
weight 600, 16px radius, 1px `#E5E5E5` border and the Toast shadow. It is
`aria-live="polite"` and `pointer-events: none` unless it carries an action.
Maximum width `min(480px, 100vw - 24px)`; text wraps rather than clipping.

### Inline Error
Warm-tinted (`#FFF7ED`) with `#9A3412` text and a `#FCA5A5` border, at Label
size. Used inside narrow rails where a toast would be missed. Text wraps; it is
never reduced to a bare icon, because an icon-only failure reads as nothing
happening.

### Navigation
Route-level navigation is quiet: Label text at body size, System Blue for the
active item, no underlines, no pills. Marketing surfaces carry a sticky
translucent nav — the one place `backdrop-filter` is permitted, because there is
no video beneath it.

## Do's and Don'ts

### Do:
- **Do** take every colour from `styles/tokens.css` via `var(--cl-*)`. The token file is the source of truth; today only ~30 references use it against 1,106 hardcoded hex values, and every new hex literal deepens that gap.
- **Do** keep System Blue for interactive and selected states only — the One Voice Rule.
- **Do** hold 44px minimum touch targets in both dimensions, on desktop as well as phone.
- **Do** wrap label text to a second line instead of truncating or ellipsising it.
- **Do** separate surfaces with a 1px Separator border before considering shadow.
- **Do** use a dark dialog only when it sits over video.
- **Do** give every disabled control an opacity that matches its real state.

### Don't:
- **Don't** introduce a red brand accent. Red is destructive and stop, only. The landing page already carries an explicit rejection of the previous off-brand red.
- **Don't** pull colours from Tailwind's default palette. `#F59E0B` (amber-500), `#78716C` (stone-500) and `bg-blue-600` (`#2563EB`) are currently leaking in and are all wrong; the unused `coach-blue` / `coach-gray` config in `tailwind.config.js` is dead and should not be revived.
- **Don't** use `backdrop-filter` on any surface over the video — the No-Blur Rule.
- **Don't** build dark-mode-first chrome. This product is a light theme. The only sanctioned dark surfaces are the video-adjacent overlay scrim and its dialogs.
- **Don't** use `#1A1A1A` for text. It appears 91 times and is drift; Label (`#1D1D1F`) is normative.
- **Don't** add a fourth separator grey. `#E5E5E5`, `#E5E5EA` and `#E8E8ED` are all drift toward Separator (`#D1D1D6`).
- **Don't** add radii outside 8 / 10 / 16 / 999. The 4px, 6px, 12px and 14px values in the codebase are drift, not scale.
- **Don't** write `-apple-system, sans-serif` as a shorthand — it drops the Windows and Android fallbacks. Use the full stack, via `var(--cl-font)`.
