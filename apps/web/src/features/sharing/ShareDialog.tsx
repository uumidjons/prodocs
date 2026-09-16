import { useEffect, useState } from 'react';
import type { AssignableRole, MemberDto, Role } from '@scribe/shared';
import { assignableRoles } from '@scribe/shared';
import { Avatar } from '../../ui/Avatar.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { cn } from '../../ui/cn.js';
import { useSharing, useUserSearch } from './useSharing.js';

interface ShareDialogProps {
  documentId: string;
  /** The current user's role on this document; only the owner may manage sharing. */
  role: Role;
  onClose: () => void;
}

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_HINT: Record<AssignableRole, string> = {
  editor: 'Can edit',
  viewer: 'Can view',
};

const selectClass =
  'rounded-md border border-input-border bg-sheet px-2.5 py-1.5 text-body-sm text-ink ' +
  'focus:border-primary focus:shadow-focus-ring focus:outline-none disabled:opacity-60';

/** A styled role <select> constrained to the assignable roles (editor/viewer). */
function RoleSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: AssignableRole;
  onChange: (role: AssignableRole) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      className={selectClass}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as AssignableRole)}
    >
      {assignableRoles.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

/**
 * The Share experience: a Level-4 modal (UI/DESIGN.md) matching the Scribe design
 * system. It shows current members and their roles, marks the owner, and — for the
 * owner only — lets them add a registered user, change a member's role, or remove a
 * member. Non-owners see a read-only roster and a note that only the owner can
 * manage sharing. Every action goes through the server-side sharing API; the
 * frontend never trusts a role it holds locally.
 */
export function ShareDialog({ documentId, role, onClose }: ShareDialogProps) {
  const canManage = role === 'owner';
  const { members, loading, error, busy, addMember, changeRole, removeMember } = useSharing(
    documentId,
    true,
  );

  const [query, setQuery] = useState('');
  const [addRole, setAddRole] = useState<AssignableRole>('editor');
  const [notice, setNotice] = useState<string | null>(null);
  const { results, searching } = useUserSearch(query);

  // Close on Escape — standard modal behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const memberIds = new Set((members ?? []).map((m) => m.userId));
  // Don't offer people who already have access — adding them is a 409 anyway.
  const candidates = results.filter((r) => !memberIds.has(r.id));

  async function handleAdd(userId: string, displayName: string) {
    const ok = await addMember(userId, addRole);
    if (ok) {
      setQuery('');
      setNotice(`${displayName} now has access.`);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.2)] px-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share document"
        className="flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-hidden rounded-lg bg-sheet shadow-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
            <Icon name="ios_share" size={18} className="text-primary" />
            Share document
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink-2"
            aria-label="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Add member (owner only) */}
          {canManage && (
            <div className="mb-5">
              <label className="mb-1.5 block text-label-md font-semibold text-ink-2">
                Add people
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    className="w-full rounded-md border border-input-border bg-sheet px-3 py-2 text-body-default text-ink placeholder:text-ink-3 focus:border-primary focus:shadow-focus-ring focus:outline-none"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setNotice(null);
                    }}
                    placeholder="Search by name or email"
                    aria-label="Search users to add"
                    autoComplete="off"
                  />
                  {query.trim().length >= 2 && (
                    <div className="absolute left-0 right-0 top-11 z-10 max-h-56 overflow-y-auto rounded-md border border-border bg-sheet py-1 shadow-overlay">
                      {searching && (
                        <div className="flex items-center gap-2 px-3 py-2 text-body-sm text-ink-3">
                          <Spinner size={14} /> Searching…
                        </div>
                      )}
                      {!searching && candidates.length === 0 && (
                        <div className="px-3 py-2 text-body-sm text-ink-3">No matching users.</div>
                      )}
                      {!searching &&
                        candidates.map((u) => (
                          <button
                            key={u.id}
                            disabled={busy}
                            onClick={() => void handleAdd(u.id, u.displayName)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-subtle disabled:opacity-60"
                          >
                            <Avatar name={u.displayName} color={u.color} size={26} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-body-default text-ink">
                                {u.displayName}
                              </span>
                              <span className="block truncate text-body-sm text-ink-3">
                                {u.email}
                              </span>
                            </span>
                            <Icon name="add" size={18} className="text-primary" />
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <RoleSelect
                  value={addRole}
                  onChange={setAddRole}
                  disabled={busy}
                  ariaLabel="Role for new member"
                />
              </div>
              <p className="mt-1.5 text-body-sm text-ink-3">{ROLE_HINT[addRole]}.</p>
            </div>
          )}

          {/* Feedback */}
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-body-sm text-error"
            >
              <Icon name="error" size={16} /> {error}
            </div>
          )}
          {notice && !error && (
            <div className="mb-4 flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-body-sm text-primary">
              <Icon name="check_circle" size={16} /> {notice}
            </div>
          )}

          {/* Member list */}
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-label-md font-semibold text-ink-2">People with access</span>
            {busy && <Spinner size={14} />}
          </div>

          {loading && !members ? (
            <div className="flex justify-center py-8">
              <Spinner size={22} />
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {(members ?? []).map((m) => (
                <MemberRow
                  key={m.userId}
                  member={m}
                  canManage={canManage}
                  busy={busy}
                  onChangeRole={(r) => void changeRole(m.userId, r)}
                  onRemove={() => void removeMember(m.userId)}
                />
              ))}
            </ul>
          )}

          {!canManage && !loading && (
            <p className="mt-4 flex items-center gap-1.5 text-body-sm text-ink-3">
              <Icon name="lock" size={14} /> Only the owner can manage sharing.
            </p>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  busy,
  onChangeRole,
  onRemove,
}: {
  member: MemberDto;
  canManage: boolean;
  busy: boolean;
  onChangeRole: (role: AssignableRole) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-subtle">
      <Avatar name={member.displayName} color={member.color} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-default text-ink">{member.displayName}</div>
        <div className="truncate text-body-sm text-ink-3">{member.email}</div>
      </div>

      {/* The owner is fixed (owner invariant); everyone else is manageable by the owner. */}
      {member.isOwner ? (
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-label-sm font-semibold uppercase text-primary">
          Owner
        </span>
      ) : canManage ? (
        <div className="flex items-center gap-1.5">
          <RoleSelect
            value={member.role as AssignableRole}
            onChange={onChangeRole}
            disabled={busy}
            ariaLabel={`Role for ${member.displayName}`}
          />
          <button
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${member.displayName}`}
            className={cn(
              'rounded-md p-1.5 text-ink-3 transition-colors hover:bg-error-bg hover:text-error',
              'disabled:pointer-events-none disabled:opacity-60',
            )}
          >
            <Icon name="person_remove" size={18} />
          </button>
        </div>
      ) : (
        <span className="rounded-full bg-subtle px-2.5 py-0.5 text-label-sm font-semibold uppercase text-ink-2">
          {ROLE_LABEL[member.role]}
        </span>
      )}
    </li>
  );
}
