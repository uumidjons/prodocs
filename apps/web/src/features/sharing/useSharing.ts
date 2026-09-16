import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssignableRole, MemberDto, UserSearchResultDto } from '@scribe/shared';
import { ApiError, api } from '../../api/index.js';

/**
 * Owns the sharing STATE + mutations for one document, isolated from the dialog UI.
 * Every operation calls the server-side sharing API (the membership table is the
 * authorization source of truth); this hook never decides access itself — a
 * forbidden action surfaces the server's error. Mutations return the fresh member
 * list from the server, so the UI always reflects the persisted truth.
 */

/** Map an unknown thrown value to a user-facing sentence (never a stack trace). */
function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    // The server sends understandable messages for the sharing cases
    // (forbidden / not found / conflict); a network failure is not an ApiError.
    return err.message;
  }
  return fallback;
}

export function useSharing(documentId: string | undefined, open: boolean) {
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      setMembers(await api.documents.members.list(documentId));
    } catch (err) {
      setError(messageFor(err, 'Unable to load sharing. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  // Load (once) when the dialog opens; clear when it closes so a reopen re-fetches.
  useEffect(() => {
    if (open) void load();
    else {
      setMembers(null);
      setError(null);
    }
  }, [open, load]);

  const run = useCallback(
    async (fn: () => Promise<MemberDto[]>, fallback: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        setMembers(await fn());
        return true;
      } catch (err) {
        setError(messageFor(err, fallback));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const addMember = useCallback(
    (userId: string, role: AssignableRole) =>
      documentId
        ? run(
            () => api.documents.members.add(documentId, { userId, role }),
            'Unable to update sharing. Please try again.',
          )
        : Promise.resolve(false),
    [documentId, run],
  );

  const changeRole = useCallback(
    (userId: string, role: AssignableRole) =>
      documentId
        ? run(
            () => api.documents.members.changeRole(documentId, userId, role),
            'Unable to update sharing. Please try again.',
          )
        : Promise.resolve(false),
    [documentId, run],
  );

  const removeMember = useCallback(
    (userId: string) =>
      documentId
        ? run(
            () => api.documents.members.remove(documentId, userId),
            'Unable to update sharing. Please try again.',
          )
        : Promise.resolve(false),
    [documentId, run],
  );

  return { members, loading, error, busy, reload: load, addMember, changeRole, removeMember };
}

/**
 * Debounced user search for the "add member" control. Returns results for the
 * latest query only (stale responses are dropped). Queries shorter than the
 * server minimum (2 chars) are treated as empty without a request.
 */
export function useUserSearch(query: string) {
  const [results, setResults] = useState<UserSearchResultDto[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await api.users.search(q);
        if (mine === seq.current) setResults(found);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return { results, searching };
}
