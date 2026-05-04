import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { getPeople } from '../services/users';
import { formatAmount, timeAgo } from '../utils/format';

function PersonRow({ person }) {
  const net = Number.parseFloat(person.net ?? 0);
  const settled = net === 0;

  return (
    <Link
      to={`/people/${person.user.id}`}
      className="flex items-center justify-between gap-3 rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card transition active:bg-surface-soft/50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={person.user.name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-app-text">{person.user.name}</p>
          <p className="mt-0.5 text-xs text-app-muted">
            {person.sharedGroupCount} {person.sharedGroupCount === 1 ? 'shared group' : 'shared groups'}
            {person.lastActivityAt ? ` · ${timeAgo(person.lastActivityAt)}` : ''}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold ${net < 0 ? 'text-accent-coral' : net > 0 ? 'text-accent-forest' : 'text-app-muted'}`}>
          {settled ? 'Settled' : `${net > 0 ? '+' : '−'}${formatAmount(net)}`}
        </p>
        {!settled && (
          <p className="mt-0.5 text-xs text-app-muted">
            {net < 0 ? 'you owe' : 'owes you'}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function PeoplePage() {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');

  function loadPeople() {
    setError('');
    getPeople()
      .then(setPeople)
      .catch((err) => setError(err.response?.data?.error ?? 'Could not load people'));
  }

  useEffect(() => {
    loadPeople();
    const refresh = () => loadPeople();
    window.addEventListener('splitwise:settlementChanged', refresh);
    window.addEventListener('splitwise:expenseChanged', refresh);
    return () => {
      window.removeEventListener('splitwise:settlementChanged', refresh);
      window.removeEventListener('splitwise:expenseChanged', refresh);
    };
  }, []);

  const totals = useMemo(() => {
    const rows = people ?? [];
    return rows.reduce(
      (acc, person) => {
        acc.youOwe += Number.parseFloat(person.totalYouOwe ?? 0);
        acc.theyOwe += Number.parseFloat(person.totalTheyOwe ?? 0);
        return acc;
      },
      { youOwe: 0, theyOwe: 0 },
    );
  }, [people]);

  const outstanding = people?.filter((p) => Number.parseFloat(p.net ?? 0) !== 0) ?? [];
  const settled = people?.filter((p) => Number.parseFloat(p.net ?? 0) === 0) ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <header>
        <p className="text-xs uppercase tracking-label text-app-muted">Shared balances</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-app-text">People</h1>
      </header>

      <section className="mt-5 rounded-panel bg-surface-inverted p-5 text-white shadow-soft">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-tag text-white/40">Owed to you</p>
            <p className="mt-2 text-2xl font-semibold text-accent-lime">{formatAmount(totals.theyOwe)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-tag text-white/40">You owe</p>
            <p className="mt-2 text-2xl font-semibold text-accent-coral">{formatAmount(totals.youOwe)}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="mt-5 rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-accent-coral shadow-card">
          {error}
        </div>
      )}

      {!people && !error && (
        <div className="mt-5 space-y-2">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-card bg-surface-soft" />
          ))}
        </div>
      )}

      {people?.length === 0 && (
        <div className="mt-10 rounded-panel border border-app-border/40 bg-surface-base px-5 py-12 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-2xl">
            👤
          </div>
          <p className="text-base font-semibold text-app-text">No people yet</p>
          <p className="mt-1 text-sm text-app-muted">Add people to a group to see cross-group balances here.</p>
        </div>
      )}

      {outstanding.length > 0 && (
        <section className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-label text-app-muted">Outstanding</h2>
          <div className="space-y-2">
            {outstanding.map((person) => (
              <PersonRow key={person.user.id} person={person} />
            ))}
          </div>
        </section>
      )}

      {settled.length > 0 && (
        <section className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-label text-app-muted">Settled up</h2>
          <div className="space-y-2">
            {settled.map((person) => (
              <PersonRow key={person.user.id} person={person} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
