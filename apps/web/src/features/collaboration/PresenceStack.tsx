import { Avatar } from '../../ui/Avatar.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';

const MAX_VISIBLE = 3;

/**
 * Overlapping avatar stack of the OTHER people currently in the document, derived
 * from real Yjs awareness (see useCollaboration). The current user is excluded
 * (their own avatar is already in the header). Renders nothing when alone, and
 * peers vanish automatically when their awareness times out on disconnect.
 */
export function PresenceStack() {
  const presence = useUiStore((s) => s.presence);
  const selfId = useAuthStore((s) => s.user?.id);

  const others = presence.filter((p) => p.id !== selfId);
  if (others.length === 0) return null;

  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <div
      className="flex items-center"
      aria-label={`${others.length} other ${others.length === 1 ? 'collaborator' : 'collaborators'} online`}
    >
      <div className="flex -space-x-2">
        {visible.map((p) => (
          <Avatar key={p.id} name={p.name} color={p.color} size={28} ring />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1 text-body-sm font-semibold text-ink-3">+{overflow}</span>
      )}
    </div>
  );
}
