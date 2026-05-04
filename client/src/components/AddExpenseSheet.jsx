import { useState, useEffect, useCallback } from 'react';
import BottomSheet from './BottomSheet';
import { useAuth } from '../contexts/AuthContext';
import { getGroups, getGroup } from '../services/groups';
import { getCategories, getGroupCategories } from '../services/categories';
import { getGroupTags } from '../services/tags';
import { createExpense, updateExpense } from '../services/expenses';
import { formatAmount, toMoneyString } from '../utils/format';

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

const SPLIT_TYPES = [
  { key: 'equal', label: 'Equal' },
  { key: 'exact', label: 'Exact ₹' },
  { key: 'percentage', label: 'By %' },
  { key: 'shares', label: 'Shares' },
];

export default function AddExpenseSheet({
  open,
  onClose,
  onSuccess,
  defaultGroupId,
  initialData,
}) {
  const { user } = useAuth();
  const isEdit = !!initialData;

  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [members, setMembers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paidById, setPaidById] = useState(user?.id ?? '');
  const [categoryId, setCategoryId] = useState(null);
  const [selectedTagIds, setSelectedTagIds] = useState(new Set());
  const [selectedParticipants, setSelectedParticipants] = useState(new Set());
  const [splitType, setSplitType] = useState('equal');
  const [splitData, setSplitData] = useState({});
  const [date, setDate] = useState(todayString());
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = useCallback(() => {
    if (initialData) {
      setMembers([]);
      setAmount(String(initialData.amount ?? ''));
      setDescription(initialData.description ?? '');
      setPaidById(initialData.paidBy?.id ?? user?.id ?? '');
      setCategoryId(initialData.category?.id ?? initialData.categoryId ?? null);
      setSelectedTagIds(new Set((initialData.tags ?? []).map((tag) => tag.id)));
      const ids = (initialData.participants ?? []).map((p) => p.userId ?? p.id);
      setSelectedParticipants(new Set(ids));
      setSplitType(initialData.splitType ?? 'equal');
      const sd = {};
      (initialData.participants ?? []).forEach((p) => {
        const uid = p.userId ?? p.id;
        if (initialData.splitType === 'exact') sd[uid] = String(p.shareAmount ?? '');
        else if (initialData.splitType === 'percentage') sd[uid] = String(p.splitInput ?? p.sharePercentage ?? '');
        else if (initialData.splitType === 'shares') sd[uid] = String(p.splitInput ?? p.shares ?? '1');
      });
      setSplitData(sd);
      setDate(initialData.date?.slice(0, 10) ?? todayString());
      setNotes(initialData.notes ?? '');
      setShowNotes(!!(initialData.notes));
      setGroupId(defaultGroupId ?? '');
    } else {
      setMembers([]);
      setAmount('');
      setDescription('');
      setPaidById(user?.id ?? '');
      setCategoryId(null);
      setSelectedTagIds(new Set());
      setSelectedParticipants(new Set());
      setSplitType('equal');
      setSplitData({});
      setDate(todayString());
      setNotes('');
      setShowNotes(false);
      setGroupId(defaultGroupId ?? '');
    }
    setError(null);
    setLoading(false);
  }, [defaultGroupId, initialData, user]);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (!defaultGroupId) {
      getGroups().then((gs) => {
        setGroups(gs);
        if (gs.length === 1) setGroupId(gs[0].id);
      }).catch(() => {});
    }
  }, [open, defaultGroupId, resetForm]);

  useEffect(() => {
    if (!open) return;
    if (!groupId) {
      getCategories().then(setCategories).catch(() => {});
      setTags([]);
      return;
    }
    getGroupCategories(groupId).then(setCategories).catch(() => {
      getCategories().then(setCategories).catch(() => {});
    });
    getGroupTags(groupId).then(setTags).catch(() => setTags([]));
    getGroup(groupId).then((g) => {
      const mbs = g.members ?? [];
      setMembers(mbs);
      if (!initialData) {
        setSelectedParticipants(new Set(mbs.map((m) => m.userId ?? m.id)));
        setPaidById(user?.id ?? '');
      }
    }).catch(() => {});
  }, [groupId, initialData, open, user]);

  function handleClose() {
    resetForm();
    onClose();
  }

  function toggleParticipant(uid) {
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function setSplitValue(uid, val) {
    setSplitData((prev) => ({ ...prev, [uid]: val }));
  }

  function toggleTag(tagId) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const amountNum = parseFloat(amount) || 0;
  const participantList = members.filter((m) => selectedParticipants.has(m.userId ?? m.id));
  const count = participantList.length;
  const equalShare = count > 0 ? amountNum / count : 0;

  const sortedMembers = [...members].sort((a, b) => {
    const aId = a.userId ?? a.id;
    const bId = b.userId ?? b.id;
    if (aId === user?.id) return -1;
    if (bId === user?.id) return 1;
    return 0;
  });

  function getSplitValidation() {
    if (splitType === 'equal') return { valid: count > 0, msg: count > 0 ? `${formatAmount(equalShare)} each` : '' };
    if (splitType === 'exact') {
      const sum = participantList.reduce((acc, m) => acc + (parseFloat(splitData[m.userId ?? m.id]) || 0), 0);
      const diff = amountNum - sum;
      const valid = Math.abs(diff) < 0.01;
      return { valid, msg: valid ? `✓ ${formatAmount(amountNum)} fully assigned` : `${formatAmount(Math.abs(diff))} ${diff > 0 ? 'remaining' : 'over'}` };
    }
    if (splitType === 'percentage') {
      const sum = participantList.reduce((acc, m) => acc + (parseFloat(splitData[m.userId ?? m.id]) || 0), 0);
      const diff = 100 - sum;
      const valid = Math.abs(diff) < 0.01;
      return { valid, msg: valid ? '✓ 100% assigned' : `${Math.abs(diff).toFixed(1)}% ${diff > 0 ? 'remaining' : 'over'}` };
    }
    if (splitType === 'shares') {
      const totalShares = participantList.reduce((acc, m) => acc + (parseFloat(splitData[m.userId ?? m.id]) || 0), 0);
      const perShare = totalShares > 0 ? amountNum / totalShares : 0;
      return { valid: totalShares > 0, msg: `${formatAmount(perShare)}/share` };
    }
    return { valid: false, msg: '' };
  }

  const splitValidation = getSplitValidation();

  const canSubmit =
    amountNum > 0 &&
    description.trim().length > 0 &&
    count > 0 &&
    splitValidation.valid &&
    !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    try {
      const participants = participantList.map((m) => {
        const uid = m.userId ?? m.id;
        const base = { userId: uid };
        if (splitType === 'exact') return { ...base, shareAmount: toMoneyString(splitData[uid]) };
        if (splitType === 'percentage') return { ...base, splitInput: String(parseFloat(splitData[uid]) || 0) };
        if (splitType === 'shares') return { ...base, splitInput: String(parseFloat(splitData[uid]) || 1) };
        return base;
      });

      const body = {
        description: description.trim(),
        amount: toMoneyString(amountNum),
        paidById,
        categoryId: categoryId || undefined,
        splitType,
        participants,
        tagIds: Array.from(selectedTagIds),
        date,
        notes: notes.trim() || undefined,
      };

      let expense;
      if (isEdit) {
        expense = await updateExpense(groupId || defaultGroupId, initialData.id, body);
      } else {
        expense = await createExpense(groupId || defaultGroupId, body);
      }
      resetForm();
      onSuccess(expense);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save expense');
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title={isEdit ? 'Edit expense' : 'Add expense'}>
      <form onSubmit={handleSubmit} className="space-y-5 pt-1 pb-2">
        {error && (
          <div className="rounded-card bg-accent-coral/10 px-4 py-3 text-sm text-accent-coral">
            {error}
          </div>
        )}

        {/* Group selector — only when multiple groups and no default */}
        {!defaultGroupId && groups.length > 1 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-label text-app-muted">Group</p>
            {groups.length <= 6 ? (
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupId(g.id)}
                    className={`rounded-pill border px-3 py-2 text-sm font-medium transition ${
                      groupId === g.id
                        ? 'border-accent-forest/40 bg-accent-forest/10 text-accent-forest'
                        : 'border-app-border/50 bg-surface-soft text-app-text'
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            ) : (
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                required
                className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none focus:border-accent-forest/50"
              >
                <option value="">Select group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Amount + description */}
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className="text-3xl font-semibold text-app-muted">₹</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus={open && !isEdit}
              className="w-52 border-b-2 border-app-border/60 bg-transparent text-center text-5xl font-semibold text-app-text outline-none focus:border-accent-forest/50 placeholder:text-app-muted/40"
            />
          </div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this for?"
            required
            className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-base text-app-text outline-none focus:border-accent-forest/50 placeholder:text-app-muted text-center"
          />
        </div>

        {/* Paid by */}
        {members.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-label text-app-muted">Paid by</p>
            <div className="flex flex-wrap gap-2">
              {sortedMembers.map((m) => {
                const uid = m.userId ?? m.id;
                const name = m.name ?? m.user?.name ?? '';
                const isYou = uid === user?.id;
                const isSelected = paidById === uid;
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => setPaidById(uid)}
                    className={`flex shrink-0 items-center gap-2 rounded-pill border px-3 py-2 text-sm font-medium transition ${
                      isSelected
                        ? 'border-surface-inverted bg-surface-inverted text-white'
                        : 'border-app-border/50 bg-surface-soft text-app-text'
                    }`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-accent-lime/20 text-accent-forest'
                    }`}>
                      {name.charAt(0).toUpperCase()}
                    </span>
                    {isYou ? 'You' : name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Category */}
        {categories.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-label text-app-muted">Category</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const isSelected = categoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(isSelected ? null : c.id)}
                    className={`flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm transition ${
                      isSelected
                        ? 'border-accent-forest/40 bg-accent-forest/10 text-accent-forest font-medium'
                        : 'border-app-border/40 bg-surface-soft/60 text-app-text'
                    }`}
                  >
                    <span>{c.icon ?? '📦'}</span>
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Split */}
        {members.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-label text-app-muted">Split</p>

            {/* Split type segmented control */}
            <div className="flex rounded-xl bg-surface-soft p-1 gap-0.5">
              {SPLIT_TYPES.map((st) => (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => setSplitType(st.key)}
                  className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                    splitType === st.key
                      ? 'bg-surface-base text-app-text shadow-card'
                      : 'text-app-muted'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Participants */}
            <div className="flex flex-wrap gap-2">
              {sortedMembers.map((m) => {
                const uid = m.userId ?? m.id;
                const name = m.name ?? m.user?.name ?? '';
                const isYou = uid === user?.id;
                const isSelected = selectedParticipants.has(uid);
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => toggleParticipant(uid)}
                    className={`flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm font-medium transition ${
                      isSelected
                        ? 'border-accent-forest/30 bg-accent-forest/15 text-accent-forest'
                        : 'border-app-border/40 bg-surface-soft/60 text-app-muted'
                    }`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      isSelected ? 'bg-accent-forest/20 text-accent-forest' : 'bg-surface-soft text-app-muted'
                    }`}>
                      {name.charAt(0).toUpperCase()}
                    </span>
                    {isYou ? 'You' : name.split(' ')[0]}
                  </button>
                );
              })}
            </div>

            {splitType === 'equal' && count > 0 && amountNum > 0 && (
              <p className="text-sm font-medium text-accent-forest">{formatAmount(equalShare)} each</p>
            )}

            {splitType !== 'equal' && participantList.length > 0 && (
              <div className="space-y-2 rounded-card border border-app-border/40 bg-surface-soft/30 p-3">
                {participantList.map((m) => {
                  const uid = m.userId ?? m.id;
                  const name = m.name ?? m.user?.name ?? '';
                  const isYou = uid === user?.id;
                  const val = splitData[uid] ?? '';
                  const totalShares = participantList.reduce((a, x) => a + (parseFloat(splitData[x.userId ?? x.id]) || 0), 0);
                  const myShares = parseFloat(val) || 0;
                  const shareAmt = totalShares > 0 ? (amountNum * myShares / totalShares) : 0;
                  return (
                    <div key={uid} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-sm font-medium text-app-text truncate">
                        {isYou ? 'You' : name.split(' ')[0]}
                      </span>
                      <div className="flex flex-1 items-center gap-1.5">
                        {splitType === 'exact' && <span className="shrink-0 text-sm text-app-muted">₹</span>}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={val}
                          onChange={(e) => setSplitValue(uid, e.target.value)}
                          placeholder="0"
                          className="h-10 flex-1 rounded-tile border border-app-border/60 bg-surface-base px-3 text-right text-sm text-app-text outline-none focus:border-accent-forest/50"
                        />
                        {splitType === 'percentage' && <span className="shrink-0 text-sm text-app-muted">%</span>}
                        {splitType === 'shares' && (
                          <span className="shrink-0 text-xs text-app-muted w-14 text-right">{formatAmount(shareAmt)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <p className={`text-sm font-medium ${splitValidation.valid ? 'text-status-success' : 'text-accent-coral'}`}>
                  {splitValidation.msg}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-label text-app-muted">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const isSelected = selectedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`flex items-center gap-2 rounded-pill border px-3 py-1.5 text-sm transition ${
                      isSelected
                        ? 'border-accent-forest/30 bg-accent-forest/15 text-accent-forest font-medium'
                        : 'border-app-border/40 bg-surface-soft/60 text-app-text'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color ?? '#06B6D4' }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Date */}
        <div className="flex items-center gap-3 rounded-card border border-app-border/40 bg-surface-soft/40 px-4 py-3">
          <span className="shrink-0 text-sm text-app-muted">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 bg-transparent text-sm text-app-text outline-none text-right"
          />
        </div>

        {/* Notes */}
        {showNotes ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional details…"
            rows={3}
            className="w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 py-3 text-sm text-app-text outline-none focus:border-accent-forest/50 placeholder:text-app-muted resize-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNotes(true)}
            className="text-sm text-app-muted transition hover:text-app-text"
          >
            + Add notes
          </button>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="h-14 w-full rounded-card bg-accent-forest text-base font-semibold text-white transition disabled:opacity-50 active:opacity-90"
        >
          {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}
        </button>
      </form>
    </BottomSheet>
  );
}
