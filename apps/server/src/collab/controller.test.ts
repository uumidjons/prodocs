import { afterEach, describe, expect, it } from 'vitest';
import type { Hocuspocus } from '@hocuspocus/server';
import {
  disconnectUserFromDocument,
  registerCollabServer,
  unregisterCollabServer,
} from './controller.js';

/**
 * Pure unit coverage for the live re-authorization primitive (no server/DB). Proves
 * it targets exactly the affected user's connections and is a safe no-op otherwise.
 */

interface FakeConnection {
  context: { userId: string };
  close: () => void;
}

function fakeServer(connectionsByDoc: Record<string, FakeConnection[]>): Hocuspocus {
  const documents = new Map(
    Object.entries(connectionsByDoc).map(([name, conns]) => [
      name,
      { getConnections: () => conns },
    ]),
  );
  return { documents } as unknown as Hocuspocus;
}

describe('disconnectUserFromDocument', () => {
  afterEach(() => unregisterCollabServer());

  it('is a no-op when no collab server is registered', () => {
    unregisterCollabServer();
    expect(disconnectUserFromDocument('doc', 'user')).toBe(0);
  });

  it('closes only the target user’s connections (incl. multiple tabs)', () => {
    const closed: string[] = [];
    const conns: FakeConnection[] = [
      { context: { userId: 'u1' }, close: () => closed.push('u1-a') },
      { context: { userId: 'u2' }, close: () => closed.push('u2') },
      { context: { userId: 'u1' }, close: () => closed.push('u1-b') },
    ];
    registerCollabServer(fakeServer({ doc: conns }));

    expect(disconnectUserFromDocument('doc', 'u1')).toBe(2);
    expect(closed).toEqual(['u1-a', 'u1-b']); // u2 (other collaborator) untouched
  });

  it('is a no-op for an unknown document', () => {
    registerCollabServer(fakeServer({}));
    expect(disconnectUserFromDocument('missing', 'u1')).toBe(0);
  });
});
