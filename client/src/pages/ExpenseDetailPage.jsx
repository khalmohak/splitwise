import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AddExpenseSheet from '../components/AddExpenseSheet';
import ConfirmSheet from '../components/ConfirmSheet';
import { getGroup } from '../services/groups';
import { deleteExpense, getExpense } from '../services/expenses';
import { formatAmount, formatDate } from '../utils/format';

const splitTypeLabels = {
  equal: 'Split equally',
  exact: 'Exact amounts',
  percentage: 'By percentage',
  shares: 'By shares',
};

export default function ExpenseDetailPage() {
  const { groupId, expenseId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [expense, setExpense] = useState(null);
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState('');

  const loadExpense = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [expenseData, groupData] = await Promise.all([
        getExpense(groupId, expenseId),
        getGroup(groupId),
      ]);
      setExpense(expenseData);
      setGroup(groupData);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load expense');
    } finally {
      setLoading(false);
    }
  }, [expenseId, groupId]);

  useEffect(() => {
    loadExpense();
  }, [loadExpense]);

  const myMember = group?.members?.find((m) => (m.userId ?? m.id) === user?.id);
  const canManage = expense?.createdBy?.id === user?.id || myMember?.role === 'admin';

  async function handleEditSuccess() {
    setEditOpen(false);
    await loadExpense();
    window.dispatchEvent(new CustomEvent('splitwise:expenseChanged'));
    setToast('Expense updated');
    window.setTimeout(() => setToast(''), 2200);
  }

  async function handleDelete() {
    await deleteExpense(groupId, expenseId);
    window.dispatchEvent(new CustomEvent('splitwise:expenseChanged'));
    navigate(`/groups/${groupId}`, { replace: true });
  }

  return (
    <div className="mx-auto min-h-[calc(100svh-5rem)] max-w-2xl px-4 py-5 sm:px-6">
      {toast && (
        <div className="fixed bottom-36 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card">
          {toast}
        </div>
      )}

      <header className="flex items-center justify-between">
        <Link
          to={`/groups/${groupId}`}
          className="flex h-10 items-center gap-2 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {group?.name ?? 'Back'}
        </Link>
        {canManage && !loading && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="h-10 rounded-pill bg-surface-soft px-4 text-sm font-semibold text-app-text"
          >
            Edit
          </button>
        )}
      </header>

      {loading && (
        <div className="mt-5 space-y-3">
          <div className="h-48 animate-pulse rounded-panel bg-surface-soft" />
          <div className="h-40 animate-pulse rounded-card bg-surface-soft" />
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-app-muted shadow-card">
          {error}
        </div>
      )}

      {!loading && !error && expense && (
        <main className="mt-5 space-y-4">
          {/* Hero */}
          <section className="rounded-panel bg-surface-inverted p-6 text-center text-white shadow-soft">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-tile bg-white/[0.08] text-3xl">
              {expense.category?.icon ?? '📦'}
            </div>
            <h1 className="mt-4 text-xl font-semibold">{expense.description}</h1>
            <p className="mt-2 text-4xl font-semibold text-accent-lime">{formatAmount(expense.amount)}</p>
            <div className="mt-3 flex items-center justify-center gap-3 text-sm text-white/45">
              <span>{formatDate(expense.date)}</span>
              {expense.category && (
                <>
                  <span>·</span>
                  <span>{expense.category.name}</span>
                </>
              )}
            </div>
          </section>

          {/* Details */}
          <section className="divide-y divide-app-border/30 rounded-card border border-app-border/40 bg-surface-base px-4 shadow-card">
            <div className="flex items-center justify-between gap-4 py-3">
              <p className="text-sm text-app-muted">Paid by</p>
              <p className="text-sm font-medium text-app-text">
                {expense.paidBy?.id === user?.id ? 'You' : expense.paidBy?.name}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <p className="text-sm text-app-muted">Split</p>
              <p className="text-sm font-medium text-app-text capitalize">
                {splitTypeLabels[expense.splitType] ?? expense.splitType}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <p className="text-sm text-app-muted">Group</p>
              <p className="text-sm font-medium text-app-text">{group?.name}</p>
            </div>
          </section>

          {/* Who owes what */}
          <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-label text-app-muted">Who owes what</h2>
            <div className="mt-3 divide-y divide-app-border/30">
              {expense.participants?.map((participant) => {
                const isMe = participant.userId === user?.id;
                const isPayer = participant.userId === expense.paidBy?.id;
                return (
                  <div key={participant.userId} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                        isPayer ? 'bg-accent-lime/20 text-accent-forest' : 'bg-surface-soft text-app-muted'
                      }`}>
                        {(participant.name ?? '?').charAt(0).toUpperCase()}
                      </div>
                      <p className="min-w-0 truncate text-sm font-medium text-app-text">
                        {isMe ? 'You' : participant.name}
                      </p>
                      {isPayer && (
                        <span className="shrink-0 rounded-pill bg-accent-lime/15 px-2 py-0.5 text-[10px] font-semibold text-accent-forest">
                          paid
                        </span>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-app-text">
                      {formatAmount(participant.shareAmount)}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Tags & notes */}
          {(expense.tags?.length > 0 || expense.notes) && (
            <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
              {expense.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {expense.tags.map((tag) => (
                    <span key={tag.id} className="inline-flex items-center gap-1.5 rounded-pill border border-app-border/40 bg-surface-soft px-3 py-1 text-xs font-medium text-app-text">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color ?? '#06B6D4' }} />
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              {expense.notes && (
                <p className={`text-sm text-app-muted ${expense.tags?.length > 0 ? 'mt-3 border-t border-app-border/30 pt-3' : ''}`}>
                  {expense.notes}
                </p>
              )}
            </section>
          )}

          <p className="px-1 text-center text-xs text-app-muted">
            Added by {expense.createdBy?.id === user?.id ? 'you' : expense.createdBy?.name} · {new Date(expense.createdAt).toLocaleString('en-IN')}
          </p>

          {canManage && (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="h-14 w-full rounded-card border border-accent-coral/20 bg-accent-coral/[0.07] text-sm font-semibold text-accent-coral"
            >
              Delete expense
            </button>
          )}
        </main>
      )}

      <AddExpenseSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={handleEditSuccess}
        defaultGroupId={groupId}
        initialData={expense}
      />
      <ConfirmSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete expense?"
        message="This cannot be undone."
        confirmLabel="Delete expense"
        destructive
      />
    </div>
  );
}
