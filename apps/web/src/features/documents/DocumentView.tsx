import { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import { collaborationColor } from '@scribe/shared';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { DocumentEditor } from '../editor/index.js';
import { useExportStore } from '../export/index.js';
import { useCollaboration } from '../collaboration/useCollaboration.js';
import { installConvergenceProbe } from '../collaboration/collabDiagnostics.js';
import { useDocument } from './useDocuments.js';
import { useLivePermission } from './useLivePermission.js';

/**
 * Document screen. Owns metadata loading/error states and wires the collaboration
 * layer to the editor. The document TITLE is published to the UI store so it renders
 * in the application header (task §1) — it is ordinary server metadata, kept
 * separate from the collaborative Yjs body so the two never interfere.
 *
 * Permission is LIVE: `useLivePermission` derives the single source of truth for
 * whether this user may edit (`canEdit`) from the authoritative server, and updates
 * it immediately when the owner changes/revokes the user's role on the already-open
 * document (the server force-drops the socket; we re-derive on re-authentication).
 * The canvas itself contains only document content; title editing/persistence
 * happens in the header via the existing PATCH endpoint.
 */
export function DocumentView() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useDocument(id);
  const user = useAuthStore((s) => s.user);
  const setActiveDocument = useUiStore((s) => s.setActiveDocument);
  // Expose the live editor to the header's Export control (read-only handle). Cleared
  // on unmount so a stale editor can never be exported after leaving the document.
  const setExportEditor = useExportStore((s) => s.setEditor);
  useEffect(() => () => setExportEditor(null), [setExportEditor]);

  // When the editor initializes: hand it to the Export control AND (dev builds only)
  // install the E2E convergence probe that exposes the canonical logical document
  // JSON. The probe is a no-op in production builds. Cleanup removes the probe on
  // unmount / document switch so a stale editor is never read.
  const removeProbe = useRef<() => void>(() => {});
  const onEditorReady = useCallback(
    (editor: Editor) => {
      setExportEditor(editor);
      removeProbe.current();
      removeProbe.current = installConvergenceProbe(editor);
    },
    [setExportEditor],
  );
  useEffect(() => () => removeProbe.current(), []);

  // Collaboration lifecycle (Y.Doc + provider + y-indexeddb) for this document.
  // Gated on `data` so it initializes only once the authoritative role is known —
  // otherwise an editor could briefly init as the default "viewer" and wrongly purge
  // its own offline cache. The role also tells the collab layer whether to trust
  // local persistence on load (viewers never do — see useCollaboration).
  const collab = useCollaboration(data ? id : undefined, data?.role ?? 'viewer');

  // Single source of truth for editability, kept live against the server.
  const permission = useLivePermission(id ?? '', collab?.provider, data?.role ?? 'viewer');

  // Expose the open document (id + live role + title) to the header so it can render
  // the title, the role chip, and the owner-only Share control. Cleared on unmount /
  // document switch. Uses the LIVE role so a demotion (editor→viewer) also updates
  // the header controls immediately, not just the canvas.
  useEffect(() => {
    if (id && data) setActiveDocument({ id, role: permission.role, title: data.title });
    return () => setActiveDocument(null);
  }, [id, data, permission.role, setActiveDocument]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  if (error || !data || !id) {
    return (
      <div className="mx-auto max-w-sheet px-margin py-16 text-center">
        <Icon name="error" size={40} className="text-ink-3" />
        <h1 className="mt-3 font-display text-headline-sm text-ink">Document unavailable</h1>
        <p className="mt-1 text-body-default text-ink-2">{error ?? 'Not found'}</p>
      </div>
    );
  }

  // Access was revoked while the document was open (owner removed this member). The
  // content stays readable from the local CRDT, but editing is off and the state is
  // made explicit rather than leaving a misleading "synced" view.
  if (permission.revoked) {
    return (
      <div className="mx-auto max-w-sheet px-margin py-16 text-center">
        <Icon name="lock" size={40} className="text-ink-3" />
        <h1 className="mt-3 font-display text-headline-sm text-ink">Access removed</h1>
        <p className="mt-1 text-body-default text-ink-2">
          Your access to this document was changed by the owner. Reload to see your current access.
        </p>
      </div>
    );
  }

  // Collaboration initializes right after the metadata loads; show a brief spinner
  // in the canvas until the Y.Doc/provider exist (keeps the shell responsive).
  if (!collab) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <DocumentEditor
      ydoc={collab.ydoc}
      provider={collab.provider}
      editable={permission.canEdit}
      documentId={id}
      onEditorReady={onEditorReady}
      // Collaboration color is derived deterministically from the stable user id
      // (NOT the random profile color), so every client renders this user's cursor,
      // selection, name label, and presence avatar in the same, distinguishable
      // color. See collaborationColor() in @scribe/shared.
      user={
        user
          ? { id: user.id, name: user.displayName, color: collaborationColor(user.id) }
          : undefined
      }
    />
  );
}
