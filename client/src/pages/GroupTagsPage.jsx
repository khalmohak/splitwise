import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmSheet from '../components/ConfirmSheet';
import { getGroup } from '../services/groups';
import { createGroupTag, deleteGroupTag, getGroupTags, updateGroupTag } from '../services/tags';

const colorOptions = ['#06B6D4', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#84CC16', '#6366F1', '#9CA3AF'];

function ChevronLeft() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function TagForm({ initial, submitLabel, onSubmit, onCancel, loading }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? '#06B6D4');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), color });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <label className="space-y-1.5">
        <span className="text-[10px] font-medium uppercase tracking-label text-app-muted">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Goa trip"
          className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60"
        />
      </label>

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

function TagRow({ tag, isAdmin, onEdit, onDelete }) {
  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="h-4 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color ?? '#06B6D4' }}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-app-text">{tag.name}</p>
            <p className="mt-0.5 text-xs text-app-muted">
              {tag.expenseCount} {tag.expenseCount === 1 ? 'expense' : 'expenses'}
            </p>
          </div>
        </div>
        {isAdmin && (
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

export default function GroupTagsPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [tags, setTags] = useState([]);
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
      const [groupData, tagData] = await Promise.all([
        getGroup(groupId),
        getGroupTags(groupId),
      ]);
      setGroup(groupData);
      setTags(tagData);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load tags');
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
      await createGroupTag(groupId, body);
      await loadData();
      showToast('Tag created');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create tag');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(body) {
    setSaving(true);
    setError('');
    try {
      await updateGroupTag(groupId, editing.id, body);
      setEditing(null);
      await loadData();
      showToast('Tag updated');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not update tag');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tag) {
    setError('');
    try {
      await deleteGroupTag(groupId, tag.id);
      await loadData();
      showToast('Tag deleted');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete tag');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 pb-8 sm:px-6">
      {toast && (
        <div className="fixed bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card">
          {toast}
        </div>
      )}

      <header className="mb-6">
        <Link
          to={`/groups/${groupId}`}
          className="flex h-10 w-fit items-center gap-2 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text transition active:opacity-70"
        >
          <ChevronLeft />
          {group?.name ?? 'Group'}
        </Link>
      </header>

      <h1 className="mb-5 text-xl font-semibold text-app-text">Tags</h1>

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
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">
              {editing ? 'Edit tag' : 'New tag'}
            </h2>
            <TagForm
              key={editing?.id ?? 'new'}
              initial={editing}
              submitLabel={editing ? 'Save changes' : 'Create tag'}
              onSubmit={editing ? handleUpdate : handleCreate}
              onCancel={editing ? () => setEditing(null) : undefined}
              loading={saving}
            />
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-label text-app-muted">
              Tags ({tags.length})
            </h2>
            {tags.length > 0 ? (
              <div className="space-y-2">
                {tags.map((tag) => (
                  <TagRow
                    key={tag.id}
                    tag={tag}
                    isAdmin={isAdmin}
                    onEdit={() => setEditing(tag)}
                    onDelete={() => setDeleteTarget(tag)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-app-border/40 bg-surface-base px-4 py-8 text-center shadow-card">
                <p className="text-sm text-app-muted">No tags yet. Create one above.</p>
              </div>
            )}
          </section>
        </main>
      )}
      <ConfirmSheet
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This tag will be removed from all expenses."
        confirmLabel="Delete tag"
        destructive
      />
    </div>
  );
}
