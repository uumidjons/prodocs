import { create } from 'zustand';
import type { Role } from '@scribe/shared';
import type { SyncStatus } from '../ui/StatusPill.js';
import type { PresenceUser } from '../features/collaboration/types.js';

/**
 * The document currently open in the editor, as far as the app CHROME needs to
 * know it: id + the current user's role. This lets the header's Share control know
 * which document to manage and whether the user may manage sharing (owner). It is
 * metadata only — never document content, which stays in Yjs.
 */
export interface ActiveDocument {
  id: string;
  role: Role;
  /** The document title — rendered/edited in the header (task §1). Metadata only. */
  title: string;
}

/**
 * Ephemeral UI + session-level collaboration STATUS (not content). Per ADR-0007
 * and the Phase 2 boundary: the document itself lives in Yjs/Tiptap and is NEVER
 * mirrored here. This store only holds chrome state plus the *derived* connection
 * status and presence list, which are legitimately application-level UI concerns
 * surfaced in the header.
 */
interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  /** Real collaboration/provider sync status; null when no document is open. */
  connectionStatus: SyncStatus | null;
  setConnectionStatus: (status: SyncStatus | null) => void;

  /** Live collaborators from Yjs awareness (ephemeral); empty when no doc is open. */
  presence: PresenceUser[];
  setPresence: (presence: PresenceUser[]) => void;

  /** The open document (id + role + title); null on the document list. Drives the
   *  header Share control and the header document title. */
  activeDocument: ActiveDocument | null;
  setActiveDocument: (doc: ActiveDocument | null) => void;
  /** Optimistically update just the active document's title (header rename). */
  setActiveDocumentTitle: (title: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  connectionStatus: null,
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  presence: [],
  setPresence: (presence) => set({ presence }),

  activeDocument: null,
  setActiveDocument: (activeDocument) => set({ activeDocument }),
  setActiveDocumentTitle: (title) =>
    set((s) => (s.activeDocument ? { activeDocument: { ...s.activeDocument, title } } : s)),
}));
