import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import SettleUpSheet from '../components/SettleUpSheet';
import ConfirmSheet from '../components/ConfirmSheet';
import { useAuth } from '../contexts/AuthContext';
import { getPerson, settleWithPerson } from '../services/users';
import { formatAmount, formatDate, timeAgo } from '../utils/format';

function SummaryCopy({ net, name }) {
  const value = Number.parseFloat(net ?? 0);
  if (value < 0) return <>You owe {name} <span className="text-accent-coral">{formatAmount(value)}</span></>;
  if (value > 0) return <>{name} owes you <span className="text-accent-lime">{formatAmount(value)}</span></>;
  return <>All settled up</>;
}

function GroupBalanceRow({ group, onSettle }) {
  const net = Number.parseFloat(group.net ?? 0);
  const settled = net === 0;

  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-app-text">{group.groupName}</p>
            <span className="rounded-pill bg-surface-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tag text-app-muted">
              {group.type}
            </span>
          </div>
          <p className={`mt-1 text-sm ${net < 0 ? 'text-accent-coral' : net > 0 ? 'text-accent-forest' : 'text-app-muted'}`}>
            {settled ? 'Settled' : net < 0 ? `You owe ${formatAmount(group.youOwe)}` : `Owes you ${formatAmount(group.theyOwe)}`}
          </p>
        </div>
        {!settled && group.canSettle && (
          <button
            type="button"
            onClick={() => onSettle(group)}
            className="shrink-0 rounded-pill bg-accent-forest px-3 py-2 text-xs font-semibold text-white"
          >
            Settle
          </button>
        )}
      </div>
    </div>
  );
}

function ExpenseRow({ expense }) {
  return (
    <Link
      to={`/groups/${expense.group.id}/expenses/${expense.id}`}
      className="block rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card transition active:bg-surface-soft/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-app-text">{expense.description}</p>
          <p className="mt-0.5 text-xs text-app-muted">
            {expense.group.name} · {formatDate(expense.date)}
          </p>
          <p className="mt-2 text-xs text-app-muted">
            You {formatAmount(expense.yourShare)} · Them {formatAmount(expense.theirShare)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-app-text">{formatAmount(expense.amount)}</p>
          <p className="mt-0.5 text-xs text-app-muted">{expense.paidBy?.name} paid</p>
        </div>
      </div>
    </Link>
  );
}

function SettlementRow({ settlement, currentUserId }) {
  const paidByYou = settlement.paidBy?.id === currentUserId;
  const paidToYou = settlement.paidTo?.id === currentUserId;
  const direction = paidByYou
    ? `You paid ${settlement.paidTo?.name}`
    : paidToYou
      ? `${settlement.paidBy?.name} paid you`
      : `${settlement.paidBy?.name} paid ${settlement.paidTo?.name}`;

  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-app-text">{direction}</p>
          <p className="mt-0.5 text-xs text-app-muted">{settlement.group.name} · {formatDate(settlement.date)}</p>
        </div>
        <p className="shrink-0 text-sm font-semibold text-app-text">{formatAmount(settlement.amount)}</p>
      </div>
    </div>
  );
}

