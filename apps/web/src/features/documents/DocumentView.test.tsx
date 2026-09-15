import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDto } from '@scribe/shared';
import type { Doc as YDoc } from 'yjs';

/**
 * DocumentView tests — the metadata concerns it owns: loading and error states,
 * and that the title stays bound to document metadata (not editor content). The
 * collaboration hook is mocked to a local seeded Y.Doc (no provider) so these
 * assertions don't depend on a WebSocket server or IndexedDB; real transport is
 * covered by the server integration suite.
 */

const getMock = vi.fn();
const updateTitleMock = vi.fn();

vi.mock('../../api/index.js', () => ({
  api: {
    documents: {
      get: (id: string) => getMock(id),
      updateTitle: (id: string, input: unknown) => updateTitleMock(id, input),
    },
  },
  ApiError: class ApiError extends Error {},
  setOnAuthFailure: () => {},
  getValidAccessToken: async () => null,
}));

// Deterministic collaboration stub: a freshly seeded local Y.Doc per document, no
// provider — mirroring the real hook, which creates one Y.Doc per open document.
// (A single shared doc reused across mounts left CRDT state from a torn-down editor
// bound to the next one, so each render gets its own seeded doc here.)
vi.mock('../collaboration/useCollaboration.js', async () => {
  const { useRef } = await import('react');
  const Y = await import('yjs');
  const { getSchema } = await import('@tiptap/react');
  const { prosemirrorJSONToYDoc } = await import('y-prosemirror');
  const { buildBaseExtensions, INITIAL_DOCUMENT_CONTENT, COLLAB_FIELD } =
    await import('@scribe/shared');
  const schema = getSchema(buildBaseExtensions());
  const seededDoc = () => {
    const ydoc = new Y.Doc();
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, INITIAL_DOCUMENT_CONTENT, COLLAB_FIELD)),
    );
    return ydoc;
  };
  return {
    // A hook: one freshly seeded Y.Doc per mounted DocumentView (stable across
    // that instance's re-renders), just like the real hook.
    useCollaboration: () => {
      const ref = useRef<{ ydoc: YDoc; provider: null } | null>(null);
      if (!ref.current) ref.current = { ydoc: seededDoc(), provider: null };
      return ref.current;
    },
  };
});

// The mocked ApiError class (see vi.mock above) — used to distinguish an
// authoritative server error from an offline network failure.
const { ApiError } = await import('../../api/index.js');
const { DocumentView } = await import('./DocumentView.js');
const { useUiStore } = await import('../../stores/uiStore.js');

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/d/doc-1']}>
      <Routes>
        <Route path="/d/:id" element={<DocumentView />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleDoc: DocumentDto = {
  id: 'doc-1',
  title: 'Q3 Project Strategy',
  ownerId: 'user-1',
  ownerName: 'Owner One',
  role: 'owner',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: null,
  deletedAt: null,
};

beforeEach(() => {
  getMock.mockReset();
  updateTitleMock.mockReset();
  useUiStore.getState().setActiveDocument(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocumentView', () => {
  it('shows a loading state while the document metadata is fetched', () => {
    getMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderView();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('shows an error state when the document cannot be loaded', async () => {
    getMock.mockRejectedValue(new Error('boom'));
    renderView();
    expect(await screen.findByText('Document unavailable')).toBeInTheDocument();
  });

  it('publishes the title as header metadata, not as editor body content', async () => {
    getMock.mockResolvedValue(sampleDoc);
    renderView();
    // The collaborative body renders its own content. Poll with a fresh query each
    // tick (the Yjs editor re-syncs its DOM shortly after mount, so a held element
    // reference can detach) and a generous timeout (Yjs mount is heavier).
    await waitFor(() => expect(screen.getByText('Core Objectives')).toBeInTheDocument(), {
      timeout: 5000,
    });
    // …and the title is published to the UI store for the header to render — it is
    // NOT part of the canvas (no title input inside DocumentView).
    await waitFor(() =>
      expect(useUiStore.getState().activeDocument).toMatchObject({
        id: 'doc-1',
        title: 'Q3 Project Strategy',
        role: 'owner',
      }),
    );
    expect(screen.queryByLabelText('Document title')).not.toBeInTheDocument();
  });

  it('opens a previously-seen document from cached metadata when offline (reload-while-offline)', async () => {
    // Simulate a prior online visit having cached the metadata…
    localStorage.setItem('scribe:doc-meta:v1:doc-1', JSON.stringify(sampleDoc));
    // …then a reload with no network: the metadata GET fails as a network error
    // (NOT an ApiError), so the view falls back to the cache and still opens.
    getMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderView();

    // The editor still mounts offline (its content comes from the local Y.Doc)…
    await waitFor(() => expect(screen.getByText('Core Objectives')).toBeInTheDocument(), {
      timeout: 5000,
    });
    // …and the cached title is published to the header store.
    await waitFor(() =>
      expect(useUiStore.getState().activeDocument?.title).toBe('Q3 Project Strategy'),
    );
    localStorage.clear();
  });

  it('still shows an authoritative server error (ApiError) instead of masking it with cache', async () => {
    localStorage.setItem('scribe:doc-meta:v1:doc-1', JSON.stringify(sampleDoc));
    // A 404/403 from the server is authoritative (e.g. access revoked): do NOT fall
    // back to stale cache.
    getMock.mockRejectedValue(new ApiError(404, 'not_found', 'Not found'));
    renderView();
    expect(await screen.findByText('Document unavailable')).toBeInTheDocument();
    localStorage.clear();
  });
});
