import { readableTextColor } from '@scribe/shared';

/**
 * Custom rendering for Tiptap CollaborationCursor (built on top of the extension —
 * positions still come from Yjs awareness, nothing is added to the document).
 *
 * These builders shape the remote-cursor and remote-selection presentation to the
 * Scribe UI reference (UI/code.html → "Alex's Live Remote Cursor & Floating Tag",
 * UI/DESIGN.md → "Live Presence & Collaborative Cursors"):
 *   - a thin vertical caret bar in the collaborator's color;
 *   - a small floating name flag above it, in the same color, with a readable text
 *     color and the collaborator's display name;
 *   - a translucent (14%) selection wash in the same color with a solid underline.
 *
 * Every color is applied as a PER-ELEMENT inline style taken from that
 * collaborator's awareness state, so one collaborator's color can never bleed into
 * another's via a shared CSS rule. Structure/positioning lives in index.css.
 */

/** The awareness `user` payload each collaborator publishes (identity only). */
export interface CollaboratorAwareness {
  id?: string;
  name?: string;
  color?: string;
}

const FALLBACK_COLOR = '#3B49DF';
const FALLBACK_NAME = 'Collaborator';

/**
 * Builds the remote caret widget: a colored vertical bar carrying a floating name
 * flag. Returned to CollaborationCursor as its `render` (cursorBuilder). The classes
 * match the ones the E2E text helper strips, so document-text comparisons ignore
 * presence chrome.
 */
export function renderCollaborationCaret(user: CollaboratorAwareness): HTMLElement {
  const color = user.color || FALLBACK_COLOR;
  const name = (user.name || FALLBACK_NAME).trim() || FALLBACK_NAME;

  const caret = document.createElement('span');
  caret.classList.add('collaboration-cursor__caret');
  caret.setAttribute('style', `background-color: ${color}`);

  const label = document.createElement('span');
  label.classList.add('collaboration-cursor__label');
  label.setAttribute('style', `background-color: ${color}; color: ${readableTextColor(color)}`);
  label.textContent = name;

  caret.appendChild(label);
  return caret;
}

/**
 * Builds the remote-selection decoration attributes. Returned to
 * CollaborationCursor as its `selectionRender` (selectionBuilder). `color + '24'`
 * appends a hex alpha of ~14% for the wash; the solid bottom border keeps the
 * selection tied to the collaborator's color even where the wash is subtle.
 */
export function renderCollaborationSelection(user: CollaboratorAwareness): {
  style: string;
  class: string;
} {
  const color = user.color || FALLBACK_COLOR;
  return {
    style: `background-color: ${color}24; border-bottom: 2px solid ${color};`,
    class: 'collaboration-selection',
  };
}
