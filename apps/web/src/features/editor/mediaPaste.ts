import { type Editor, Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { isAllowedMediaMime } from '@scribe/shared';
import { ApiError, uploadMedia } from '../../api/client.js';
import { notify } from './editorNotify.js';

/**
 * MEDIA PASTE / DROP (ADR 0012). Turns a pasted or dropped IMAGE into a real media node
 * through the EXISTING authenticated upload path — the binary is uploaded first, and the
 * media node (a `mediaId` reference only) is inserted after the server confirms it. The
 * binary/Blob/data-URL never enters Yjs or ProseMirror state.
 *
 * Security (defensive by design):
 *   - We accept ONLY real image `File` objects of the app's allow-list types
 *     (PNG/JPEG/WebP) taken from the ClipboardEvent/DragEvent `DataTransfer`. The
 *     server's magic-byte sniff remains authoritative.
 *   - We never read `<img src="…">` out of pasted HTML, so pasting web content can never
 *     create an externally loaded / unsafe remote media URL (no SSRF/broken-image/XSS
 *     surface). When the clipboard has no local image file we return `false` and let
 *     ProseMirror's normal paste keep the useful text/HTML (its parser drops the foreign
 *     `<img>` because the schema only matches `img[data-media-id]`).
 *
 * Failure/offline: a failed or offline upload shows a toast and inserts NOTHING — the
 * document is never left with a broken/orphan media reference.
 */
interface MediaPasteOptions {
  /** Document id for the authenticated upload endpoint; null disables the feature. */
  documentId: string | null;
}

/** Extract the allow-listed image files from a DataTransfer (clipboard or drop). */
function imageFilesFrom(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files: File[] = [];
  for (const file of Array.from(dt.files ?? [])) {
    // Trust the type only as a first filter; the server re-validates by content.
    if (file && isAllowedMediaMime(file.type)) files.push(file);
  }
  return files;
}

function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'That image is too large.';
    if (err.status === 415) return 'Only PNG, JPEG, or WebP images are supported.';
    if (err.status === 403) return 'You do not have permission to add media.';
  }
  return 'Image upload failed. Please try again.';
}

/** Upload each image, then insert its media node at (a clamped) `pos`, in order. */
async function uploadAndInsert(
  editor: Editor,
  documentId: string,
  files: File[],
  pos: number,
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notify("You're offline — image paste needs a connection.", 'error');
    return;
  }
  let at = pos;
  for (const file of files) {
    try {
      const media = await uploadMedia(documentId, file);
      const size = editor.state.doc.content.size;
      const insertAt = Math.min(Math.max(0, at), size);
      editor
        .chain()
        .insertContentAt(insertAt, {
          type: 'media',
          attrs: {
            mediaId: media.mediaId,
            mime: media.mime,
            width: media.width,
            height: media.height,
            alt: file.name,
          },
        })
        .run();
      // Place the next image just after the one we inserted (media nodeSize = 1).
      at = insertAt + 1;
    } catch (err) {
      notify(uploadErrorMessage(err), 'error');
    }
  }
}

export const MediaPaste = Extension.create<MediaPasteOptions>({
  name: 'mediaPaste',

  addOptions() {
    return { documentId: null };
  },

  addProseMirrorPlugins() {
    const { documentId } = this.options;
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('mediaPaste'),
        props: {
          handlePaste: (view, event) => {
            if (!documentId || !view.editable) return false;
            const files = imageFilesFrom(event.clipboardData);
            if (files.length === 0) return false; // let normal text/HTML paste proceed
            event.preventDefault();
            void uploadAndInsert(editor, documentId, files, view.state.selection.from);
            return true;
          },
          handleDrop: (view, event) => {
            if (!documentId || !view.editable) return false;
            const files = imageFilesFrom(event.dataTransfer);
            if (files.length === 0) return false;
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const pos = coords?.pos ?? view.state.selection.from;
            event.preventDefault();
            void uploadAndInsert(editor, documentId, files, pos);
            return true;
          },
        },
      }),
    ];
  },
});
