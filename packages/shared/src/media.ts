import { Node, mergeAttributes } from '@tiptap/core';

/**
 * MEDIA node — the document-model reference to an uploaded image (ADR 0012).
 *
 * CRITICAL: the binary NEVER lives here. This node stores only a stable `mediaId`
 * (plus render hints), so it is a tiny, ordinary ProseMirror node that seeds/serializes
 * through Yjs like any block — it converges across collaborators, survives reload,
 * undoes/redoes, and (once inserted) survives offline sync. The actual bytes live in
 * object storage behind an authenticated endpoint; the client attaches a node view that
 * fetches them (see apps/web media node view). No base64, no binary in the CRDT.
 *
 * This node is part of the SHARED schema so the server's seeding/template schema
 * (`getSchema(buildBaseExtensions())`) agrees with the client — otherwise the Yjs ⇄
 * ProseMirror mapping would be corrupted.
 */

/** Image MIME types the MVP accepts (must match the server's allow-list). */
export const ALLOWED_MEDIA_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedMediaMime = (typeof ALLOWED_MEDIA_MIME)[number];

export function isAllowedMediaMime(mime: string | null | undefined): mime is AllowedMediaMime {
  return !!mime && (ALLOWED_MEDIA_MIME as readonly string[]).includes(mime);
}

/** File extensions accepted by the file picker (mirrors {@link ALLOWED_MEDIA_MIME}). */
export const ALLOWED_MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * How the media block participates in the surrounding document (ADR 0012). This is
 * DOCUMENT-SEMANTIC layout state — it lives in the node's attributes and therefore
 * travels through Yjs and converges across collaborators (never client-only DOM state).
 *
 * The media node is a block-level atom (see below), so these modes are the deterministic,
 * block-schema-compatible analogue of a word processor's image layout:
 *   - `block`      — a standalone block on its own line, positioned by {@link MediaAlign}
 *                    ("break text" in a word processor: content flows above/below it).
 *   - `wrap-left`  — floats to the left; following blocks wrap to its right.
 *   - `wrap-right` — floats to the right; following blocks wrap to its left.
 * True in-paragraph "inline" placement is intentionally NOT offered: the node is a block
 * (mixing block/inline for one node type is impossible in ProseMirror, and inline media
 * would fight the top-level A4 pagination). `wrap-left`/`wrap-right` cover the practical
 * "flow text around the image" need deterministically. See docs/architecture.
 */
export const MEDIA_LAYOUTS = ['block', 'wrap-left', 'wrap-right'] as const;
export type MediaLayout = (typeof MEDIA_LAYOUTS)[number];
export function isMediaLayout(v: unknown): v is MediaLayout {
  return typeof v === 'string' && (MEDIA_LAYOUTS as readonly string[]).includes(v);
}

/** Horizontal placement of a `block`-layout media node within the content column. */
export const MEDIA_ALIGNS = ['left', 'center', 'right'] as const;
export type MediaAlign = (typeof MEDIA_ALIGNS)[number];
export function isMediaAlign(v: unknown): v is MediaAlign {
  return typeof v === 'string' && (MEDIA_ALIGNS as readonly string[]).includes(v);
}

export interface MediaAttributes {
  /** Stable id of the media metadata row / object (a UUID). The document reference. */
  mediaId: string | null;
  /** Stored MIME type (render hint + export decision). */
  mime: string | null;
  /**
   * Displayed pixel width (layout state, in CSS px of the content column). Starts at the
   * intrinsic width and is changed by the resize interaction; it collaborates through
   * Yjs like any attribute. `null` = render at natural size. Never trusted for security.
   */
  width: number | null;
  /** Displayed pixel height (kept in step with {@link width} to preserve aspect ratio). */
  height: number | null;
  /** Accessible description. */
  alt: string | null;
  /** Document-semantic layout mode (converges across collaborators). */
  layout: MediaLayout;
  /** Horizontal placement for `block` layout. */
  align: MediaAlign;
}

/** Coerce an attribute to a finite positive integer, else null (defends the schema). */
function posIntAttr(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    media: {
      /** Insert a media node referencing an already-uploaded object. */
      setMedia: (attrs: {
        mediaId: string;
        mime?: string | null;
        width?: number | null;
        height?: number | null;
        alt?: string | null;
      }) => ReturnType;
    };
  }
}

