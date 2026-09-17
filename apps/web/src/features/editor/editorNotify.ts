/**
 * Minimal transient-notification bus for editor-level events that happen OUTSIDE React
 * render (a ProseMirror paste/drop plugin uploading media). It carries only a short
 * message + kind — never document state — so it can never become a second source of
 * truth. A React `<EditorToasts>` subscribes and renders/auto-dismisses the notices.
 */
export type NoticeKind = 'error' | 'info';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

type Listener = (notice: Notice) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** Emit a transient notice to any mounted `<EditorToasts>`. Safe to call from anywhere. */
export function notify(message: string, kind: NoticeKind = 'info'): void {
  seq += 1;
  const notice: Notice = { id: seq, kind, message };
  for (const l of listeners) l(notice);
}

/** Subscribe to notices; returns an unsubscribe. */
export function subscribeNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
