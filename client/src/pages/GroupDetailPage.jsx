import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AddExpenseSheet from '../components/AddExpenseSheet';
import AddMemberSheet from '../components/AddMemberSheet';
import SettleUpSheet from '../components/SettleUpSheet';
import ConfirmSheet from '../components/ConfirmSheet';
import BottomSheet from '../components/BottomSheet';
import Avatar from '../components/Avatar';
import {
  deleteGroup,
  getGroup,
  getGroupBalancesSimplified,
  getGroupDashboard,
  getMyGroupBalance,
  updateGroup,
} from '../services/groups';
import { getExpenses } from '../services/expenses';
import { changeMemberRole, removeMember } from '../services/members';
import { formatAmount, formatDateHeading, timeAgo } from '../utils/format';
import { downloadCsv } from '../utils/downloadCsv';

const tabs = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'members', label: 'Members' },
];

function AnalyticsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 flex-1 rounded-pill text-sm font-semibold transition ${
        active ? 'bg-surface-inverted text-white' : 'text-app-muted'
      }`}
    >
      {children}
    </button>
  );
}

function ExpenseRow({ expense, groupId, currentUserId }) {
  const paidByMe = expense.paidBy?.id === currentUserId;
  const hasTags = expense.tags?.length > 0;
  return (
    <Link
      to={`/groups/${groupId}/expenses/${expense.id}`}
      className="block rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card transition active:bg-surface-soft/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile bg-surface-soft text-lg">
            {expense.category?.icon ?? '📦'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-app-text">{expense.description}</p>
            <p className="mt-0.5 text-xs text-app-muted">
              {paidByMe ? 'You paid' : `${expense.paidBy?.name ?? 'Someone'} paid`}
            </p>
            {hasTags && (
              <div className="mt-1.5 flex gap-1">
                {expense.tags.slice(0, 2).map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-1 rounded-pill bg-surface-soft px-2 py-0.5 text-[10px] text-app-muted">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color ?? '#06B6D4' }} />
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-app-text">{formatAmount(expense.amount)}</p>
          <p className={`mt-0.5 text-xs font-medium ${paidByMe ? 'text-app-muted' : 'text-accent-coral'}`}>
            your share {formatAmount(expense.myShare)}
          </p>
          <p className="mt-0.5 text-xs text-app-muted">{timeAgo(expense.createdAt)}</p>
        </div>
      </div>
    </Link>
  );
}

function ExpenseList({ expenses, groupId, currentUserId }) {
  const grouped = useMemo(() => {
    return expenses.reduce((acc, expense) => {
      const key = expense.date;
      if (!acc[key]) acc[key] = [];
      acc[key].push(expense);
      return acc;
    }, {});
  }, [expenses]);

  return Object.entries(grouped).map(([date, items]) => (
    <section key={date} className="space-y-2">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-label text-app-muted">
        {formatDateHeading(date)}
      </h3>
      {items.map((expense) => (
        <ExpenseRow
          key={expense.id}
          expense={expense}
          groupId={groupId}
          currentUserId={currentUserId}
        />
      ))}
    </section>
  ));
}

function BalanceCopy({ net }) {
  const value = parseFloat(net ?? 0);
  if (value < 0) return <>You owe <span className="text-accent-coral">{formatAmount(value)}</span> net</>;
  if (value > 0) return <>You're owed <span className="text-accent-lime">{formatAmount(value)}</span> net</>;
  return <>All settled up 🎉</>;
}

export default function GroupDetailPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'expenses';

  const [group, setGroup] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [expenseMeta, setExpenseMeta] = useState(null);
  const [balances, setBalances] = useState(null);
  const [simplified, setSimplified] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState(null);
  const [toast, setToast] = useState('');
  const [exportingExpenses, setExportingExpenses] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', confirmLabel: 'Confirm', destructive: false, onConfirm: () => {} });
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [removingMember, setRemovingMember] = useState(null);

  const myMember = group?.members?.find((m) => (m.userId ?? m.id) === user?.id);
  const isAdmin = myMember?.role === 'admin';

  const loadExpenses = useCallback(async (page = 1, append = false) => {
    setExpensesLoading(true);
    try {
      const res = await getExpenses(groupId, { page, limit: 20, sort: 'date', order: 'desc' });
      setExpenseMeta(res.meta);
      setExpenses((prev) => (append ? [...prev, ...res.data] : res.data));
    } finally {
      setExpensesLoading(false);
    }
  }, [groupId]);

  const loadGroup = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [groupData, dashData, balanceData, simplifiedData] = await Promise.all([
        getGroup(groupId),
        getGroupDashboard(groupId).catch(() => null),
        getMyGroupBalance(groupId).catch(() => null),
        getGroupBalancesSimplified(groupId).catch(() => ({ balances: [] })),
      ]);
      setGroup(groupData);
      setDashboard(dashData);
      setBalances(balanceData);
      setSimplified(simplifiedData?.balances ?? []);
      await loadExpenses(1, false);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load group');
    } finally {
      setLoading(false);
    }
  }, [groupId, loadExpenses]);

  const refreshBalances = useCallback(async () => {
    const [dashData, balanceData, simplifiedData] = await Promise.all([
      getGroupDashboard(groupId).catch(() => null),
      getMyGroupBalance(groupId).catch(() => null),
      getGroupBalancesSimplified(groupId).catch(() => ({ balances: [] })),
    ]);
    setDashboard(dashData);
    setBalances(balanceData);
    setSimplified(simplifiedData?.balances ?? []);
  }, [groupId]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    const refresh = () => {
      loadExpenses(1, false);
      refreshBalances();
    };
    window.addEventListener('splitwise:expenseChanged', refresh);
    return () => window.removeEventListener('splitwise:expenseChanged', refresh);
  }, [loadExpenses, refreshBalances]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }

  async function handleExpenseAdded() {
    setAddExpenseOpen(false);
    await loadExpenses(1, false);
    await refreshBalances();
    showToast('Expense added');
  }

  async function handleSettlementRecorded() {
    setSettleTarget(null);
    await refreshBalances();
    showToast('Payment recorded');
  }

  async function handleMemberAdded() {
    setAddMemberOpen(false);
    await loadGroup();
    showToast('Member added');
  }

  function openRename() {
    setMenuOpen(false);
    setRenameName(group?.name ?? '');
    setRenameOpen(true);
  }

  async function handleRenameSubmit(e) {
    e.preventDefault();
    if (!renameName.trim() || renameName.trim() === group?.name) { setRenameOpen(false); return; }
    setRenameLoading(true);
    try {
      const updated = await updateGroup(groupId, { name: renameName.trim() });
      setGroup(updated);
      setRenameOpen(false);
      showToast('Group updated');
    } finally {
      setRenameLoading(false);
    }
  }

  function openDeleteGroup() {
    setMenuOpen(false);
    setConfirmConfig({
      title: 'Delete group?',
      message: 'This will permanently delete the group and all its expenses.',
      confirmLabel: 'Delete group',
      destructive: true,
      onConfirm: async () => {
        await deleteGroup(groupId);
        navigate('/groups', { replace: true });
      },
    });
    setConfirmOpen(true);
  }

  async function handleRoleChange(member, role) {
    await changeMemberRole(groupId, member.userId ?? member.id, role);
    await loadGroup();
  }

  function openRemoveMember(member) {
    setRemovingMember(member);
    setConfirmConfig({
      title: `Remove ${member.name}?`,
      message: 'They will lose access to this group.',
      confirmLabel: 'Remove member',
      destructive: true,
      onConfirm: async () => {
        await removeMember(groupId, member.userId ?? member.id);
        setRemovingMember(null);
        await loadGroup();
      },
    });
    setConfirmOpen(true);
  }

  const totalPages = expenseMeta?.totalPages ?? 1;
  const currentPage = expenseMeta?.page ?? 1;
  const thisMonth = dashboard?.thisMonth;

  return (
    <div className="min-h-[calc(100svh-5rem)]">
      <header className="sticky top-0 z-10 border-b border-app-border/40 bg-app-bg/95 backdrop-blur-chrome lg:top-14">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/groups"
                className="flex h-9 items-center gap-1.5 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text transition active:opacity-70"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Groups
              </Link>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-app-text">{group?.name ?? 'Group'}</h1>
                <p className="text-xs text-app-muted">
                  {group?.members?.length ?? 0} {(group?.members?.length ?? 0) === 1 ? 'member' : 'members'}
                </p>
              </div>
            </div>
            <div className="relative flex shrink-0 items-center gap-2">
              <Link
                to={`/groups/${groupId}/analytics`}
                aria-label="View analytics"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-soft text-app-muted transition active:scale-95"
              >
                <AnalyticsIcon />
              </Link>
              <button
                type="button"
                aria-label="Add expense"
                onClick={() => setAddExpenseOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-forest text-white text-lg font-light transition active:scale-95"
              >
                +
              </button>
              <button
                type="button"
                aria-label="Group menu"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-soft text-app-muted transition active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="h-4 w-4">
                  <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-card border border-app-border/50 bg-surface-base shadow-soft">
                  <Link
                    to={`/groups/${groupId}/analytics`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left text-sm font-medium text-app-text active:bg-surface-soft"
                  >
                    Analytics
                  </Link>
                  <Link
                    to={`/groups/${groupId}/budgets`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 w-full border-t border-app-border/30 px-4 py-3 text-left text-sm font-medium text-app-text active:bg-surface-soft"
                  >
                    Budgets
                  </Link>
                  <Link
                    to={`/groups/${groupId}/tags`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 w-full border-t border-app-border/30 px-4 py-3 text-left text-sm font-medium text-app-text active:bg-surface-soft"
                  >
                    Manage tags
                  </Link>
                  <Link
                    to={`/groups/${groupId}/categories`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 w-full border-t border-app-border/30 px-4 py-3 text-left text-sm font-medium text-app-text active:bg-surface-soft"
                  >
                    Categories
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      setExportingExpenses(true);
                      try {
                        await downloadCsv(`/groups/${groupId}/expenses/export.csv`, {
                          params: { sort: 'date', order: 'desc' },
                          filename: `group-${groupId}-expenses-${new Date().toISOString().slice(0, 10)}.csv`,
                        });
                      } finally {
                        setExportingExpenses(false);
                      }
                    }}
                    disabled={exportingExpenses}
                    className="flex items-center gap-3 w-full border-t border-app-border/30 px-4 py-3 text-left text-sm font-medium text-app-text active:bg-surface-soft disabled:opacity-50"
                  >
                    {exportingExpenses ? 'Downloading…' : 'Export CSV'}
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={openRename}
                        className="flex items-center gap-3 w-full border-t border-app-border/30 px-4 py-3 text-left text-sm font-medium text-app-text active:bg-surface-soft"
                      >
                        Edit group name
                      </button>
                      <button
                        type="button"
                        onClick={openDeleteGroup}
                        className="flex items-center gap-3 w-full border-t border-app-border/30 px-4 py-3 text-left text-sm font-medium text-accent-coral active:bg-surface-soft"
                      >
                        Delete group
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex rounded-pill bg-surface-soft p-1">
            {tabs.map((tab) => (
              <TabButton
                key={tab.key}
                active={activeTab === tab.key}
                onClick={() => setSearchParams(tab.key === 'expenses' ? {} : { tab: tab.key })}
              >
                {tab.label}
              </TabButton>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
        {toast && (
          <div className="fixed bottom-36 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card">
            {toast}
          </div>
        )}

        {error && (
          <div className="rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-app-muted shadow-card">
            {error}
          </div>
        )}

        {loading && !error && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-card bg-surface-soft" />
            ))}
          </div>
        )}

        {!loading && !error && activeTab === 'expenses' && (
          <div className="space-y-5">
            {/* Month summary */}
            <div className="flex items-center justify-between rounded-card bg-surface-inverted px-4 py-3.5 text-white shadow-card">
              <div>
                <p className="text-xs uppercase tracking-tag text-white/40">This month</p>
                <p className="mt-0.5 text-lg font-semibold">{formatAmount(thisMonth?.total ?? 0)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/40">
                  {thisMonth?.expenseCount ?? expenseMeta?.total ?? 0} expenses
                </p>
                <p className="mt-0.5 text-xs text-white/55">
                  <BalanceCopy net={balances?.net ?? 0} />
                </p>
              </div>
            </div>

            {expenses.length > 0 ? (
              <>
                <ExpenseList expenses={expenses} groupId={groupId} currentUserId={user?.id} />
                {currentPage < totalPages && (
                  <button
                    type="button"
                    onClick={() => loadExpenses(currentPage + 1, true)}
                    disabled={expensesLoading}
                    className="h-12 w-full rounded-card bg-surface-soft text-sm font-semibold text-app-text disabled:opacity-50"
                  >
                    {expensesLoading ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            ) : (
              <div className="rounded-panel border border-app-border/40 bg-surface-base px-5 py-12 text-center shadow-card">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-2xl">
                  💸
                </div>
                <p className="text-base font-semibold text-app-text">No expenses yet</p>
                <p className="mt-1 text-sm text-app-muted">Add the first shared expense for this group.</p>
                <button
                  type="button"
                  onClick={() => setAddExpenseOpen(true)}
                  className="mt-5 rounded-card bg-accent-forest px-5 py-3 text-sm font-semibold text-white"
                >
                  Add expense
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && !error && activeTab === 'balances' && (
          <div className="space-y-5">
            {/* Your balance overview */}
            <section className="rounded-panel bg-surface-inverted p-5 text-white shadow-soft">
              <p className="text-xs uppercase tracking-label text-white/40">Your balance</p>
              <p className="mt-3 text-xl font-semibold">
                <BalanceCopy net={balances?.net ?? 0} />
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-tile bg-white/[0.06] p-3">
                  <p className="text-xs uppercase tracking-tag text-white/35">Owed to you</p>
                  <p className="mt-1 font-semibold text-accent-lime">{formatAmount(balances?.youAreOwed ?? 0)}</p>
                </div>
                <div className="rounded-tile bg-white/[0.06] p-3">
                  <p className="text-xs uppercase tracking-tag text-white/35">You owe</p>
                  <p className="mt-1 font-semibold text-accent-coral">{formatAmount(balances?.youOwe ?? 0)}</p>
                </div>
              </div>
            </section>

            {/* Per-person balances */}
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">With each person</h2>
              <div className="space-y-2">
                {(balances?.detail ?? []).map((item) => {
                  const net = parseFloat(item.net);
                  const youOwe = net < 0;
                  return (
                    <div key={item.user.id} className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={item.user.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-app-text">{item.user.name}</p>
                            <p className={`mt-0.5 text-xs ${net < 0 ? 'text-accent-coral' : net > 0 ? 'text-accent-forest' : 'text-app-muted'}`}>
                              {net < 0 ? `You owe ${formatAmount(item.youOwe)}` : net > 0 ? `Owes you ${formatAmount(item.theyOwe)}` : 'Settled up'}
                            </p>
                          </div>
                        </div>
                        {net !== 0 && (
                          <button
                            type="button"
                            onClick={() => setSettleTarget({ user: item.user, amount: youOwe ? item.youOwe : item.theyOwe, youOwe })}
                            className={`shrink-0 rounded-pill px-3 py-2 text-xs font-semibold ${
                              youOwe
                                ? 'bg-accent-coral/10 text-accent-coral'
                                : 'bg-accent-forest/10 text-accent-forest'
                            }`}
                          >
                            {youOwe ? 'Settle up' : 'Record'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(balances?.detail ?? []).length === 0 && (
                  <div className="rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-app-muted shadow-card">
                    Everyone is settled.
                  </div>
                )}
              </div>
            </section>

            {/* Simplified plan */}
            {simplified.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Suggested payments</h2>
                <div className="space-y-2">
                  {simplified.map((item, index) => {
                    const fromMe = item.from.id === user?.id;
                    const toMe = item.to.id === user?.id;
                    return (
                      <div key={index} className="flex items-center gap-3 rounded-card border border-app-border/40 bg-surface-base px-4 py-3 shadow-card">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar name={item.from.name} size="xs" />
                          <span className={`text-sm font-medium truncate ${fromMe ? 'text-accent-coral' : 'text-app-text'}`}>
                            {fromMe ? 'You' : item.from.name.split(' ')[0]}
                          </span>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4 shrink-0 text-app-muted">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Avatar name={item.to.name} size="xs" />
                          <span className={`text-sm font-medium truncate ${toMe ? 'text-accent-forest' : 'text-app-text'}`}>
                            {toMe ? 'You' : item.to.name.split(' ')[0]}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-app-text">{formatAmount(item.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {!loading && !error && activeTab === 'members' && (
          <div className="space-y-4">
            {group?.members?.length <= 1 && (
              <div className="rounded-panel border border-accent-forest/20 bg-accent-forest/5 p-5">
                <p className="text-base font-semibold text-app-text">Add your flatmates to get started</p>
                <p className="mt-1 text-sm text-app-muted">Members need an account before they can be added by email.</p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-label text-app-muted">
                Members ({group?.members?.length ?? 0})
              </h2>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setAddMemberOpen(true)}
                  className="rounded-card bg-accent-forest px-4 py-2.5 text-sm font-semibold text-white"
                >
                  + Add member
                </button>
              )}
            </div>

            <div className="space-y-2">
              {group?.members?.map((member) => {
                const uid = member.userId ?? member.id;
                const isMe = uid === user?.id;
                return (
                  <div key={uid} className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                    <div className="flex items-start gap-3">
                      <Avatar name={member.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-app-text">
                            {member.name}{isMe ? ' (you)' : ''}
                          </p>
                          <span className="rounded-pill bg-surface-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tag text-app-muted">
                            {member.role}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-app-muted">{member.email}</p>
                        {isAdmin && !isMe && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleRoleChange(member, member.role === 'admin' ? 'member' : 'admin')}
                              className="rounded-pill bg-surface-soft px-3 py-1.5 text-xs font-semibold text-app-text"
                            >
                              {member.role === 'admin' ? 'Make member' : 'Make admin'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openRemoveMember(member)}
                              className="rounded-pill bg-accent-coral/10 px-3 py-1.5 text-xs font-semibold text-accent-coral"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <AddExpenseSheet
        open={addExpenseOpen}
        onClose={() => setAddExpenseOpen(false)}
        onSuccess={handleExpenseAdded}
        defaultGroupId={groupId}
      />
      <AddMemberSheet
        groupId={groupId}
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        onSuccess={handleMemberAdded}
        existingMemberIds={(group?.members ?? []).map((m) => m.userId ?? m.id)}
      />
      <SettleUpSheet
        groupId={groupId}
        open={!!settleTarget}
        onClose={() => setSettleTarget(null)}
        onSuccess={handleSettlementRecorded}
        targetUser={settleTarget?.user}
        defaultAmount={settleTarget?.amount ?? ''}
        youOwe={settleTarget?.youOwe ?? true}
      />
      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.confirmLabel}
        destructive={confirmConfig.destructive}
      />
      <BottomSheet open={renameOpen} onClose={() => setRenameOpen(false)} title="Edit group name">
        <form onSubmit={handleRenameSubmit} className="space-y-4 pt-2">
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Group name"
            required
            autoFocus
            className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60"
          />
          <button
            type="submit"
            disabled={renameLoading || !renameName.trim()}
            className="mt-2 h-14 w-full rounded-card bg-accent-forest text-sm font-semibold text-white transition disabled:opacity-50 active:opacity-85"
          >
            {renameLoading ? 'Saving…' : 'Save'}
          </button>
        </form>
      </BottomSheet>
    </div>
  );
}
