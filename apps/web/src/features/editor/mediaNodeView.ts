import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { type MediaAlign, type MediaLayout, isMediaAlign, isMediaLayout } from '@scribe/shared';
import { ApiError, fetchMediaBlob } from '../../api/client.js';
import { PAGE_CONTENT_WIDTH } from './pageGeometry.js';

/**
 * MEDIA node view (ADR 0012). A ProseMirror-managed view that renders a media node by
 * fetching its binary over the AUTHENTICATED endpoint and setting an object-URL
 * `<img src>`. The schema never carries a dereferenceable URL, and the binary has no
 * public URL — a non-member gets 404 and sees the error placeholder.
 *
 * Beyond rendering, the view provides the DOCUMENT-EDITOR interactions:
 *   - Remove button — deletes the node via an ordinary ProseMirror/Yjs transaction.
 *   - Layout controls (block / wrap-left / wrap-right) + block alignment (left/center/
 *     right) — write the node's `layout`/`align` attributes, so the change is document
 *     state that converges across collaborators (never client-only DOM).
 *   - Resize handle — drags a live DOM preview, then COMMITS the final width/height as a
 *     single attribute transaction on pointer-up (no per-move transactions → no
 *     collaboration noise). Width is clamped to [MIN, page content width] so an image can
 *     never exceed the page/content boundary, and aspect ratio is preserved.
 *
 * All committed state lives in node attributes (mediaId/mime/width/height/alt/layout/
 * align); transient drag state stays in local DOM only.
 */

/** Smallest width a media node may be resized to (keeps a grabbable, visible image). */
const MIN_MEDIA_WIDTH = 48;

