import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import { addMember } from '../services/members';
import { listUsers } from '../services/users';

export default function AddMemberSheet({ groupId, open, onClose, onSuccess, existingMemberIds = [] }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState(null);

  function reset() {
    setUsers([]);
    setUserId('');
    setQuery('');
    setListOpen(false);
    setHighlightedIndex(0);
    setRole('member');
    setError(null);
    setLoading(false);
    setLoadingUsers(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const selected = users.find((u) => u.id === userId);
      if (!selected?.email) throw new Error('MISSING_EMAIL');
      await addMember(groupId, selected.email.trim(), role);
      reset();
      onSuccess();
    } catch (err) {
      if (err?.message === 'MISSING_EMAIL') setError('Selected user does not have an email.');
      else setError(err.response?.data?.error ?? 'Failed to add member');
    } finally {
      setLoading(false);
    }
  }

  const selectableUsers = useMemo(() => (Array.isArray(users) ? users : []), [users]);

  const selectedUser = useMemo(() => selectableUsers.find((u) => u.id === userId) ?? null, [selectableUsers, userId]);

  const filteredUsers = useMemo(() => {
    const list = selectableUsers ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => {
      const name = (u?.name ?? '').toLowerCase();
      const email = (u?.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [query, selectableUsers]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoadingUsers(true);
    listUsers()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setUsers(list);
      })
      .catch((err) => setError(err.response?.data?.error ?? 'Could not load users'))
      .finally(() => setLoadingUsers(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setUserId('');
  }, [open, selectableUsers]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open, selectedUser]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  return (
    <BottomSheet open={open} onClose={handleClose} title="Add member">
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {error && (
          <div className="rounded-card bg-accent-coral/10 px-4 py-3 text-sm text-accent-coral">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-label text-app-muted">
            User
          </label>
          <div className="relative">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setUserId('');
                setListOpen(true);
              }}
              onFocus={() => setListOpen(true)}
              onBlur={() => window.setTimeout(() => setListOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setListOpen(false);
                  return;
                }
                if (!listOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  setListOpen(true);
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightedIndex((i) => Math.min(i + 1, Math.max(filteredUsers.length - 1, 0)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightedIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && listOpen) {
                  const picked = filteredUsers[highlightedIndex];
                  if (picked) {
                    e.preventDefault();
                    setUserId(picked.id);
                    setQuery(picked.name ?? '');
                    setListOpen(false);
                  }
                }
              }}
              disabled={loadingUsers || selectableUsers.length === 0}
              aria-label="Search users"
              placeholder={loadingUsers ? 'Loading…' : selectableUsers.length === 0 ? 'No users available' : 'Search by name or email'}
              className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60 disabled:opacity-60"
            />

            <input type="hidden" value={userId} required />

            {listOpen && !loadingUsers && filteredUsers.length > 0 && (
              <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-card border border-app-border/60 bg-surface-base shadow-card">
                {filteredUsers.map((u, idx) => {
                  const active = u.id === userId;
                  const highlighted = idx === highlightedIndex;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => {
                        setUserId(u.id);
                        setQuery(u.name ?? '');
                        setListOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${
                        highlighted ? 'bg-surface-soft' : 'bg-transparent'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-app-text">{u.name}</p>
                        {u.email && <p className="mt-0.5 truncate text-xs text-app-muted">{u.email}</p>}
                      </div>
                      <div className="shrink-0 text-xs font-semibold">
                        {active ? <span className="text-accent-forest">Selected</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {listOpen && !loadingUsers && filteredUsers.length === 0 && (
              <div className="absolute z-30 mt-2 w-full rounded-card border border-app-border/60 bg-surface-base px-4 py-3 text-sm text-app-muted shadow-card">
                No matches.
              </div>
            )}
          </div>

          {selectedUser?.email ? (
            <p className="text-xs text-app-muted">
              Adding <span className="font-medium text-app-text">{selectedUser.email}</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-label text-app-muted">
            Role
          </label>
          <div className="flex gap-2">
            {['member', 'admin'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`h-12 flex-1 rounded-card text-sm font-semibold capitalize transition ${
                  role === r
                    ? 'bg-surface-inverted text-white'
                    : 'bg-surface-soft text-app-text'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || loadingUsers || !userId}
          className="mt-2 h-14 w-full rounded-card bg-accent-forest text-sm font-semibold text-white transition disabled:opacity-50 active:opacity-85"
        >
          {loading ? 'Adding…' : 'Add member'}
        </button>
      </form>
    </BottomSheet>
  );
}
