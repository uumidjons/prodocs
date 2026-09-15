import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DocumentDto } from '@scribe/shared';
import { ApiError, api } from '../../api/index.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { CollectionPage } from './CollectionPage.js';
import { DocumentCard, DocumentGrid } from './DocumentCard.js';
import { useDocumentList } from './useDocuments.js';
import { NewDocumentDialog } from './NewDocumentDialog.js';

/** "Move to trash" affordance for an owned document card (owner-only, reversible). */
function MoveToTrash({
  id,
  onDone,
  onError,
}: {
  id: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (busy) return <Spinner size={16} />;
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await api.documents.remove(id);
          onDone();
        } catch (err) {
          onError(err instanceof ApiError ? err.message : 'Could not move to trash');
          setBusy(false);
        }
      }}
      className="flex items-center gap-1 rounded-sm px-2 py-1 text-body-sm text-ink-2 hover:bg-subtle"
      aria-label="Move to trash"
    >
      <Icon name="delete" size={16} /> Move to trash
    </button>
  );
}

function Section({
  title,
  docs,
  onOpen,
  showOwner,
  renderActions,
}: {
  title: string;
  docs: DocumentDto[];
  onOpen: (id: string) => void;
  showOwner?: boolean;
  renderActions?: (doc: DocumentDto) => React.ReactNode;
}) {
  if (docs.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-label-md font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h2>
      <DocumentGrid>
        {docs.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            onOpen={() => onOpen(doc.id)}
            showOwner={showOwner}
            actions={renderActions?.(doc)}
          />
        ))}
      </DocumentGrid>
    </section>
  );
}

/**
 * Documents — the user's primary collection (task §1): every live document they can
 * access (owned + shared), never templates or trashed documents. Data comes from the
 * shared listing API (`view=mine`); the owned/shared split is purely presentational.
 * Owned documents can be moved to Trash (owner-only, reversible) from their card.
 */
export function DocumentsHome() {
  const { data, loading, error, reload } = useDocumentList('mine');
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const open = (id: string) => navigate(`/d/${id}`);

  const owned = data?.filter((d) => d.role === 'owner') ?? [];
  const shared = data?.filter((d) => d.role !== 'owner') ?? [];

  const newButton = (
    <Button onClick={() => setDialogOpen(true)} aria-haspopup="dialog">
      <Icon name="add" size={18} />
      New Document
    </Button>
  );

  return (
    <>
      <CollectionPage
        title="Documents"
        subtitle="Documents you own and documents shared with you. Open one to edit and collaborate in real time."
        action={newButton}
        loading={loading}
        error={error ?? actionError}
        onRetry={() => void reload()}
        empty={!!data && data.length === 0}
        emptyTitle="No documents yet"
        emptyHint="Create your first document to get started."
        emptyAction={newButton}
      >
        <Section
          title="Owned by me"
          docs={owned}
          onOpen={open}
          renderActions={(doc) => (
            <MoveToTrash id={doc.id} onDone={() => void reload()} onError={setActionError} />
          )}
        />
        <Section title="Shared with me" docs={shared} onOpen={open} showOwner />
      </CollectionPage>

      {dialogOpen && <NewDocumentDialog onClose={() => setDialogOpen(false)} />}
    </>
  );
}
