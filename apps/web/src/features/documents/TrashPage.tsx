import { useState } from 'react';
import { ApiError, api } from '../../api/index.js';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { CollectionPage } from './CollectionPage.js';
import { DocumentCard, DocumentGrid } from './DocumentCard.js';
import { useDocumentList } from './useDocuments.js';

/**
 * Trash (task §5): the owner's soft-deleted documents. A trashed document is absent
 * from Documents/Recent/Shared and cannot be opened or edited; from here the owner can
 * restore it (back to Documents) or permanently delete it. Permanent delete is a
 * distinct, two-step action (never a one-click destructive click, and never a blocking
 * browser dialog).
 */
function TrashActions({
  id,
  onDone,
  onError,
}: {
  id: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Action failed');
      setBusy(false);
    }
  }

  if (busy) {
    return <Spinner size={16} />;
  }

  if (confirming) {
    return (
      <>
        <span className="mr-auto text-body-sm text-ink-2">Delete forever?</span>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-sm px-2 py-1 text-body-sm text-ink-2 hover:bg-subtle"
        >
          Cancel
        </button>
        <button
          onClick={() => void run(() => api.documents.purge(id))}
          className="flex items-center gap-1 rounded-sm px-2 py-1 text-body-sm font-semibold text-error hover:bg-error-bg"
        >
          <Icon name="delete_forever" size={16} /> Confirm
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => void run(() => api.documents.restore(id))}
        className="flex items-center gap-1 rounded-sm px-2 py-1 text-body-sm font-semibold text-primary hover:bg-subtle"
      >
        <Icon name="restore" size={16} /> Restore
      </button>
      <button
        onClick={() => setConfirming(true)}
        className="flex items-center gap-1 rounded-sm px-2 py-1 text-body-sm text-ink-2 hover:bg-subtle"
      >
        <Icon name="delete_forever" size={16} /> Delete
      </button>
    </>
  );
}

export function TrashPage() {
  const { data, loading, error, reload } = useDocumentList('trash');
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <CollectionPage
      title="Trash"
      subtitle="Deleted documents. Restore them or delete them permanently."
      loading={loading}
      error={error ?? actionError}
      onRetry={() => void reload()}
      empty={!!data && data.length === 0}
      emptyIcon="delete"
      emptyTitle="Trash is empty"
      emptyHint="Documents you delete are moved here."
    >
      <DocumentGrid>
        {data?.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            timestamp="deleted"
            actions={
              <TrashActions id={doc.id} onDone={() => void reload()} onError={setActionError} />
            }
          />
        ))}
      </DocumentGrid>
    </CollectionPage>
  );
}
