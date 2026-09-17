import { Extension } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/**
 * INDENT — paragraph/heading indentation as a DOCUMENT attribute (task §B "Tab key").
 *
 * Pressing Tab inside ordinary editable text must be an editor action, not a browser
 * focus move. Rather than inserting a literal tab character (which renders and exports
 * inconsistently), we model indentation the same way {@link TextAlign} models alignment:
 * an `indent` LEVEL attribute (0..{@link MAX_INDENT}) on the `paragraph`/`heading` block
 * nodes. Because it is a real node attribute in the SHARED schema it:
 *   - persists in ProseMirror/Yjs and survives reload,
 *   - synchronizes to collaborators deterministically,
 *   - exports predictably (a left margin per level — see exportModel/pdf/docx),
 *   - and undoes/redoes through the existing Yjs pipeline.
 *
 * Tab / Shift-Tab adjust the level. Inside a list (`listItem`/`taskItem`) the handlers
 * DEFER (return false) so the list's own Tab = sink / Shift-Tab = lift behavior is
 * preserved and list structure (incl. task-checked state) is never destroyed. When the
 * editor is not editable (a viewer) the handlers do nothing, so Tab stays a normal
 * keyboard-navigation key and viewers never gain editing behavior.
 */

/** The block node types that carry an `indent` attribute (mirrors TextAlign's `types`). */
export const INDENT_TYPES = ['paragraph', 'heading'] as const;

/** Maximum indent depth (defensive clamp; deep enough for real documents). */
export const MAX_INDENT = 10;

/** CSS em per indent level, shared by the editor DOM and honored by the exporters. */
export const INDENT_STEP_EM = 2.5;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** Increase the indent level of the selected text block(s) by one. */
      indent: () => ReturnType;
      /** Decrease the indent level of the selected text block(s) by one. */
      outdent: () => ReturnType;
    };
  }
}

function clampIndent(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(MAX_INDENT, Math.trunc(v)));
}

export const Indent = Extension.create({
  name: 'indent',

  // Above StarterKit (default 100) so this extension's Backspace handler is offered
  // to ProseMirror BEFORE StarterKit's default `joinBackward`. Without this, pressing
  // Backspace at the start of an indented block would immediately join it with the
  // previous block (StarterKit wins the key) and the caret would never get a chance
  // to reduce the indent first. Tab/Shift-Tab already defer to lists, so a higher
  // priority does not disturb list sink/lift (those handlers still run when we return
  // false), and it does not affect ordinary typing.
  priority: 1000,

  addGlobalAttributes() {
    return [
      {
        types: [...INDENT_TYPES],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) =>
              clampIndent(Number.parseInt(element.getAttribute('data-indent') ?? '0', 10)),
            renderHTML: (attributes) => {
              const level = clampIndent(attributes.indent);
              if (level === 0) return {};
              return {
                'data-indent': level,
                style: `margin-left: ${level * INDENT_STEP_EM}em`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const shift =
      (delta: number) =>
      ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        const { selection } = state;
        const { $from, $to } = selection;
        const targets: { pos: number; attrs: Record<string, unknown> }[] = [];

        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (node.isTextblock && (INDENT_TYPES as readonly string[]).includes(node.type.name)) {
            targets.push({ pos, attrs: node.attrs });
            return false; // do not descend into inline content
          }
          return true;
        });

        // Empty selection at a cursor: nodesBetween may not report the enclosing block,
        // so fall back to the nearest paragraph/heading ancestor of the caret.
        if (targets.length === 0) {
          for (let d = $from.depth; d > 0; d -= 1) {
            const node = $from.node(d);
            if ((INDENT_TYPES as readonly string[]).includes(node.type.name)) {
              targets.push({ pos: $from.before(d), attrs: node.attrs });
              break;
            }
          }
        }

        let changed = false;
        const tr = state.tr;
        for (const { pos, attrs } of targets) {
          const next = clampIndent(clampIndent(attrs.indent) + delta);
          if (next !== clampIndent(attrs.indent)) {
            // Attr-only markup change keeps node sizes constant, so original positions
            // stay valid across the loop within this one transaction.
            tr.setNodeMarkup(pos, undefined, { ...attrs, indent: next });
            changed = true;
          }
        }
        if (changed && dispatch) dispatch(tr);
        return changed;
      };

    return {
      indent: () => shift(1),
      outdent: () => shift(-1),
    };
  },

  addKeyboardShortcuts() {
    const insideList = (): boolean => {
      const { $from } = this.editor.state.selection;
      for (let d = $from.depth; d > 0; d -= 1) {
        const name = $from.node(d).type.name;
        if (name === 'listItem' || name === 'taskItem') return true;
      }
      return false;
    };

    return {
      Tab: () => {
        if (!this.editor.isEditable) return false; // viewers: leave Tab to the browser
        if (insideList()) return false; // let the list's sink handler run
        // Consume Tab while editing text (even at max indent) so the caret never escapes
        // the editor mid-edit; `indent()` applies the change when one is possible.
        this.editor.commands.indent();
        return true;
      },
      'Shift-Tab': () => {
        if (!this.editor.isEditable) return false;
        if (insideList()) return false; // let the list's lift handler run
        this.editor.commands.outdent();
        return true;
      },
      // Backspace at the VERY START of an indented paragraph/heading reduces the
      // indent by one level instead of joining with (or deleting from) the previous
      // block — the natural inverse of Tab. Strictly scoped so it NEVER hijacks
      // normal deletion:
      //   - only a collapsed caret (an active range selection deletes as usual);
      //   - only at parentOffset 0 (caret at the block's start — mid-text Backspace
      //     deletes the previous character normally);
      //   - never inside a list (list outdent/join behavior is preserved);
      //   - only a paragraph/heading that actually carries indent > 0.
      // In every other case we return false so ProseMirror's default Backspace
      // (character delete, block join, undo of an input rule, …) runs unchanged.
      Backspace: () => {
        if (!this.editor.isEditable) return false;
        const { selection } = this.editor.state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parentOffset !== 0) return false;
        if (insideList()) return false;
        const parent = $from.parent;
        if (!(INDENT_TYPES as readonly string[]).includes(parent.type.name)) return false;
        if (clampIndent(parent.attrs.indent) === 0) return false;
        // A change is guaranteed (indent > 0), so this consumes the Backspace.
        return this.editor.commands.outdent();
      },
    };
  },
});
