import { useState, useEffect } from 'react';
import BottomSheet from './BottomSheet';
import { useAuth } from '../contexts/AuthContext';
import { createSettlement } from '../services/settlements';
import { toMoneyString } from '../utils/format';

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function SettleUpSheet({
  groupId,
  open,
  onClose,
  onSuccess,
  targetUser,
  defaultAmount = '',
  youOwe = true,
}) {
  const { user } = useAuth();
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(todayString());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount);
      setDate(todayString());
      setNotes('');
      setError(null);
    }
  }, [open, defaultAmount]);

  function handleClose() {
    setError(null);
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const body = {
        paidById: youOwe ? user.id : targetUser.id,
        paidToId: youOwe ? targetUser.id : user.id,
        amount: toMoneyString(amount),
        date,
        notes: notes.trim() || undefined,
      };
      await createSettlement(groupId, body);
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  }

  const fromName = youOwe ? 'You' : (targetUser?.name ?? '');
  const toName = youOwe ? (targetUser?.name ?? '') : 'You';

  return (
    <BottomSheet open={open} onClose={handleClose} title="Settle up">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        {error && (
          <div className="rounded-card bg-accent-coral/10 px-4 py-3 text-sm text-accent-coral">
            {error}
          </div>
        )}

        <div className="flex items-center justify-center gap-2 py-1">
          <span className="text-sm font-medium text-app-text">{fromName}</span>
          <span className="text-app-muted">→</span>
          <span className="text-sm font-medium text-app-text">{toName}</span>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl font-semibold text-app-muted">₹</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-48 border-b-2 border-app-border/60 bg-transparent text-center text-4xl font-semibold text-app-text outline-none focus:border-accent-forest/50 placeholder:text-app-muted/40"
          />
        </div>

        <div className="flex items-center gap-3 rounded-card border border-app-border/40 bg-surface-soft/40 px-4 py-3">
          <span className="shrink-0 text-sm text-app-muted">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 bg-transparent text-sm text-app-text outline-none text-right"
          />
        </div>

        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add a note (UPI, cash, etc.)"
          className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none focus:border-accent-forest/50 placeholder:text-app-muted"
        />

        <button
          type="submit"
          disabled={loading || !amount || parseFloat(amount) <= 0}
          className="h-14 w-full rounded-card bg-accent-forest text-base font-semibold text-white transition disabled:opacity-50"
        >
          {loading ? 'Recording…' : 'Record payment'}
        </button>
      </form>
    </BottomSheet>
  );
}
