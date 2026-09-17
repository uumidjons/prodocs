import { useEffect, useState } from 'react';
import { type Notice, subscribeNotices } from './editorNotify.js';

/**
 * Renders transient editor notices (e.g. an image-paste upload failure) as a small stack
 * of auto-dismissing toasts. Purely presentational: it holds no document state and reads
 * only the notice bus. Mounted once by {@link DocumentEditor}.
 */
const AUTO_DISMISS_MS = 5000;

export function EditorToasts() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    return subscribeNotices((notice) => {
      setNotices((prev) => [...prev, notice]);
      window.setTimeout(() => {
        setNotices((prev) => prev.filter((n) => n.id !== notice.id));
      }, AUTO_DISMISS_MS);
    });
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="scribe-editor-toasts" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className="scribe-editor-toast" data-kind={n.kind}>
          <span>{n.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