/**
 * The media node. It is a block-level `atom` (no editable inner content) and
 * selectable, so it can be clicked and deleted with a single Backspace/Delete like a
 * normal object. `renderHTML` emits a plain `<img data-media-id>` WITHOUT a real `src`:
 * the browser never dereferences a URL from the schema, and the client node view is
 * what performs the authenticated fetch and sets the object-URL src. On the server this
 * `renderHTML` is only used to derive the schema spec, never to serve HTML.
 */
export const Media = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    // Each attribute round-trips through the clipboard HTML (`parseHTML`/`renderHTML`)
    // so copying a Scribe image and pasting it back reconstructs the SAME media node
    // (same mediaId + layout + size) without re-uploading — the binary is never in the
    // clipboard HTML, only the mediaId reference (ADR 0012).
    return {
      mediaId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-media-id'),
        renderHTML: (attrs) => (attrs.mediaId ? { 'data-media-id': attrs.mediaId } : {}),
      },
      mime: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-mime'),
        renderHTML: (attrs) => (attrs.mime ? { 'data-mime': attrs.mime } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => posIntAttr(el.getAttribute('width')),
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => posIntAttr(el.getAttribute('height')),
        renderHTML: (attrs) => (attrs.height ? { height: attrs.height } : {}),
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute('alt'),
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      layout: {
        default: 'block' as MediaLayout,
        parseHTML: (el) => {
          const v = el.getAttribute('data-layout');
          return isMediaLayout(v) ? v : 'block';
        },
        renderHTML: (attrs) => ({ 'data-layout': attrs.layout ?? 'block' }),
      },
      align: {
        default: 'center' as MediaAlign,
        parseHTML: (el) => {
          const v = el.getAttribute('data-align');
          return isMediaAlign(v) ? v : 'center';
        },
        renderHTML: (attrs) => ({ 'data-align': attrs.align ?? 'center' }),
      },
    };
  },

  parseHTML() {
    // Only an <img> carrying OUR document reference is a media node — a foreign
    // <img src="…"> (e.g. from pasted web HTML) is never turned into media, so pasting
    // arbitrary HTML can never create an externally loaded / unsafe remote media URL.
    return [{ tag: 'img[data-media-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // NB: intentionally NO `src` — the schema never carries a dereferenceable URL. The
    // per-attribute renderHTML above has already populated data-media-id/-mime/-layout/
    // -align/width/height/alt into HTMLAttributes.
    return ['img', mergeAttributes({ class: 'scribe-media' }, HTMLAttributes)];
  },

  addKeyboardShortcuts() {
    const name = this.name;
    // Guarantee a selected media node is deletable with a single Backspace/Delete.
    // (When an atom node view is NodeSelected, the default keymap chain does not always
    // reach deleteSelection; this makes removal deterministic. Returns false otherwise
    // so normal Backspace/Delete behavior elsewhere is untouched.)
    //
    // We DUCK-TYPE the NodeSelection (check for its `.node`) instead of using
    // `instanceof NodeSelection`: the app can load more than one copy of
    // `@tiptap/pm/state` (this shared package and the web app resolve it separately), so
    // a cross-package `instanceof` would be false for a genuine NodeSelection. `.node`
    // exists only on a NodeSelection, so this is both correct and copy-safe.
    const deleteIfSelected = (): boolean => {
      const { state } = this.editor;
      const selection = state.selection as { node?: { type: { name: string } } };
      if (selection.node && selection.node.type.name === name) {
        // When the media is the doc's ONLY block, deleteSelection replaces the sole
        // child wholesale (delete + paragraph backfill in one transaction). That
        // full-fragment replace is NOT translated into a Yjs deletion by y-prosemirror's
        // structural-replace path, so the node resurrects on collaborators. Append the
        // backfill paragraph in a SEPARATE transaction first, so the deletion becomes an
        // incremental "remove one of two children" that converges (mirrors the media
        // node view's Remove button). deleteSelection then removes only the media.
        if (state.doc.childCount === 1) {
          const paragraph = state.schema.nodes.paragraph?.createAndFill();
          if (paragraph) {
            this.editor.view.dispatch(state.tr.insert(state.doc.content.size, paragraph));
          }
        }
        return this.editor.commands.deleteSelection();
      }
      return false;
    };
    return { Backspace: deleteIfSelected, Delete: deleteIfSelected };
  },

  addCommands() {
    return {
      setMedia:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              mediaId: attrs.mediaId,
              mime: attrs.mime ?? null,
              width: attrs.width ?? null,
              height: attrs.height ?? null,
              alt: attrs.alt ?? null,
            },
          }),
    };
  },
});
