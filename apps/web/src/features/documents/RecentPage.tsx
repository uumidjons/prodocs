import { useNavigate } from 'react-router-dom';
import { CollectionPage } from './CollectionPage.js';
import { DocumentCard, DocumentGrid } from './DocumentCard.js';
import { useDocumentList } from './useDocuments.js';

/**
 * Recent (task §2): documents the current user has actually opened, newest first.
 * Scoped per-user server-side (via the membership's last_opened_at), so it survives
 * reload/logout and never shows another user's activity. Templates never appear here
 * — selecting a template creates a new document rather than opening the template.
 */
export function RecentPage() {
  const { data, loading, error, reload } = useDocumentList('recent');
  const navigate = useNavigate();

  return (
    <CollectionPage
      title="Recent"
      subtitle="Documents you have opened recently."
      loading={loading}
      error={error}
      onRetry={() => void reload()}
      empty={!!data && data.length === 0}
      emptyIcon="schedule"
      emptyTitle="No recent documents"
      emptyHint="Documents you open will appear here."
    >
      <DocumentGrid>
        {data?.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            onOpen={() => navigate(`/d/${doc.id}`)}
            timestamp="opened"
          />
        ))}
      </DocumentGrid>
    </CollectionPage>
  );
}