class MediaView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private caption: HTMLElement;
  private removeBtn: HTMLButtonElement;
  private controls: HTMLElement;
  private resizeHandle: HTMLElement;
  private objectUrl: string | null = null;
  private mediaId: string | null = null;
  private destroyed = false;
  /** Natural aspect ratio (w/h) once the image loads; drives aspect-locked resize. */
  private aspect: number | null = null;
  private onPointerMove?: (e: PointerEvent) => void;
  private onPointerUp?: (e: PointerEvent) => void;

  constructor(
    private node: PMNode,
    private readonly documentId: string,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('figure');
    this.dom.className = 'scribe-media-figure';
    // NB: do NOT set contenteditable=false on the wrapper. ProseMirror manages an atom
    // node view's selection itself; forcing the wrapper non-editable steals focus.

    this.img = document.createElement('img');
    this.img.className = 'scribe-media-img';
    this.img.alt = (node.attrs.alt as string | null) ?? '';
    this.img.addEventListener('load', () => {
      if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
        this.aspect = this.img.naturalWidth / this.img.naturalHeight;
      }
    });

    this.caption = document.createElement('figcaption');
    this.caption.className = 'scribe-media-status';

    this.controls = this.buildControls();
    this.removeBtn = this.buildRemoveButton();
    this.resizeHandle = this.buildResizeHandle();

    this.dom.append(this.controls, this.removeBtn, this.img, this.resizeHandle, this.caption);
    this.applyLayoutAttrs();
    this.render();
  }

  // ---- chrome (buttons / handle) ------------------------------------------------

  private buildRemoveButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scribe-media-remove';
    btn.setAttribute('aria-label', 'Remove image');
    btn.title = 'Remove image';
    btn.textContent = '✕';
    btn.contentEditable = 'false';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.remove();
    });
    return btn;
  }

  private buildControls(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'scribe-media-controls';
    bar.contentEditable = 'false';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Image layout');
    // Prevent a mousedown on the bar from moving the ProseMirror selection off the node.
    bar.addEventListener('mousedown', (e) => e.preventDefault());

    const mkBtn = (label: string, glyph: string, onClick: () => void, group: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scribe-media-ctl';
      b.dataset.group = group;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = glyph;
      b.contentEditable = 'false';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        onClick();
      });
      return b;
    };

    // Layout modes.
    bar.append(
      mkBtn('Align image left', '⤆', () => this.setBlockAlign('left'), 'align'),
      mkBtn('Center image', '▭', () => this.setBlockAlign('center'), 'align'),
      mkBtn('Align image right', '⤇', () => this.setBlockAlign('right'), 'align'),
      mkBtn('Wrap text left', '◧', () => this.setLayout('wrap-left'), 'wrap'),
      mkBtn('Wrap text right', '◨', () => this.setLayout('wrap-right'), 'wrap'),
    );
    return bar;
  }

  private buildResizeHandle(): HTMLElement {
    const handle = document.createElement('span');
    handle.className = 'scribe-media-resize';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('mousedown', (e) => e.preventDefault());
    handle.addEventListener('pointerdown', (e) => this.startResize(e));
    return handle;
  }

  // ---- document-semantic layout/align ------------------------------------------

  private setLayout(layout: MediaLayout): void {
    // Toggling a wrap mode off returns to a centered block.
    const next = this.node.attrs.layout === layout ? 'block' : layout;
    this.updateAttrs({ layout: next });
  }

  private setBlockAlign(align: MediaAlign): void {
    // Choosing an alignment always implies block layout (alignment only applies there).
    this.updateAttrs({ layout: 'block', align });
  }

  /** Commit an attribute change on this node as one ProseMirror/Yjs transaction. */
  private updateAttrs(patch: Record<string, unknown>): void {
    if (!this.view.editable) return;
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch });
    this.view.dispatch(tr);
  }

  private applyLayoutAttrs(): void {
    const layout: MediaLayout = isMediaLayout(this.node.attrs.layout)
      ? this.node.attrs.layout
      : 'block';
    const align: MediaAlign = isMediaAlign(this.node.attrs.align)
      ? this.node.attrs.align
      : 'center';
    this.dom.dataset.layout = layout;
    this.dom.dataset.align = align;
    const width = this.node.attrs.width as number | null;
    // Displayed width is document state; max-width:100% in CSS still guards the boundary.
    this.img.style.width = typeof width === 'number' && width > 0 ? `${width}px` : '';
    // Reflect the active mode on the control buttons.
    for (const b of Array.from(this.controls.querySelectorAll<HTMLElement>('.scribe-media-ctl'))) {
      const group = b.dataset.group;
      const active =
        (group === 'wrap' &&
          ((layout === 'wrap-left' && b.getAttribute('aria-label') === 'Wrap text left') ||
            (layout === 'wrap-right' && b.getAttribute('aria-label') === 'Wrap text right'))) ||
        (group === 'align' &&
          layout === 'block' &&
          b.getAttribute('aria-label') ===
            (align === 'left'
              ? 'Align image left'
              : align === 'right'
                ? 'Align image right'
                : 'Center image'));
      b.classList.toggle('is-active', active);
    }
  }

  // ---- resize -------------------------------------------------------------------

  private startResize(e: PointerEvent): void {
    if (!this.view.editable) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = this.img.getBoundingClientRect().width || this.img.naturalWidth || 200;
    const aspect =
      this.aspect ??
      (this.img.naturalWidth > 0 && this.img.naturalHeight > 0
        ? this.img.naturalWidth / this.img.naturalHeight
        : null);
    this.dom.classList.add('is-resizing');
    try {
      this.resizeHandle.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw in rare cases; the move/up listeners still work. */
    }

    const clampWidth = (w: number) =>
      Math.round(Math.max(MIN_MEDIA_WIDTH, Math.min(PAGE_CONTENT_WIDTH, w)));

    this.onPointerMove = (ev: PointerEvent) => {
      const w = clampWidth(startWidth + (ev.clientX - startX));
      // Live DOM preview only — NOT a document transaction (no collaboration noise).
      this.img.style.width = `${w}px`;
    };
    this.onPointerUp = () => {
      this.dom.classList.remove('is-resizing');
      window.removeEventListener('pointermove', this.onPointerMove!);
      window.removeEventListener('pointerup', this.onPointerUp!);
      this.onPointerMove = undefined;
      this.onPointerUp = undefined;
      const finalWidth = clampWidth(this.img.getBoundingClientRect().width);
      const patch: Record<string, unknown> = { width: finalWidth };
      if (aspect) patch.height = Math.round(finalWidth / aspect);
      // Commit exactly once, as a single attribute transaction that converges via Yjs.
      this.updateAttrs(patch);
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  // ---- delete -------------------------------------------------------------------

  /** Delete this media node via a normal ProseMirror/Yjs transaction on its position. */
  private remove(): void {
    if (!this.view.editable) return;
    if (typeof this.getPos() !== 'number') return;

    // Deleting the document's ONLY block is the tricky case. A single transaction that
    // deletes the media and backfills a paragraph replaces the fragment's sole child
    // wholesale — and y-prosemirror's structural full-replace path does NOT translate
    // that into a Yjs deletion, so the node resurrects on collaborators (and re-syncs
    // back to the deleter). Instead, when media is the only block, first append the
    // backfill paragraph in a SEPARATE transaction; the media deletion is then an
    // incremental "remove one of two children", which y-prosemirror does map to a real
    // Yjs delete that converges. (A multi-block doc already hits this incremental path.)
    if (this.view.state.doc.childCount === 1) {
      const { state } = this.view;
      const paragraph = state.schema.nodes.paragraph?.createAndFill();
      if (paragraph) this.view.dispatch(state.tr.insert(state.doc.content.size, paragraph));
    }

    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  // ---- rendering / lifecycle ----------------------------------------------------

  private setStatus(text: string, kind: 'loading' | 'error' | 'ok'): void {
    this.caption.textContent = text;
    this.dom.dataset.state = kind;
  }

  private render(): void {
    const nextId = (this.node.attrs.mediaId as string | null) ?? null;
    if (!nextId) {
      this.setStatus('Media unavailable', 'error');
      return;
    }
    if (nextId === this.mediaId && this.objectUrl) return; // already loaded this id
    this.mediaId = nextId;
    this.img.alt = (this.node.attrs.alt as string | null) ?? '';
    void this.load(nextId);
  }

  private async load(mediaId: string): Promise<void> {
    this.setStatus('Loading image…', 'loading');
    try {
      const blob = await fetchMediaBlob(this.documentId, mediaId);
      if (this.destroyed || this.mediaId !== mediaId) return;
      this.revoke();
      this.objectUrl = URL.createObjectURL(blob);
      this.img.src = this.objectUrl;
      this.setStatus('', 'ok');
    } catch (err) {
      if (this.destroyed) return;
      const msg =
        err instanceof ApiError && err.status === 404
          ? 'Image not available'
          : 'Could not load image';
      this.setStatus(msg, 'error');
    }
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** ProseMirror calls this when the node updates; refetch only if the id changed. */
  update(node: PMNode): boolean {
    if (node.type.name !== 'media') return false;
    this.node = node;
    this.applyLayoutAttrs();
    this.render();
    return true;
  }

  /**
   * The node is an atom leaf whose internal DOM (async image load, status text, remove
   * button, controls) is entirely owned by this view — ProseMirror must never read it
   * back into the document. Ignoring all mutations is correct for a leaf.
   */
  ignoreMutation(): boolean {
    return true;
  }

  /** Let this view own pointer/mouse events on its own chrome (buttons, handle, bar). */
  stopEvent(event: Event): boolean {
    const t = event.target as Node | null;
    if (!t) return false;
    return (
      this.removeBtn.contains(t) ||
      this.controls.contains(t) ||
      this.resizeHandle.contains(t) ||
      this.resizeHandle === t
    );
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  destroy(): void {
    this.destroyed = true;
    if (this.onPointerMove) window.removeEventListener('pointermove', this.onPointerMove);
    if (this.onPointerUp) window.removeEventListener('pointerup', this.onPointerUp);
    this.revoke();
  }
}

/**
 * Factory bound to the current document id, for `editorProps.nodeViews.media`. Keeping
 * the view client-only (here, not in the shared schema) means the shared `media` node
 * stays pure schema — the server never needs React/DOM or the fetch logic.
 */
export function createMediaNodeView(documentId: string) {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView =>
    new MediaView(node, documentId, view, getPos);
}
