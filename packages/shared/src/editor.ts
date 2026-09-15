import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Node, type Extensions, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { isSafeLinkUrl } from './linkPolicy.js';
import { Media } from './media.js';
import { Comment } from './comment.js';
import { Indent } from './indent.js';

/**
 * The editor / CRDT SCHEMA, shared by both apps (project-structure.md places
 * "CRDT schema helpers" in @scribe/shared so the client and server cannot drift).
 *
 * Why it must be shared: the server seeds brand-new collaborative documents by
 * converting {@link INITIAL_DOCUMENT_CONTENT} (ProseMirror JSON) into a Yjs
 * `Y.XmlFragment` via `y-prosemirror`. That conversion needs the *exact* same
 * ProseMirror schema the browser editor uses — any mismatch in allowed
 * nodes/marks/attrs would corrupt the mapping. Defining the base extensions once
 * here guarantees they agree.
 *
 * The web app builds its live editor as `[...buildBaseExtensions(), Collaboration,
 * CollaborationCursor]`; the server uses only the base set to derive the schema.
 */

/** Heading levels exposed by the MVP (Paragraph + H1–H3). */
export const HEADING_LEVELS = [1, 2, 3] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

/**
 * The Yjs fragment name Tiptap's Collaboration extension binds to. Both the
 * client (`Collaboration.configure({ field })`) and the server seeding path
 * (`prosemirrorJSONToYDoc(schema, json, COLLAB_FIELD)`) must use this value.
 * `'default'` is Tiptap's Collaboration default.
 */
export const COLLAB_FIELD = 'default';

// Tiptap command typing: augment the command map so `setPageBreak()` is typed
// wherever the shared schema is used (client editor + tests).
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert a manual page break at the current selection. */
      setPageBreak: () => ReturnType;
    };
  }
}

/**
 * A manual, block-level page break — the document-model representation behind the
 * Ctrl/Cmd+Enter shortcut (task §3). It is a real ProseMirror node, so it lives in
 * the shared schema and therefore:
 *   - is seeded/serialized through Yjs exactly like any other block (survives
 *     reload, persistence, offline, reconnect, and converges across collaborators);
 *   - participates in Yjs-aware undo/redo like any other structural edit;
 *   - is NOT a DOM-only marker.
 *
 * It is an `atom` (no editable content) and `selectable` (so it can be selected and
 * deleted, and so undo/redo of its insertion/removal behaves correctly). The
 * VISUAL "fill the rest of the page" behavior is a presentation concern handled by
 * the web app's pagination decorations; here we only define the schema + command +
 * keyboard shortcut so both apps agree on the node.
 */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  // A page break is a STRUCTURAL layout marker, not a user-selectable object, so it
  // is NOT selectable. This is the core of the "giant blue rectangle" fix:
  //   - The pagination layer decorates the break's DOM to fill the rest of the page
  //     (up to a full A4 height). If the node were selectable, clicking that large
  //     empty area — or pressing Backspace at the start of the paragraph after it —
  //     would create a `NodeSelection` on the break, rendering it as a page-sized
  //     `.ProseMirror-selectednode` outline (and, for Backspace, requiring a second
  //     press to actually delete). With `selectable: false`, a click resolves to the
  //     nearest editable text position instead, and Backspace never parks a
  //     NodeSelection on the break.
  //   - Removal still works through NORMAL editing: the Backspace/Delete shortcuts
  //     below delete the break in a single, ordinary ProseMirror transaction (so Yjs,
  //     undo/redo, offline, and collaboration all capture it like any other edit).
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },

  renderHTML() {
    return ['div', { 'data-page-break': 'true', class: 'scribe-page-break' }];
  },

  addCommands() {
    // A page break must ALWAYS be a direct child of the document — never nested
    // inside a list, blockquote, or other container. If it were nested (e.g. when the
    // caret is in a list item and the user presses Ctrl/Cmd+Enter), the pagination
    // layer — which flows only TOP-LEVEL blocks onto pages — would not see it, and the
    // break would produce a malformed, collapsed layout (task §6, the "list" case).
    //
    // So we insert the break AFTER the top-level block that contains the caret, plus a
    // trailing empty paragraph to type into, and place the caret there. The following
    // content therefore begins on the next page as a normal top-level block, and the
    // list (or paragraph) that preceded the break is left intact and valid.
    return {
      setPageBreak:
        () =>
        ({ chain, state }) => {
          const { $from } = state.selection;
          // Position immediately after the depth-1 (top-level) ancestor block. `after`
          // requires a valid depth; fall back to the caret position defensively.
          const insertPos = $from.depth >= 1 ? $from.after(1) : $from.pos;

          return chain()
            .insertContentAt(insertPos, [{ type: this.name }, { type: 'paragraph' }])
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                // Caret into the new paragraph: after the atomic break (nodeSize 1)
                // and past the paragraph's opening token.
                const paraPos = Math.min(insertPos + 2, tr.doc.content.size);
                tr.setSelection(TextSelection.create(tr.doc, paraPos));
                tr.scrollIntoView();
              }
              return true;
            })
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    const name = this.name;

    // Delete an explicit page break with a SINGLE key press, using a normal
    // ProseMirror transaction (never DOM mutation / setContent), when the caret sits
    // at the natural editing boundary next to it:
    //   - Backspace at the very START of a top-level paragraph/heading whose previous
    //     sibling is a page break  → remove that break (merges the two logical pages).
    //   - Delete at the very END of a top-level paragraph/heading whose next sibling
    //     is a page break          → remove that break.
    // Scoped to depth-1 text blocks (`$from.depth === 1`) so it NEVER hijacks normal
    // Backspace/Delete inside lists or in the middle of a block; anything else returns
    // false and falls through to ProseMirror's default handling. Because `pageBreak`
    // is not selectable, the default `selectNodeBackward`/`selectNodeForward` can no
    // longer park a NodeSelection on the break — these handlers give it a clean,
    // one-press removal instead.
    const removeAdjacentBreak = (direction: 'before' | 'after') => (): boolean =>
      this.editor.commands.command(({ state, tr, dispatch }) => {
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.depth !== 1) return false;

        if (direction === 'before') {
          if ($from.parentOffset !== 0) return false;
          const boundary = $from.before(1);
          const prev = state.doc.resolve(boundary).nodeBefore;
          if (!prev || prev.type.name !== name) return false;
          if (dispatch) tr.delete(boundary - prev.nodeSize, boundary).scrollIntoView();
          return true;
        }

        if ($from.parentOffset !== $from.parent.content.size) return false;
        const boundary = $from.after(1);
        const next = state.doc.resolve(boundary).nodeAfter;
        if (!next || next.type.name !== name) return false;
        if (dispatch) tr.delete(boundary, boundary + next.nodeSize).scrollIntoView();
        return true;
      });

    // `Mod` = Ctrl on Windows/Linux and Cmd on macOS, satisfying both the
    // Ctrl+Enter and Command+Enter requirements with one binding.
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
      Backspace: removeAdjacentBreak('before'),
      Delete: removeAdjacentBreak('after'),
    };
  },
});

