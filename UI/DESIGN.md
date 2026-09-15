---
name: Editorial Precision Document System
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#454655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#757687'
  outline-variant: '#c6c5d8'
  surface-tint: '#3c4ae0'
  primary: '#1c2ac8'
  on-primary: '#ffffff'
  primary-container: '#3b49df'
  on-primary-container: '#d2d4ff'
  inverse-primary: '#bdc2ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#900029'
  on-tertiary: '#ffffff'
  tertiary-container: '#bb093a'
  on-tertiary-container: '#ffcacd'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e0e0ff'
  primary-fixed-dim: '#bdc2ff'
  on-primary-fixed: '#000668'
  on-primary-fixed-variant: '#1d2cc9'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdadb'
  tertiary-fixed-dim: '#ffb2b7'
  on-tertiary-fixed: '#40000d'
  on-tertiary-fixed-variant: '#92002a'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-display:
    fontFamily: Newsreader
    fontSize: 48px
    fontWeight: '400'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: '500'
    lineHeight: 44px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 26px
    fontWeight: '500'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-editorial:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 30px
    letterSpacing: 0em
  body-default:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
  code-default:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

The design system embodies the focus of a physical writer's desk married to the precision of a high-performance modern development environment. It avoids both the bureaucratic density of legacy word processors and the chaotic block-sprawl of modular database-driven workspaces.

The aesthetic is grounded in **Editorial Minimalism**:

- **Atmospheric Isolation:** A muted titanium-sand background recedes from visual attention, elevating the active document canvas as the hero surface.
- **Micro-tactile Precision:** UI chrome remains invisible until summoned or hovered, using disciplined 1.5px vector strokes, crisp hairpins, and subtle optical balance.
- **Collaborative Presence:** Real-time presence indicators (cursors, avatars, inline comments) punctuate the calm canvas with sharp, saturated jewel tones without compromising document focus.
- **Typographic Authority:** Clear delineation between "Interface UI" (disciplined, geometric, low-profile) and "Document Prose" (expressive, rhythmic, typographically strict).

## Colors

The palette uses low-energy tonal field surfaces paired with surgical, high-density accents.

### Surface Architecture

- **Workspace Background (`#F6F7F9`):** A soft titanium-sand neutral that frames the viewport without emitting high-glare eye fatigue.
- **Document Sheet (`#FFFFFF`):** Absolute white, reserved strictly for the primary text substrate to yield maximum contrast against body text.
- **Surface Elevation Tiers:**
  - `surface-elevated` (`#FFFFFF`): Flyout menus, slash-command palettes, floating format toolbars.
  - `surface-subtle` (`#F1F2F5`): Inactive icon button containers, table header cells, code fence blocks.
  - `surface-border` (`#EAEBED`): Structural micro-borders dividing document bounds from chrome.

### Accent & Identity Tokens

- **Primary Ink (`#3B49DF`):** Tailored Indigo-Slate. Used for focused selection states, primary call-to-action triggers, and active tab rules.
- **Presence Tokens (Multiplayer Collab):**
  - `presence-1` (`#10B981` / Emerald): Peer cursor, live selection glow, comment thread 1.
  - `presence-2` (`#F43F5E` / Warm Coral): Peer cursor, selection anchor, comment thread 2.
  - `presence-3` (`#F59E0B` / Vivid Amber): Peer cursor, annotation mark, comment thread 3.
  - `presence-4` (`#8B5CF6` / Iris Violet): Peer cursor, version history marker.

### Typography Ink

- **Text Primary (`#0F172A`):** Deep slate-black for high legibility on white sheets.
- **Text Secondary (`#475569`):** Subheadings, active meta-data, and interface titles.
- **Text Muted (`#94A3B8`):** Hotkeys, timestamps, placeholder copy, collapsed section icons.

## Typography

The type scale bifurcates clean application UI from high-readability content composition:

1. **Document Spine (`Newsreader`):** Handles document titles, major section headers, block quotes, and editorial long-form modes. The optical sizing prioritizes cadence, comfortable eye tracking across a standard 720px sheet width, and low friction during deep reading.
2. **Interface Chrome (`Plus Jakarta Sans`):** Drives sidebars, context toolbars, avatar metadata, slash commands, and modal configurations. Neutral geometric sans architecture maintains crisp micro-legibility at 11px and 13px sizes.
3. **Monospace Engine (`JetBrains Mono`):** Dedicated to code tokens, math blocks, markdown syntax hints, and keyboard shortcut chips.

## Layout & Spacing

### Page Layout

- **The Floating Sheet Model:** The document canvas occupies a fixed optical column centered dynamically within the workspace viewport:
  - Default Reading Width: `760px`
  - Wide Presentation Width: `980px`
  - Full Canvas (Tables & Boards): `1200px` max-width with fluid edge bleed.
- **Panels & Navigation:**
  - Collapsible Document Tree / Left Sidebar: Fixed `260px`.
  - Contextual Inspector / Discussion Drawer: Fixed `320px`, anchored right.
  - Floating Command Bar / Slash Menu: Fixed `440px`.

