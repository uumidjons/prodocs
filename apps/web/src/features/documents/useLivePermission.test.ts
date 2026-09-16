import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The live-permission hook is the single source of truth for editability on an open
 * document. It must react to the collaboration provider's RE-authentication (a role
 * change forces a reconnect) by re-reading the authoritative server role, and treat a
 * 403/404 as revocation — never a client guess.
 */

const getMock = vi.fn();

vi.mock('../../api/index.js', () => ({
  api: { documents: { get: (id: string) => getMock(id) } },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code = 'err',
      message = 'err',
    ) {
      super(message);
    }
  },
}));

const { useLivePermission } = await import('./useLivePermission.js');
const { ApiError } = await import('../../api/index.js');

/** Minimal provider stub exposing the on/off event surface the hook uses. */
function fakeProvider() {
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  return {
    on(event: string, fn: (arg?: unknown) => void) {
      (handlers[event] ??= []).push(fn);
    },
    off(event: string, fn: (arg?: unknown) => void) {
      handlers[event] = (handlers[event] ?? []).filter((f) => f !== fn);
    },
    emit(event: string, arg?: unknown) {
      for (const fn of handlers[event] ?? []) fn(arg);
    },
  };
}

beforeEach(() => getMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('useLivePermission', () => {
  it('derives canEdit from the initial role', () => {
    const provider = fakeProvider();
    const editor = renderHook(() => useLivePermission('d1', provider as never, 'editor'));
    expect(editor.result.current.canEdit).toBe(true);

    const viewer = renderHook(() => useLivePermission('d1', provider as never, 'viewer'));
    expect(viewer.result.current.canEdit).toBe(false);
  });

  it('re-fetches the role on RE-authentication (viewer → editor)', async () => {
    const provider = fakeProvider();
    getMock.mockResolvedValue({ id: 'd1', role: 'editor', title: 'x' });
    const { result } = renderHook(() => useLivePermission('d1', provider as never, 'viewer'));
    expect(result.current.canEdit).toBe(false);

    // First authentication after mount is skipped (role already fetched by the view).
    act(() => provider.emit('authenticated'));
    expect(getMock).not.toHaveBeenCalled();

    // A reconnect (second authentication) re-reads the authoritative role.
    act(() => provider.emit('authenticated'));
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    expect(result.current.role).toBe('editor');
  });

  it('marks access revoked when authentication fails and REST returns 403', async () => {
    const provider = fakeProvider();
    getMock.mockRejectedValue(new ApiError(403, 'forbidden', 'Forbidden'));
    const { result } = renderHook(() => useLivePermission('d1', provider as never, 'editor'));
    expect(result.current.canEdit).toBe(true);

    act(() => provider.emit('authenticationFailed', { reason: 'x' }));
    await waitFor(() => expect(result.current.revoked).toBe(true));
    expect(result.current.canEdit).toBe(false);
  });

  it('does not flash revocation on a transient failure where REST still returns the doc', async () => {
    const provider = fakeProvider();
    getMock.mockResolvedValue({ id: 'd1', role: 'editor', title: 'x' });
    const { result } = renderHook(() => useLivePermission('d1', provider as never, 'editor'));

    act(() => provider.emit('authenticationFailed', { reason: 'x' }));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(result.current.revoked).toBe(false);
    expect(result.current.canEdit).toBe(true);
  });
});
