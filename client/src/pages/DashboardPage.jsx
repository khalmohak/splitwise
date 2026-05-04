import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getDashboard } from '../services/users';
import { formatAmount, timeAgo } from '../utils/format';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function activityIcon(type) {
  if (!type) return '·';
  if (type.includes('expense') && type.includes('delet')) return '🗑️';
  if (type.includes('expense') && type.includes('edit')) return '✏️';
  if (type.includes('expense')) return '💸';
  if (type.includes('settlement')) return '✅';
  if (type.includes('member')) return '👤';
  return '·';
}

function GroupRow({ group }) {
  const balance = parseFloat(group.yourBalance);
  const isNeg = balance < 0;
  const isPos = balance > 0;

  return (
    <Link
      to={`/groups/${group.id}`}
      className="flex items-center justify-between rounded-card border border-app-border/40 bg-surface-base px-4 py-3.5 shadow-card transition active:bg-surface-soft/50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile bg-surface-soft text-base">
          {group.type === 'household' ? '🏠' : '👥'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-app-text">{group.name}</p>
          <p className="mt-0.5 text-xs capitalize text-app-muted">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>
      </div>
      <div className="ml-3 shrink-0 text-right">
        <p className={`text-sm font-semibold ${isNeg ? 'text-accent-coral' : isPos ? 'text-status-success' : 'text-app-muted'}`}>
          {isNeg ? '−' : isPos ? '+' : ''}{formatAmount(group.yourBalance)}
        </p>
        <p className="mt-0.5 text-[11px] text-app-muted">
          {isNeg ? 'you owe' : isPos ? "you're owed" : 'settled'}
        </p>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  function loadDashboard() {
    getDashboard()
      .then(setData)
      .catch(() => setError('Could not load dashboard'));
  }

  useEffect(() => {
    loadDashboard();
    const refresh = () => loadDashboard();
    window.addEventListener('splitwise:expenseChanged', refresh);
    return () => window.removeEventListener('splitwise:expenseChanged', refresh);
  }, []);

  const net = data ? parseFloat(data.balanceSummary.net) : 0;
  const isPos = net > 0;
  const isNeg = net < 0;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-6 sm:px-6">

      {/* Greeting */}
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-label text-app-muted">{getGreeting()}</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-app-text">
          {user?.name?.split(' ')[0]}
        </h1>
      </div>

      {/* Balance card */}
      {error ? (
        <div className="rounded-panel border border-app-border/40 bg-surface-soft px-5 py-4">
          <p className="text-sm text-app-muted">{error}</p>
        </div>
      ) : !data ? (
        <div className="h-40 animate-pulse rounded-panel bg-surface-soft" />
      ) : (
        <div className="rounded-panel bg-surface-inverted p-5 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-label text-white/40">Net balance</p>
          <p className={`mt-2 text-4xl font-semibold ${isPos ? 'text-accent-lime' : isNeg ? 'text-accent-coral' : 'text-white'}`}>
            {isNeg ? '−' : ''}{formatAmount(data.balanceSummary.net)}
          </p>
          <p className="mt-1 text-sm text-white/40">
            {isPos ? 'Overall others owe you' : isNeg ? 'You owe overall' : 'All settled up'}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-tile bg-white/[0.06] p-3">
              <p className="text-[10px] font-medium uppercase tracking-label text-white/35">You're owed</p>
              <p className="mt-1 text-base font-semibold text-accent-lime">
                {formatAmount(data.balanceSummary.totalOwed)}
              </p>
            </div>
            <div className="rounded-tile bg-white/[0.06] p-3">
              <p className="text-[10px] font-medium uppercase tracking-label text-white/35">You owe</p>
              <p className="mt-1 text-base font-semibold text-accent-coral">
                {formatAmount(data.balanceSummary.totalYouOwe)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Groups */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-label text-app-muted">Your groups</h2>
          <Link to="/groups" className="text-sm font-medium text-accent-forest">
            See all
          </Link>
        </div>

        {!data && !error ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-card bg-surface-soft" />)}
          </div>
        ) : data?.groups?.length > 0 ? (
          <div className="space-y-2">
            {data.groups.map((g) => <GroupRow key={g.id} group={g} />)}
          </div>
        ) : !error ? (
          <div className="rounded-card border border-app-border/40 bg-surface-soft/60 px-4 py-8 text-center">
            <p className="text-sm text-app-muted">No groups yet</p>
            <Link
              to="/groups"
              className="mt-3 inline-block rounded-pill bg-accent-forest px-4 py-2.5 text-sm font-semibold text-white"
            >
              Create a group
            </Link>
          </div>
        ) : null}
      </section>

      {/* Upcoming recurring */}
      {data?.upcomingRecurring?.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Upcoming</h2>
          <div className="space-y-2">
            {data.upcomingRecurring.map((r) => (
              <div
                key={r.expenseId}
                className="flex items-center justify-between rounded-card border border-app-border/40 bg-surface-base px-4 py-3 shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">🔁</span>
                  <div>
                    <p className="text-sm font-semibold text-app-text">{r.description}</p>
                    <p className="mt-0.5 text-xs text-app-muted">{r.groupName} · due {r.recurAnchor}</p>
                  </div>
                </div>
                <p className="ml-4 shrink-0 text-sm font-semibold text-app-text">{formatAmount(r.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {data?.recentActivity?.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Recent activity</h2>
          <div className="overflow-hidden rounded-card border border-app-border/40 bg-surface-base shadow-card divide-y divide-app-border/30">
            {data.recentActivity.map((item, i) => (
              <div key={`${item.type}-${i}`} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0 text-base leading-none">{activityIcon(item.type)}</span>
                <p className="flex-1 text-sm leading-5 text-app-text">{item.summary}</p>
                <p className="shrink-0 text-xs text-app-muted">{timeAgo(item.createdAt)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
