import { describe, expect, it } from 'vitest';
import { type ConnectionSignals, deriveConnectionStatus } from './connectionState.js';

/**
 * Unit coverage for the connection/sync state machine (connection-states.md). The
 * transition table is pure logic, so we prove every meaningful case here without a
 * socket — the live transport is exercised by the server integration suite and the
 * Playwright offline suite.
 */

const base: ConnectionSignals = {
  providerStatus: 'connecting',
  synced: false,
  authFailed: false,
  online: true,
  connectedOnce: false,
};

const derive = (over: Partial<ConnectionSignals>) => deriveConnectionStatus({ ...base, ...over });

describe('deriveConnectionStatus', () => {
  it('first connect (no prior connection, online) → connecting', () => {
    expect(derive({ providerStatus: 'connecting', connectedOnce: false })).toBe('connecting');
  });

  it('connected but handshake not done → syncing', () => {
    expect(derive({ providerStatus: 'connected', synced: false })).toBe('syncing');
  });

  it('connected and handshake done → synced', () => {
    expect(derive({ providerStatus: 'connected', synced: true })).toBe('synced');
  });

  it('never reports SYNCED while disconnected (the anti-lie)', () => {
    expect(derive({ providerStatus: 'disconnected', synced: true, online: true })).not.toBe(
      'synced',
    );
    expect(derive({ providerStatus: 'disconnected', synced: true, online: false })).not.toBe(
      'synced',
    );
  });

  it('browser reports no network → offline (regardless of socket phase)', () => {
    expect(derive({ providerStatus: 'connecting', online: false, connectedOnce: true })).toBe(
      'offline',
    );
    expect(derive({ providerStatus: 'disconnected', online: false, connectedOnce: false })).toBe(
      'offline',
    );
  });

  it('online + had a prior connection + socket down → reconnecting (server outage case, §13)', () => {
    expect(derive({ providerStatus: 'disconnected', online: true, connectedOnce: true })).toBe(
      'reconnecting',
    );
    expect(derive({ providerStatus: 'connecting', online: true, connectedOnce: true })).toBe(
      'reconnecting',
    );
  });

  it('offline is preferred over reconnecting when the browser has no network', () => {
    // A dropped socket while the browser is offline must not claim it is "retrying"
    // against a network that isn't there.
    expect(derive({ providerStatus: 'connecting', online: false, connectedOnce: true })).toBe(
      'offline',
    );
  });

  it('fatal auth failure → error (terminal, non-retryable)', () => {
    expect(derive({ authFailed: true })).toBe('error');
    expect(derive({ authFailed: true, providerStatus: 'connecting', online: false })).toBe('error');
  });
});
