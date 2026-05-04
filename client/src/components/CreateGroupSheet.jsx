import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { createGroup } from '../services/groups';

export default function CreateGroupSheet({ open, onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('household');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function reset() {
    setName('');
    setType('household');
    setDescription('');
    setError(null);
    setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const group = await createGroup({ name: name.trim(), type, description: description.trim() || undefined });
      reset();
      onSuccess(group);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to create group');
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="New group">
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {error && (
          <div className="rounded-card bg-accent-coral/10 px-4 py-3 text-sm text-accent-coral">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-label text-app-muted">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Apartment, Trip to Goa"
            required
            className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-label text-app-muted">
            Type
          </label>
          <div className="flex gap-2">
            {['household', 'personal'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`h-12 flex-1 rounded-card text-sm font-semibold capitalize transition ${
                  type === t
                    ? 'bg-surface-inverted text-white'
                    : 'bg-surface-soft text-app-text'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-label text-app-muted">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this group for?"
            rows={3}
            className="w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 py-3 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-accent-forest/60 resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="mt-2 h-14 w-full rounded-card bg-accent-forest text-sm font-semibold text-white transition disabled:opacity-50 active:opacity-85"
        >
          {loading ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </BottomSheet>
  );
}
