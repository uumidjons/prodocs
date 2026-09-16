import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberDto, UserSearchResultDto } from '@scribe/shared';

/**
 * ShareDialog tests — the sharing UI behavior against a mocked API: owner can
 * manage (search + add + change role + remove), a non-owner sees a read-only
 * roster, and errors surface as understandable copy. Server-side authorization is
 * proven by the backend integration suite; this covers the UI contract.
 */

const listMock = vi.fn();
const addMock = vi.fn();
const changeRoleMock = vi.fn();
const removeMock = vi.fn();
const searchMock = vi.fn();

vi.mock('../../api/index.js', () => ({
  api: {
    documents: {
      members: {
        list: (id: string) => listMock(id),
        add: (id: string, input: unknown) => addMock(id, input),
        changeRole: (id: string, userId: string, role: string) => changeRoleMock(id, userId, role),
        remove: (id: string, userId: string) => removeMock(id, userId),
      },
    },
    users: { search: (q: string) => searchMock(q) },
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { ApiError } = await import('../../api/index.js');
const { ShareDialog } = await import('./ShareDialog.js');

const owner: MemberDto = {
  userId: 'u-owner',
  email: 'owner@example.com',
  displayName: 'Olive Owner',
  color: '#3B49DF',
  role: 'owner',
  isOwner: true,
};
const editor: MemberDto = {
  userId: 'u-editor',
  email: 'ed@example.com',
  displayName: 'Ed Editor',
  color: '#10B981',
  role: 'editor',
  isOwner: false,
};

const candidate: UserSearchResultDto = {
  id: 'u-new',
  email: 'new@example.com',
  displayName: 'Nina New',
  color: '#F43F5E',
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([owner, editor]);
  addMock.mockReset();
  changeRoleMock.mockReset();
  removeMock.mockReset();
  searchMock.mockReset().mockResolvedValue([candidate]);
});

afterEach(() => vi.restoreAllMocks());

describe('ShareDialog (owner)', () => {
  it('lists members and marks the owner', async () => {
    render(<ShareDialog documentId="d1" role="owner" onClose={() => {}} />);
    expect(await screen.findByText('Olive Owner')).toBeInTheDocument();
    expect(screen.getByText('Ed Editor')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    // Owner controls exist for the editor row.
    expect(screen.getByLabelText('Role for Ed Editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Ed Editor')).toBeInTheDocument();
  });

  it('searches and adds a user with the chosen role', async () => {
    addMock.mockResolvedValue([
      owner,
      editor,
      { ...candidate, userId: candidate.id, role: 'viewer', isOwner: false },
    ]);
    render(<ShareDialog documentId="d1" role="owner" onClose={() => {}} />);
    await screen.findByText('Olive Owner');

    fireEvent.change(screen.getByLabelText('Role for new member'), { target: { value: 'viewer' } });
    fireEvent.change(screen.getByLabelText('Search users to add'), { target: { value: 'nina' } });

    const result = await screen.findByText('Nina New');
    fireEvent.click(result);

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith('d1', { userId: 'u-new', role: 'viewer' }),
    );
    expect(await screen.findByText(/now has access/)).toBeInTheDocument();
  });

  it('changes a member role and removes a member', async () => {
    changeRoleMock.mockResolvedValue([owner, { ...editor, role: 'viewer' }]);
    removeMock.mockResolvedValue([owner]);
    render(<ShareDialog documentId="d1" role="owner" onClose={() => {}} />);
    await screen.findByText('Ed Editor');

    fireEvent.change(screen.getByLabelText('Role for Ed Editor'), { target: { value: 'viewer' } });
    await waitFor(() => expect(changeRoleMock).toHaveBeenCalledWith('d1', 'u-editor', 'viewer'));

    fireEvent.click(screen.getByLabelText('Remove Ed Editor'));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('d1', 'u-editor'));
  });

  it('surfaces a server error as understandable copy', async () => {
    addMock.mockRejectedValue(new ApiError(409, 'conflict', 'User already has access'));
    render(<ShareDialog documentId="d1" role="owner" onClose={() => {}} />);
    await screen.findByText('Olive Owner');
    fireEvent.change(screen.getByLabelText('Search users to add'), { target: { value: 'nina' } });
    fireEvent.click(await screen.findByText('Nina New'));
    expect(await screen.findByText('User already has access')).toBeInTheDocument();
  });
});

describe('ShareDialog (non-owner)', () => {
  it('shows a read-only roster and the manage-lock note', async () => {
    render(<ShareDialog documentId="d1" role="viewer" onClose={() => {}} />);
    await screen.findByText('Olive Owner');
    // No add control, no role selects for members.
    expect(screen.queryByLabelText('Search users to add')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role for Ed Editor')).not.toBeInTheDocument();
    expect(screen.getByText('Only the owner can manage sharing.')).toBeInTheDocument();
    // Editor's role shows as a static badge.
    // Role shows as a static badge (text node is "Editor"; CSS uppercases it).
    const editorRow = screen.getByText('Ed Editor').closest('li') as HTMLElement;
    expect(within(editorRow).getByText('Editor')).toBeInTheDocument();
  });
});
