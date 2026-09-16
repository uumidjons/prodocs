import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TemplateDto } from '@scribe/shared';
import { ApiError, api } from '../../api/index.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { CollectionPage } from '../documents/CollectionPage.js';

/**
 * Templates (task §3): ONLY real system templates (from `GET /api/templates`) — never
 * a user's own documents, template-created documents, shared documents, or trash.
 * Selecting a template runs the existing create-from-template flow, producing a new,
 * independent document that lands in Documents (never here).
 */
function TemplateCard({
  tpl,
  onCreate,
  busy,
}: {
  tpl: TemplateDto;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex h-full flex-col rounded-lg border border-border bg-sheet p-5 shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-soft text-primary">
        <Icon name="dashboard" size={22} />
      </span>
      <h3 className="mt-3 font-display text-headline-sm text-ink">{tpl.title}</h3>
      {tpl.description && (
        <p className="mt-1 line-clamp-3 text-body-sm text-ink-2">{tpl.description}</p>
      )}
      <div className="mt-auto pt-4">
        <Button size="sm" onClick={onCreate} disabled={busy}>
          {busy ? <Spinner size={16} /> : <Icon name="add" size={16} />}
          Use template
        </Button>
      </div>
    </li>
  );
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTemplates(null);
    setError(null);
    api.templates
      .list()
      .then((tpls) => {
        if (!cancelled) setTemplates(tpls);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'Could not load templates');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function create(templateId: string) {
    if (creatingId) return;
    setCreatingId(templateId);
    setError(null);
    try {
      const doc = await api.documents.create({ fromTemplateId: templateId });
      navigate(`/d/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the document');
      setCreatingId(null);
    }
  }

  return (
    <CollectionPage
      title="Templates"
      subtitle="Start a new document from a ready-made template."
      loading={templates === null && !error}
      error={error}
      onRetry={() => setReloadKey((k) => k + 1)}
      empty={!!templates && templates.length === 0}
      emptyIcon="dashboard"
      emptyTitle="No templates available"
      emptyHint="System templates will appear here once they are set up."
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates?.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            tpl={tpl}
            busy={creatingId === tpl.id}
            onCreate={() => void create(tpl.id)}
          />
        ))}
      </ul>
    </CollectionPage>
  );
}
