import { useNavigate } from 'react-router-dom';
import { CollectionPage } from './CollectionPage.js';
import { DocumentCard, DocumentGrid } from './DocumentCard.js';
import { useDocumentList } from './useDocuments.js';

/**
 * Shared with me (task §4): live documents owned by someone else on which the current
 * user holds an active membership. Data comes from the shared listing API
 * (`view=shared`) using the SAME membership model as everything else — no second
 * permission model. Opening a card leads into the normal DocumentView, where the live
 * role (viewer read-only, editor/owner editable) is enforced as usual.
 */
export function SharedPage() {
  const { data, loading, error, reload } = useDocumentList('shared');
  const navigate = useNavigate();

  return (
    <CollectionPage
      title="Shared with me"
      subtitle="Documents other people have shared with you."
      loading={loading}
      error={error}
      onRetry={() => void reload()}
      empty={!!data && data.length === 0}
      emptyIcon="group"
      emptyTitle="No documents have been shared with you"
      emptyHint="When someone shares a document with you, it will appear here."
    >
      <DocumentGrid>
        {data?.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} onOpen={() => navigate(`/d/${doc.id}`)} showOwner />
        ))}
      </DocumentGrid>
    </CollectionPage>
  );
}