/**
 * Base editor extensions = the document schema + editing behavior, with NO local
 * history. Undo/redo is owned by Tiptap's Collaboration extension (a Yjs
 * `UndoManager` scoped to the local user), so StarterKit's history is disabled
 * here to avoid two competing history stacks.
 *
 * `PageBreak` is part of the BASE schema (not a client-only add-on) so the server's
 * seeding schema (`getSchema(buildBaseExtensions())`) and template-copy path can
 * represent documents that contain page breaks without corrupting the Yjs mapping.
 *
 * `Underline` (a mark) and `TextAlign` (a node ATTRIBUTE on paragraphs/headings)
 * are part of this SHARED base for the same reason: `TextAlign` adds a `textAlign`
 * attribute to the paragraph/heading node spec, so the server's seeding/
 * reconstruction schema must know about it too — otherwise a client-only attribute
 * would corrupt the Yjs ⇄ ProseMirror mapping. Both are ordinary document
 * formatting, so they persist, collaborate, work offline, and undo/redo through the
 * existing Yjs pipeline with no extra machinery.
 *
 * SHARED because they change the schema (task §9):
 *   - `Strike` (mark), `Code` (inline mark), and `Blockquote` (block node) already
 *     ship inside `StarterKit`, so they have ALWAYS been part of this shared schema —
 *     this phase only wires the toolbar/exporters to them; no schema change and no
 *     document migration is involved.
 *   - `TaskList`/`TaskItem` (block nodes with a document-level `checked` attribute)
 *     and `Link` (an inline mark) are NEW schema members added here so the server's
 *     seeding/template schema stays byte-for-byte compatible with the client. The
 *     task `checked` state is therefore DOCUMENT data (lives in the ProseMirror/Yjs
 *     doc, never React/Zustand/localStorage — task §4), and links persist/collaborate
 *     through the same Yjs pipeline as any other mark.
 *
 * The `Link` mark enforces the shared {@link isSafeLinkUrl} allow-list via
 * `isAllowedUri`, so a dangerous scheme (`javascript:`, `data:`, …) is rejected both
 * when set through the toolbar and when parsed from pasted HTML (task §14). Links
 * render with `rel="noopener noreferrer nofollow"` and never auto-open on click in
 * the editor.
 */