export default function PersonDetailPage() {
  const { userId } = useParams();
  const { user: currentUser } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settlingAll, setSettlingAll] = useState(false);
  const [settleGroup, setSettleGroup] = useState(null);
  const [settleAllOpen, setSettleAllOpen] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const loadPerson = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getPerson(userId));
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load person');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadPerson();
  }, [loadPerson]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }

  async function handleSettleAll() {
    setSettlingAll(true);
    setError('');
    try {
      await settleWithPerson(userId);
      await loadPerson();
      window.dispatchEvent(new CustomEvent('splitwise:settlementChanged'));
      showToast('Settled across groups');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not settle with this person');
    } finally {
      setSettlingAll(false);
    }
  }

  async function handleGroupSettlement() {
    setSettleGroup(null);
    await loadPerson();
    window.dispatchEvent(new CustomEvent('splitwise:settlementChanged'));
    showToast('Payment recorded');
  }

  const nonZeroGroups = useMemo(
    () => (data?.groups ?? []).filter((group) => Number.parseFloat(group.net ?? 0) !== 0),
    [data],
  );

  const settleTarget = settleGroup
    ? {
        id: data?.user.id,
        name: data?.user.name,
        avatarUrl: data?.user.avatarUrl,
      }
    : null;
  const settleAmount = settleGroup
    ? (Number.parseFloat(settleGroup.net) < 0 ? settleGroup.youOwe : settleGroup.theyOwe)
    : '';
  const youOwe = settleGroup ? Number.parseFloat(settleGroup.net) < 0 : true;

  return (
    <div className="mx-auto min-h-[calc(100svh-5rem)] max-w-3xl px-4 py-5 sm:px-6">
      {toast && (
        <div className="fixed bottom-36 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card">
          {toast}
        </div>
      )}

      <header className="mb-5">
        <Link
          to="/people"
          className="flex h-10 w-fit items-center gap-2 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text transition active:opacity-70"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          People
        </Link>
      </header>

      {loading && (
        <div className="mt-5 space-y-3">
          <div className="h-44 animate-pulse rounded-panel bg-surface-soft" />
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-card bg-surface-soft" />
          ))}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-accent-coral shadow-card">
          {error}
        </div>
      )}

      {!loading && data && (
        <main className="mt-5 space-y-6">
          <section className="rounded-panel bg-surface-inverted p-5 text-white shadow-soft">
            <div className="flex items-center gap-4">
              <Avatar name={data.user.name} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{data.user.name}</p>
                {data.user.email && <p className="mt-0.5 truncate text-sm text-white/45">{data.user.email}</p>}
              </div>
            </div>
            <p className="mt-5 text-2xl font-semibold">
              <SummaryCopy net={data.summary.net} name={data.user.name} />
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-tile bg-white/[0.06] p-3">
                <p className="text-xs uppercase tracking-tag text-white/35">You owe</p>
                <p className="mt-1 font-semibold text-accent-coral">{formatAmount(data.summary.totalYouOwe)}</p>
              </div>
              <div className="rounded-tile bg-white/[0.06] p-3">
                <p className="text-xs uppercase tracking-tag text-white/35">Owes you</p>
                <p className="mt-1 font-semibold text-accent-lime">{formatAmount(data.summary.totalTheyOwe)}</p>
              </div>
            </div>
            {nonZeroGroups.length > 0 && (
              <button
                type="button"
                onClick={() => setSettleAllOpen(true)}
                disabled={settlingAll}
                className="mt-5 h-12 w-full rounded-card bg-accent-forest text-sm font-semibold text-white disabled:opacity-50"
              >
                {settlingAll ? 'Settling...' : 'Settle all balances'}
              </button>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Shared groups</h2>
            <div className="space-y-2">
              {data.groups.map((group) => (
                <GroupBalanceRow
                  key={group.groupId}
                  group={group}
                  onSettle={(selected) => setSettleGroup(selected)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Recent expenses</h2>
            {data.recentExpenses.length > 0 ? (
              <div className="space-y-2">
                {data.recentExpenses.map((expense) => (
                  <ExpenseRow key={expense.id} expense={expense} />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-app-muted shadow-card">
                No recent expenses together.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Recent settlements</h2>
            {data.recentSettlements.length > 0 ? (
              <div className="space-y-2">
                {data.recentSettlements.map((settlement) => (
                  <SettlementRow
                    key={settlement.id}
                    settlement={settlement}
                    currentUserId={currentUser?.id}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-app-muted shadow-card">
                No recent settlements.
              </div>
            )}
          </section>
        </main>
      )}

      <SettleUpSheet
        groupId={settleGroup?.groupId}
        open={!!settleGroup}
        onClose={() => setSettleGroup(null)}
        onSuccess={handleGroupSettlement}
        targetUser={settleTarget}
        defaultAmount={settleAmount}
        youOwe={youOwe}
      />
      <ConfirmSheet
        open={settleAllOpen}
        onClose={() => setSettleAllOpen(false)}
        onConfirm={handleSettleAll}
        title={`Settle all with ${data?.user?.name ?? 'this person'}?`}
        message="Payments will be recorded across all shared groups."
        confirmLabel="Settle all"
      />
    </div>
  );
}
