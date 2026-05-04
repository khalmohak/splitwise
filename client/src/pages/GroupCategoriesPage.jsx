import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmSheet from '../components/ConfirmSheet';
import { getGroup } from '../services/groups';
import {
  createGroupCategory,
  deleteGroupCategory,
  getGroupCategories,
  updateGroupCategory,
} from '../services/categories';

const colorOptions = ['#EF4444', '#10B981', '#F59E0B', '#3B82F6', '#F97316', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#6366F1', '#9CA3AF'];

function ChevronLeft() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function CategoryForm({ initial, submitLabel, onSubmit, onCancel, loading }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '📦');
  const [color, setColor] = useState(initial?.color ?? '#10B981');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), icon: icon.trim() || '📦', color });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
        <label className="space-y-1.5">
          <span className="text-[10px] font-medium uppercase tracking-label text-app-muted">Icon</span>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-3 text-center text-xl outline-none focus:border-accent-forest/60"
            maxLength={4}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-[10px] font-medium uppercase tracking-label text-app-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Beer fund"
            className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {colorOptions.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setColor(option)}
            aria-label={option}
            className={`h-8 w-8 rounded-full border-2 transition ${color === option ? 'border-app-text scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: option }}
          />
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-card bg-surface-soft text-sm font-semibold text-app-text transition active:opacity-70"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="h-12 flex-1 rounded-card bg-accent-forest text-sm font-semibold text-white transition disabled:opacity-50 active:opacity-85"
        >
          {loading ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function CategoryRow({ category, isAdmin, onEdit, onDelete }) {
  const isSystem = !category.groupId;

  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile text-lg"
            style={{ backgroundColor: `${category.color ?? '#9CA3AF'}22` }}
          >
            {category.icon ?? '📦'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-app-text">{category.name}</p>
            <p className="mt-0.5 text-xs text-app-muted">{isSystem ? 'System' : 'Custom'}</p>
          </div>
        </div>
        {isAdmin && !isSystem && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-pill bg-surface-soft px-3 py-2 text-xs font-semibold text-app-text transition active:opacity-70"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-pill bg-accent-coral/10 px-3 py-2 text-xs font-semibold text-accent-coral transition active:opacity-70"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GroupCategoriesPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const isAdmin = group?.members?.find((m) => (m.userId ?? m.id) === user?.id)?.role === 'admin';

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [groupData, categoryData] = await Promise.all([
        getGroup(groupId),
        getGroupCategories(groupId),
      ]);
      setGroup(groupData);
      setCategories(categoryData);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load categories');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }

  async function handleCreate(body) {
    setSaving(true);
    setError('');
    try {
      await createGroupCategory(groupId, body);
      await loadData();
      showToast('Category created');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create category');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(body) {
    setSaving(true);
    setError('');
    try {
      await updateGroupCategory(groupId, editing.id, body);
      setEditing(null);
      await loadData();
      showToast('Category updated');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not update category');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(category) {
    setError('');
    try {
      await deleteGroupCategory(groupId, category.id);
      await loadData();
      showToast('Category deleted');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete category');
    }
  }

  const grouped = useMemo(() => ({
    custom: categories.filter((c) => c.groupId),
    system: categories.filter((c) => !c.groupId),
  }), [categories]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 pb-8 sm:px-6">
      {toast && (
        <div className="fixed bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card">
          {toast}
        </div>
      )}

      <header className="mb-6 flex items-center justify-between gap-3">
        <Link
          to={`/groups/${groupId}`}
          className="flex h-10 items-center gap-2 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text transition active:opacity-70"
        >
          <ChevronLeft />
          {group?.name ?? 'Group'}
        </Link>
      </header>

      <h1 className="mb-5 text-xl font-semibold text-app-text">Categories</h1>

      {error && (
        <div className="mb-5 rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-accent-coral shadow-card">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-card bg-surface-soft" />)}
        </div>
      ) : (
        <main className="space-y-6">
          {isAdmin && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">
                {editing ? 'Edit category' : 'New category'}
              </h2>
              <CategoryForm
                key={editing?.id ?? 'new'}
                initial={editing}
                submitLabel={editing ? 'Save changes' : 'Create category'}
                onSubmit={editing ? handleUpdate : handleCreate}
                onCancel={editing ? () => setEditing(null) : undefined}
                loading={saving}
              />
            </section>
          )}

          {grouped.custom.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">Custom</h2>
              <div className="space-y-2">
                {grouped.custom.map((category) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    isAdmin={isAdmin}
                    onEdit={() => setEditing(category)}
                    onDelete={() => setDeleteTarget(category)}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">System defaults</h2>
            <div className="space-y-2">
              {grouped.system.map((category) => (
                <CategoryRow key={category.id} category={category} isAdmin={isAdmin} />
              ))}
            </div>
          </section>
        </main>
      )}
      <ConfirmSheet
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This category will be removed from all expenses."
        confirmLabel="Delete category"
        destructive
      />
    </div>
  );
}
