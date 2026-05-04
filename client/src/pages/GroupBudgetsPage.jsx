import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BottomSheet from '../components/BottomSheet';
import ConfirmSheet from '../components/ConfirmSheet';
import { getGroup } from '../services/groups';
import { getGroupCategories } from '../services/categories';
import { getBudgets, upsertBudget, deleteBudget } from '../services/budgets';
import { formatAmount } from '../utils/format';

function currentMonthString() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonth(ym) {
  if (!ym) return '';
  const [year, month] = ym.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function BudgetProgressBar({ usedPct, status }) {
  const pct = Math.min(100, Math.max(0, Number.parseFloat(usedPct ?? 0)));
  const color = status === 'over' ? '#f87171' : status === 'warning' ? '#fbbf24' : '#0f6d56';
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-pill bg-surface-soft">
      <div className="h-full rounded-pill transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    ok: { label: 'On track', cls: 'bg-accent-forest/10 text-accent-forest' },
    warning: { label: 'Near limit', cls: 'bg-amber-400/15 text-amber-600 dark:text-amber-400' },
    over: { label: 'Over budget', cls: 'bg-accent-coral/10 text-accent-coral' },
  }[status] ?? { label: status, cls: 'bg-surface-soft text-app-muted' };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}`}>{cfg.label}</span>
  );
}

function BudgetCard({ budget, isAdmin, onEdit, onDelete }) {
  const spent = Number.parseFloat(budget.spent ?? 0);
  const amount = Number.parseFloat(budget.amount ?? 0);
  const remaining = Number.parseFloat(budget.remaining ?? 0);
  const usedPct = Number.parseFloat(budget.usedPct ?? 0);

  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {budget.category ? (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile text-lg"
              style={{ backgroundColor: `${budget.category.color ?? '#9CA3AF'}22` }}
            >
              {budget.category.icon ?? '📦'}
            </div>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile bg-surface-soft text-lg">
              🏦
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-app-text">
              {budget.category?.name ?? 'Overall group budget'}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <StatusBadge status={budget.status} />
            </div>
          </div>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-pill bg-surface-soft px-2.5 py-1.5 text-[10px] font-semibold text-app-text active:opacity-70"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-pill bg-accent-coral/10 px-2.5 py-1.5 text-[10px] font-semibold text-accent-coral active:opacity-70"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <BudgetProgressBar usedPct={usedPct} status={budget.status} />

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-app-muted">
          <span className={budget.status === 'over' ? 'font-semibold text-accent-coral' : 'font-semibold text-app-text'}>
            {formatAmount(spent)}
          </span>
          {' '}of {formatAmount(amount)}
        </p>
        <p className={`text-xs font-semibold ${budget.status === 'over' ? 'text-accent-coral' : 'text-app-muted'}`}>
          {budget.status === 'over'
            ? `${formatAmount(Math.abs(remaining))} over`
            : `${formatAmount(remaining)} left`}
        </p>
      </div>
    </div>
  );
}

export default function GroupBudgetsPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthString());
  const [group, setGroup] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Form state
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const isAdmin = group?.members?.find((m) => (m.userId ?? m.id) === user?.id)?.role === 'admin';

  function showToast(msg) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [groupData, budgetData, catData] = await Promise.all([
        getGroup(groupId),
        getBudgets(groupId, { month }).catch(() => ({ data: [] })),
        getGroupCategories(groupId).catch(() => []),
      ]);
      setGroup(groupData);
      setBudgets(budgetData?.data ?? []);
      setCategories(Array.isArray(catData) ? catData : []);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load budgets');
    } finally {
      setLoading(false);
    }
  }, [groupId, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openAdd() {
    setEditingBudget(null);
    setFormCategoryId('');
    setFormAmount('');
    setFormError('');
    setSheetOpen(true);
  }

  function openEdit(budget) {
    setEditingBudget(budget);
    setFormCategoryId(budget.category?.id ?? '');
    setFormAmount(budget.amount ?? '');
    setFormError('');
    setSheetOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!formAmount || Number.parseFloat(formAmount) <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    setFormSaving(true);
    setFormError('');
    try {
      await upsertBudget(groupId, {
        month,
        categoryId: formCategoryId || null,
        amount: Number.parseFloat(formAmount).toFixed(2),
      });
      setSheetOpen(false);
      await loadData();
      showToast(editingBudget ? 'Budget updated' : 'Budget set');
    } catch (err) {
      setFormError(err.response?.data?.error ?? 'Could not save budget');
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(budget) {
    try {
      await deleteBudget(groupId, budget.id);
      await loadData();
      showToast('Budget deleted');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete budget');
    }
  }

  const existingCategoryIds = new Set(budgets.map((b) => b.category?.id ?? '__overall__'));
  const availableCategories = categories.filter((c) => {
    if (editingBudget) return true;
    return !existingCategoryIds.has(c.id);
  });
  const overallExists = existingCategoryIds.has('__overall__');

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 pb-8 sm:px-6">
      {toast && (
        <div className="fixed bottom-36 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card">
          {toast}
        </div>
      )}

      <header className="mb-5 flex items-center justify-between gap-3">
        <Link
          to={`/groups/${groupId}`}
          className="flex h-10 items-center gap-2 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text transition active:opacity-70"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {group?.name ?? 'Group'}
        </Link>
        {isAdmin && (
          <button
            type="button"
            onClick={openAdd}
            className="rounded-card bg-accent-forest px-4 py-2.5 text-sm font-semibold text-white transition active:opacity-85"
          >
            + Add budget
          </button>
        )}
      </header>

      <h1 className="mb-4 text-xl font-semibold text-app-text">Budgets</h1>

      {/* Month navigator */}
      <div className="mb-5 flex items-center justify-between rounded-card border border-app-border/40 bg-surface-base px-4 py-3 shadow-card">
        <button
          type="button"
          onClick={() => setMonth(prevMonth(month))}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-soft text-app-muted transition active:opacity-70"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-app-text">{formatMonth(month)}</p>
        <button
          type="button"
          onClick={() => setMonth(nextMonth(month))}
          disabled={month >= currentMonthString()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-soft text-app-muted transition active:opacity-70 disabled:opacity-30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-accent-coral shadow-card">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-card bg-surface-soft" />)}
        </div>
      ) : budgets.length === 0 ? (
        <div className="rounded-panel border border-app-border/40 bg-surface-base px-5 py-12 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-2xl">🏦</div>
          <p className="text-base font-semibold text-app-text">No budgets for {formatMonth(month)}</p>
          <p className="mt-1 text-sm text-app-muted">
            {isAdmin ? 'Set a spending limit for the group or specific categories.' : 'No budgets set for this month.'}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={openAdd}
              className="mt-5 rounded-card bg-accent-forest px-5 py-3 text-sm font-semibold text-white"
            >
              Set budget
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((budget) => (
            <BudgetCard
              key={budget.id}
              budget={budget}
              isAdmin={isAdmin}
              onEdit={() => openEdit(budget)}
              onDelete={() => setDeleteTarget(budget)}
            />
          ))}
        </div>
      )}

      {/* Add / Edit sheet */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editingBudget ? 'Edit budget' : 'Add budget'}
      >
        <form onSubmit={handleSave} className="space-y-4 pt-2">
          {formError && (
            <div className="rounded-card bg-accent-coral/10 px-4 py-3 text-sm text-accent-coral">
              {formError}
            </div>
          )}

          <div className="rounded-card border border-app-border/40 bg-surface-base px-4 py-3 text-sm text-app-muted shadow-card">
            Month: <span className="font-semibold text-app-text">{formatMonth(month)}</span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-label text-app-muted">Category</label>
            <select
              value={formCategoryId}
              onChange={(e) => setFormCategoryId(e.target.value)}
              disabled={!!editingBudget}
              className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none focus:border-accent-forest/60 disabled:opacity-60"
            >
              <option value="">{overallExists && !editingBudget ? 'Overall budget already set' : 'Overall group budget'}</option>
              {availableCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
              ))}
            </select>
            {!formCategoryId && <p className="text-[10px] text-app-muted">Leave empty for a total group budget.</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-label text-app-muted">Monthly limit (₹)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              placeholder="e.g. 8000"
              required
              className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60"
            />
          </div>

          <button
            type="submit"
            disabled={formSaving || !formAmount}
            className="mt-2 h-14 w-full rounded-card bg-accent-forest text-sm font-semibold text-white transition disabled:opacity-50 active:opacity-85"
          >
            {formSaving ? 'Saving…' : editingBudget ? 'Save changes' : 'Set budget'}
          </button>
        </form>
      </BottomSheet>

      <ConfirmSheet
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title="Delete budget?"
        message="The budget limit will be removed. Expenses are not affected."
        confirmLabel="Delete budget"
        destructive
      />
    </div>
  );
}