export function buildBaseExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      // Collaboration provides collaborative (per-user) undo/redo instead.
      history: false,
    }),
    Underline,
    // Alignment is stored as a `textAlign` attribute on the block node — explicitly
    // scoped to the block types the MVP schema supports (never applied to lists,
    // list items, or the page-break atom).
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // Tab/Shift-Tab indentation as a `paragraph`/`heading` node attribute (task §B).
    // A SHARED schema member (like TextAlign) so the server seeding schema agrees; it
    // defers to lists, so list Tab = sink / Shift-Tab = lift is untouched.
    Indent,
    // Real task checklist: a block list whose items carry a document `checked`
    // attribute. `nested: true` lets Tab/Shift-Tab nest sub-tasks like a normal list.
    TaskList,
    TaskItem.configure({ nested: true }),
    // Hyperlinks. `openOnClick: false` keeps clicks inside the editor from navigating
    // away mid-edit (the popover manages URLs); the safety allow-list is enforced for
    // BOTH programmatic setLink and pasted/typed HTML through `isAllowedUri`.
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto', 'tel'],
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      isAllowedUri: (url) => isSafeLinkUrl(url),
      shouldAutoLink: (url) => isSafeLinkUrl(url),
    }),
    // Media node (ADR 0012): a document reference to an uploaded image. The binary is
    // NEVER in the schema/CRDT — only a stable mediaId. Shared so the server seeding
    // schema agrees. The client attaches a node view that authenticated-fetches bytes.
    Media,
    // Inline comment anchor (ADR 0013): a mark carrying commentId; thread data lives in
    // a Y.Map in the same Y.Doc. The mark moves with the text via ProseMirror mapping.
    Comment,
    PageBreak,
  ];
}

/**
 * The seed content for a BLANK document: a single empty paragraph — the minimal
 * valid ProseMirror doc for this schema. A blank document copies nothing from any
 * other document; it opens as a genuinely empty A4 page (task §1). Seeded ONCE, on
 * the server, the first time a document with no persisted CRDT state is loaded, so
 * exactly one writer creates the initial state (no double-seed race).
 */
export const EMPTY_DOCUMENT_CONTENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Realistic sample content, mirroring the "Q3 Project Strategy & Architecture"
 * reference in UI/screen.png — never lorem ipsum. This is NO LONGER the default
 * seed for new documents (blank documents are empty, see {@link EMPTY_DOCUMENT_CONTENT});
 * it is retained as reusable sample content (e.g. for tests and demos). System
 * templates define their own content in `templates.ts`.
 */
export const INITIAL_DOCUMENT_CONTENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'As our engineering and design teams scale across distributed hubs, synchronous meetings have become a significant bottleneck. This strategy establishes a unified real-time collaborative workspace that bridges rapid ideation with robust offline-first synchronization.',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Core Objectives' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Our primary benchmark is absolute perceived instantaneity. Every keystroke must evaluate deterministically in local client memory within ',
        },
        { type: 'text', marks: [{ type: 'bold' }], text: '8 milliseconds' },
        {
          type: 'text',
          text: ', while remaining resilient against sporadic network degradation.',
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Zero-latency state convergence across distributed clients using Conflict-free Replicated Data Types (CRDTs).',
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Frictionless offline editing with deterministic background conflict resolution across multi-tenant edge nodes.',
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Granular workspace permissions with enterprise auditability and tamper-proof revision logs.',
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Architecture & Next Milestones' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The document synchronizer encapsulates local operational mutations via a compact binary vector clock protocol. Rather than round-tripping through monolithic application servers, state reconciles peer-to-peer via lightweight transports.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The rollout proceeds in three sequenced milestones, each gated on the previous passing its convergence and durability checks:',
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Vector clock sync' },
                { type: 'text', text: ' — deterministic ordering ready for canary.' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Offline store' },
                {
                  type: 'text',
                  text: ' — durable local persistence so edits survive reloads and reconnects.',
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Presence & huddles' },
                { type: 'text', text: ' — live cursors and audio, currently ' },
                { type: 'text', marks: [{ type: 'italic' }], text: 'in flight' },
                { type: 'text', text: '.' },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Telemetry & Metrics' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Success is measured against perceived responsiveness, not raw server throughput. We instrument the local apply path and the reconciliation window separately so regressions surface before they reach users.',
        },
      ],
    },
  ],
};
