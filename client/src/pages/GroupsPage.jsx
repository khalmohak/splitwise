import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getGroups } from '../services/groups';
import CreateGroupSheet from '../components/CreateGroupSheet';
import { formatAmount } from '../utils/format';

function GroupCard({ group }) {
  const balance = parseFloat(group.yourBalance);
  const isNeg = balance < 0;
  const isPos = balance > 0;

  return (
    <Link
      to={`/groups/${group.id}`}
      className="flex items-center justify-between rounded-card border border-app-border/40 bg-surface-base px-4 py-4 shadow-card transition active:bg-surface-soft/50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile bg-surface-soft text-lg">
          {group.type === 'household' ? '🏠' : '👥'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-app-text">{group.name}</p>
          <p className="mt-0.5 text-xs text-app-muted">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            {group.yourRole === 'admin' && ' · admin'}
          </p>
        </div>
      </div>
      <div className="ml-4 shrink-0 text-right">
        {balance === 0 ? (
          <p className="text-sm text-app-muted">Settled</p>
        ) : (
          <>
            <p className={`text-sm font-semibold ${isNeg ? 'text-accent-coral' : 'text-status-success'}`}>
              {isNeg ? '−' : '+'}{formatAmount(group.yourBalance)}
            </p>
            <p className="mt-0.5 text-xs text-app-muted">
              {isNeg ? 'you owe' : "you're owed"}
            </p>
          </>
        )}
      </div>
    </Link>
  );
}

export default function GroupsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  function loadGroups() {
    getGroups()
      .then(setGroups)
      .catch(() => setError('Could not load groups'));
  }

  useEffect(() => {
    loadGroups();
    const refresh = () => loadGroups();
    window.addEventListener('splitwise:expenseChanged', refresh);
    return () => window.removeEventListener('splitwise:expenseChanged', refresh);
  }, []);

  function handleCreated(group) {
    setCreateOpen(false);
    loadGroups();
    navigate(`/groups/${group.id}?tab=members`);
  }

  const household = groups?.filter((g) => g.type === 'household') ?? [];
  const personal = groups?.filter((g) => g.type === 'personal') ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-label text-app-muted">Your groups</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-app-text">Groups</h1>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-card bg-accent-forest px-4 py-2.5 text-sm font-semibold text-white transition active:opacity-80"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New group
        </button>
      </div>

      {/* Loading skeletons */}
      {!groups && !error && (
        <div className="mt-5 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-18 animate-pulse rounded-card bg-surface-soft" style={{ height: '72px' }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-5 rounded-card border border-app-border/40 bg-surface-soft px-4 py-4">
          <p className="text-sm text-app-muted">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {groups?.length === 0 && (
        <div className="mt-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-soft text-2xl">
            👥
          </div>
          <p className="text-base font-semibold text-app-text">No groups yet</p>
          <p className="mt-2 text-sm text-app-muted">
            Create a group to start splitting expenses with others.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-6 rounded-card bg-accent-forest px-6 py-3 text-sm font-semibold text-white"
          >
            Create your first group
          </button>
        </div>
      )}

      {/* Household groups */}
      {household.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">
            🏠 Household
          </h2>
          <div className="space-y-2">
            {household.map((g) => <GroupCard key={g.id} group={g} />)}
          </div>
        </section>
      )}

      {/* Personal groups */}
      {personal.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">
            👥 Personal
          </h2>
          <div className="space-y-2">
            {personal.map((g) => <GroupCard key={g.id} group={g} />)}
          </div>
        </section>
      )}

      <CreateGroupSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleCreated}
      />

    </div>
  );
}
