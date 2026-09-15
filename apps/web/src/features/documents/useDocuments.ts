import { useCallback, useEffect, useState } from 'react';
import type { DocumentDto, DocumentView } from '@scribe/shared';
import { ApiError, api } from '../../api/index.js';
import { cacheDocumentMeta, readCachedDocumentMeta } from './metadataCache.js';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the current user's documents for a sidebar section (task §1/§2/§4/§5) with
 * loading/error states. All sections reuse the SAME listing API + authorization
 * (`GET /api/documents?view=…`), scoped and filtered server-side — the frontend
 * never re-implements which documents belong in which section.
 */
export function useDocumentList(view: DocumentView = 'mine') {
  const [state, setState] = useState<AsyncState<DocumentDto[]>>({
    data: null,
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const docs = await api.documents.list(view);
      setState({ data: docs, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof ApiError ? err.message : 'Failed to load documents',
      });
    }
  }, [view]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

/** Loads a single document's metadata by id. */
export function useDocument(id: string | undefined) {
  const [state, setState] = useState<AsyncState<DocumentDto>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    api.documents
      .get(id)
      .then((doc) => {
        // Remember the metadata so a previously-seen document can still open if the
        // browser later reloads while offline (metadataCache.ts — metadata only,
        // never content). The CRDT body itself is already durable in IndexedDB.
        cacheDocumentMeta(doc);
        if (!cancelled) setState({ data: doc, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An ApiError means the SERVER answered (404/403/…): a real, authoritative
        // failure — show it, never mask it with a stale cache. A non-ApiError means
        // the request never reached the server (offline / network down): fall back
        // to cached metadata so a locally-known document opens for offline editing.
        const cached = err instanceof ApiError ? null : readCachedDocumentMeta(id);
        if (cached) {
          setState({ data: cached, loading: false, error: null });
        } else {
          setState({
            data: null,
            loading: false,
            error: err instanceof ApiError ? err.message : 'Failed to load document',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}