### Responsive Breakpoints

- **Desktop (`>= 1280px`):** Full tripartite workspace (Document Tree, Centered Sheet, Annotation Gutter).
- **Tablet (`768px - 1279px`):** Left tree and right inspector collapse into slide-over sheets. Document sheet auto-expands with a minimum `32px` gutter on left and right.
- **Mobile (`< 768px`):** Sheet container loses external rounded corners and ambient dropshadows, pinning flush `0px` against viewport edges with `16px` inner document padding.

## Elevation & Depth

Visual hierarchy uses ultra-fine structural lines paired with soft, highly diffused ambient shadowing. Harsh, high-contrast borders and muddy multi-layered shadows are avoided.

### Elevation Levels

- **Level 0 (Workspace Canvas):** Flat `#F6F7F9` base surface.
- **Level 1 (Document Page):** Pure white (`#FFFFFF`) surface framed by a 1px border of `#EAEBED` and an ambient perimeter shadow:
  - `box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03), 0 12px 32px -4px rgba(15, 23, 42, 0.04);`
- **Level 2 (In-Canvas Cards, Hover Nodes, Inline Blocks):**
  - `box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04), 0 8px 16px -2px rgba(15, 23, 42, 0.03);`
  - Border: `1px solid #EAEBED`
- **Level 3 (Floating Overlays, Slash Palette, Text Selection Popovers):**
  - Backdrop filter: `blur(8px)` with `rgba(255, 255, 255, 0.92)` fill.
  - `box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06), 0 20px 36px -6px rgba(15, 23, 42, 0.08);`
  - Border: `1px solid rgba(226, 232, 240, 0.8)`
- **Level 4 (Modal Windows, Workspace Switchers):**
  - Backdrop overlay: `rgba(15, 23, 42, 0.2)` with `blur(2px)`.
  - `box-shadow: 0 16px 48px -8px rgba(15, 23, 42, 0.14);`

## Shapes

The interface maintains a disciplined structural language based on 8px base curves (`roundedness: 2`):

- **Document Surface:** `8px` (`0.5rem`) top and bottom corners in floating desktop presentation, terminating cleanly to `0px` when hitting viewport boundaries.
- **Buttons, Menus, & Inputs:** Uniform `8px` (`rounded-md` to `rounded-lg`). Provides a soft visual contour that does not deteriorate into playful pill capsules.
- **Selection Badges, Avatar Nodes, & Micro Status Pills:** `9999px` strictly reserved for collaborative presence counters and transient real-time user labels.
- **Code Snippets & Media Embeds:** `6px` internal radius nested precisely inside `8px` container bounds.

## Components

### Buttons

- **Primary:** Filled `#3B49DF` with white text. High micro-contrast. Height: 36px (compact) / 40px (default). Internal padding: 14px horizontal. Border radius: 8px. Hover: `#323ec2`. Active: `#2b35a8`.
- **Secondary / Ghost:** Transparent background with `#0F172A` text. Hover yields `#F1F2F5`. Stroke remains 0px, relying on background shifts for affordance.
- **Icon Action Buttons (Toolbar):** 32x32px square, 8px radius. Active state (e.g., Bold toggled on): `#E0E7FF` background with `#3B49DF` icon tint.

### Floating Text Format Ribbon

- Floats horizontally above text selections.
- Translucent frosted container (`rgba(255, 255, 255, 0.94)` + 8px blur) with a 1px `#E2E8F0` hairline border.
- Segmented control groups: Style switches (H1, H2, Quotes), standard inline formats (B, I, U, Code), and collaborative reaction triggers.

### Slash-Command Dropdown Menu

- Width: 320px. Max-height: 380px with native scroll physics.
- Item Rows: 36px height, flex alignment with 16px icon slot (1.5px stroke weight).
- Hover / Arrow Navigation: Highlight row with `#F1F2F5`, rendering secondary shortcut cues (`#94A3B8`) on right edge.

### Checkboxes & Todo Lists

- Checkbox: 16x16px dimension, 4px corner radius, 1.5px border `#CBD5E1`.
- Checked State: `#3B49DF` background with crisp white checkmark. Checked text transitions immediately to strike-through with color muted to `#94A3B8`.

### Input Fields & Search Bars

- Background: `#FFFFFF`. Border: 1px `#E2E8F0`. Focused: 1px `#3B49DF` with a 3px outer glow ring of `rgba(59, 73, 223, 0.12)`.
- Internal metrics: 10px vertical padding, 12px horizontal padding, 14px body type.

### Live Presence & Collaborative Cursors

- Cursor: 1.5px vertical bar with a color-coded top flag containing the peer's first name.
- Badge chip: Height: 20px, font-size: 11px, font-weight: 600. Foreground: White. Background mapped to peer color token (`#10B981`, `#F43F5E`, `#F59E0B`, etc.).
- Active selection highlight: Peer color rendered at `14%` opacity over document text.
