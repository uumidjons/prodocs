import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ALLOWED_MEDIA_ACCEPT, isAllowedMediaMime } from '@scribe/shared';
import { ApiError, uploadMedia } from '../../api/client.js';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';

interface MediaButtonProps {
  editor: Editor;
  documentId?: string;
  disabled?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'error'; message: string };

/**
 * Insert-media toolbar control (ADR 0012). Opens a native file picker, validates
 * type/size client-side, then uploads to the server. The media node is inserted ONLY
 * after the server confirms the upload (never an optimistic/broken reference). The
 * editor is never frozen: uploading is async and its state is shown inline with a retry.
 *
 * Offline policy (honest): a new upload needs the network, so while offline the action
 * is blocked with a clear message rather than faking success.
 */
export function MediaButton({ editor, documentId, disabled = false }: MediaButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const pick = () => {
    if (disabled || !documentId) return;
    setStatus({ kind: 'idle' });
    inputRef.current?.click();
  };

  const doUpload = async (file: File) => {
    if (!documentId) return;
    // Client-side pre-checks (the SERVER re-validates independently — ADR 0012 §4).
    if (!isAllowedMediaMime(file.type)) {
      setStatus({ kind: 'error', message: 'Only PNG, JPEG, or WebP images are supported.' });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus({ kind: 'error', message: "You're offline — media upload needs a connection." });
      return;
    }
    setStatus({ kind: 'uploading' });
    try {
      const media = await uploadMedia(documentId, file);
      // Insert the node ONLY after the server confirms the binary exists.
      editor
        .chain()
        .focus()
        .setMedia({
          mediaId: media.mediaId,
          mime: media.mime,
          width: media.width,
          height: media.height,
          alt: file.name,
        })
        .run();
      setStatus({ kind: 'idle' });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 413
            ? 'That image is too large.'
            : err.status === 415
              ? 'Only PNG, JPEG, or WebP images are supported.'
              : err.status === 403
                ? 'You do not have permission to add media.'
                : 'Upload failed. Please try again.'
          : 'Upload failed. Please try again.';
      setStatus({ kind: 'error', message });
    }
  };

  return (
    <div className="relative flex items-center">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset the input so re-selecting the same file fires change again.
          e.target.value = '';
          if (file) {
            lastFileRef.current = file;
            void doUpload(file);
          }
        }}
      />
      <button
        type="button"
        onClick={pick}
        disabled={disabled || !documentId || status.kind === 'uploading'}
        aria-label={status.kind === 'uploading' ? 'Uploading image…' : 'Insert image'}
        aria-busy={status.kind === 'uploading'}
        title="Insert image (PNG, JPEG, WebP)"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          'focus:outline-none focus-visible:shadow-focus-ring',
          'text-ink-2 hover:bg-subtle hover:text-ink',
          'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-60 disabled:hover:bg-transparent',
        )}
      >
        <Icon name={status.kind === 'uploading' ? 'progress_activity' : 'image'} size={20} />
      </button>

      {status.kind === 'error' && (
        <div
          role="alert"
          className="absolute left-0 top-10 z-40 w-64 rounded-md border border-error bg-sheet p-2 text-xs text-ink shadow-overlay"
        >
          <p className="mb-1.5 text-error">{status.message}</p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setStatus({ kind: 'idle' })}
              className="rounded px-2 py-1 font-medium text-ink-2 hover:bg-subtle"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => lastFileRef.current && void doUpload(lastFileRef.current)}
              className="rounded bg-primary px-2 py-1 font-medium text-white hover:bg-primary-hover"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
