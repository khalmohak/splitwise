import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getGroup } from '../services/groups';
import {
  getGroupAnalyticsAnomalies,
  getGroupAnalyticsCategories,
  getGroupAnalyticsCategoryTrends,
  getGroupAnalyticsComparison,
  getGroupAnalyticsMembers,
  getGroupAnalyticsMemberTrends,
  getGroupAnalyticsPatterns,
  getGroupAnalyticsSummary,
  getGroupAnalyticsTags,
  getGroupAnalyticsTrends,
} from '../services/analytics';
import { formatAmount } from '../utils/format';
import { downloadCsv } from '../utils/downloadCsv';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trends', label: 'Trends' },
  { key: 'patterns', label: 'Patterns' },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartString() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function parseAmount(v) {
  const n = Number.parseFloat(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pct(value, max) {
  if (!max) return '0%';
  return `${Math.max(4, Math.min(100, (value / max) * 100))}%`;
}

function ChevronLeft() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function TrendArrow({ direction, pctChange }) {
  if (!direction || direction === 'stable') {
    return <span className="text-app-muted">→ stable</span>;
  }
  const up = direction === 'up';
  return (
    <span className={up ? 'text-accent-coral' : 'text-accent-forest'}>
      {up ? '↑' : '↓'} {pctChange ? `${Math.abs(Number.parseFloat(pctChange)).toFixed(1)}%` : ''}
    </span>
  );
}

/* ── OVERVIEW components ── */

function StatTile({ label, value, tone = 'neutral', sub }) {
  const toneClass = { neutral: 'text-app-text', good: 'text-accent-forest', danger: 'text-accent-coral' }[tone];
  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <p className="text-[10px] font-medium uppercase tracking-label text-app-muted">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-app-muted">{sub}</p>}
    </div>
  );
}

function ComparisonCard({ comparison }) {
  if (!comparison) return null;
  const { current, previous, changeAmount, changePct, direction } = comparison;
  const up = direction === 'up';
  const changeVal = parseAmount(changeAmount);

  return (
    <div className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-label text-app-muted">Period comparison</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-tile bg-surface-soft/50 p-3">
          <p className="text-[10px] uppercase tracking-label text-app-muted">Current</p>
          <p className="mt-1 text-base font-semibold text-app-text">{formatAmount(current?.totalSpend ?? 0)}</p>
          <p className="mt-0.5 text-xs text-app-muted">{current?.expenseCount ?? 0} expenses</p>
          <p className="mt-0.5 text-[10px] text-app-muted">{current?.period?.from} – {current?.period?.to}</p>
        </div>
        <div className="rounded-tile bg-surface-soft/50 p-3">
          <p className="text-[10px] uppercase tracking-label text-app-muted">Previous</p>
          <p className="mt-1 text-base font-semibold text-app-text">{formatAmount(previous?.totalSpend ?? 0)}</p>
          <p className="mt-0.5 text-xs text-app-muted">{previous?.expenseCount ?? 0} expenses</p>
          <p className="mt-0.5 text-[10px] text-app-muted">{previous?.period?.from} – {previous?.period?.to}</p>
        </div>
      </div>
      {changeVal !== 0 && (
        <div className={`mt-3 rounded-tile px-3 py-2 ${up ? 'bg-accent-coral/8' : 'bg-accent-forest/8'}`}>
          <p className={`text-sm font-semibold ${up ? 'text-accent-coral' : 'text-accent-forest'}`}>
            {up ? '↑' : '↓'} {formatAmount(changeVal)} ({changePct ? `${Math.abs(Number.parseFloat(changePct)).toFixed(1)}%` : '—'}) vs previous period
          </p>
        </div>
      )}
    </div>
  );
}

function AnomalyCard({ anomalies }) {
  const unusual = anomalies?.unusualExpenses ?? [];
  const spikes = anomalies?.categorySpikes ?? [];
  if (unusual.length === 0 && spikes.length === 0) return null;

  return (
    <div className="rounded-card border border-amber-400/30 bg-amber-400/[0.06] p-4 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">⚠</span>
        <p className="text-sm font-semibold text-app-text">
          {unusual.length + spikes.length} anomaly{unusual.length + spikes.length !== 1 ? 's' : ''} detected
        </p>
      </div>
      <div className="space-y-2">
        {unusual.map((item) => (
          <div key={item.id} className="rounded-tile bg-surface-base/60 px-3 py-2">
            <p className="text-sm font-medium text-app-text truncate">{item.description}</p>
            <p className="mt-0.5 text-xs text-app-muted">
              {formatAmount(item.amount)} · {item.multiplier}× category avg · {item.date}
            </p>
          </div>
        ))}
        {spikes.map((spike) => (
          <div key={spike.category?.id} className="rounded-tile bg-surface-base/60 px-3 py-2">
            <p className="text-sm font-medium text-app-text">
              {spike.category?.name} spend{' '}
              <span className="text-accent-coral">↑{Number.parseFloat(spike.changePct ?? 0).toFixed(0)}%</span>
            </p>
            <p className="mt-0.5 text-xs text-app-muted">
              {formatAmount(spike.currentTotal)} vs {formatAmount(spike.previousTotal)} last period
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopExpenses({ expenses }) {
  if (!expenses?.length) return <p className="text-sm text-app-muted">No expenses yet.</p>;
  return (
    <div className="divide-y divide-app-border/30">
      {expenses.map((expense) => (
        <div key={expense.id} className="flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile bg-surface-soft text-base">
              {expense.category?.icon ?? '📦'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-app-text">{expense.description}</p>
              <p className="mt-0.5 text-xs text-app-muted">{expense.date}</p>
            </div>
          </div>
          <p className="shrink-0 text-sm font-semibold text-app-text">{formatAmount(expense.amount)}</p>
        </div>
      ))}
    </div>
  );
}

function CategoryBreakdown({ categories }) {
  const rows = categories?.categories ?? [];
  const max = Math.max(...rows.map((r) => parseAmount(r.total)), 0);
  if (rows.length === 0) return <p className="text-sm text-app-muted">No category data.</p>;

  return (
    <div className="space-y-3">
      {rows.map((cat) => {
        const total = parseAmount(cat.total);
        return (
          <div key={cat.categoryId} className="rounded-tile bg-surface-soft/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-tile text-sm" style={{ backgroundColor: `${cat.color ?? '#9CA3AF'}22` }}>
                  {cat.icon ?? '📦'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-app-text">{cat.name}</p>
                  <p className="mt-0.5 text-[10px] text-app-muted">{cat.expenseCount} exp · avg {formatAmount(cat.avgPerExpense)}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-app-text">{formatAmount(total)}</p>
                <p className="mt-0.5 text-[10px]">
                  <TrendArrow direction={cat.trend} pctChange={cat.changePct} />
                </p>
              </div>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-surface-base">
              <div className="h-full rounded-pill" style={{ width: pct(total, max), backgroundColor: cat.color ?? '#0f6d56' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MemberBreakdown({ members }) {
  const rows = members?.members ?? [];
  const maxPaid = Math.max(...rows.map((r) => parseAmount(r.paid)), 0);
  if (rows.length === 0) return <p className="text-sm text-app-muted">No member data.</p>;

  return (
    <div className="space-y-3">
      {rows.map((m) => {
        const paid = parseAmount(m.paid);
        const net = parseAmount(m.net);
        const fairness = parseAmount(m.fairnessScore);
        return (
          <div key={m.userId} className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-app-text">{m.name}</p>
                <p className="mt-0.5 text-xs text-app-muted">Paid {formatAmount(m.paid)} · owes {formatAmount(m.owes)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-semibold ${net >= 0 ? 'text-accent-forest' : 'text-accent-coral'}`}>
                  {net >= 0 ? '+' : '−'}{formatAmount(net)}
                </p>
                <p className="mt-0.5 text-[10px] text-app-muted">
                  {fairness.toFixed(2)}× share
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-surface-soft">
              <div className="h-full rounded-pill bg-accent-forest" style={{ width: pct(paid, maxPaid) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── TRENDS components ── */

function TrendBars({ trends }) {
  const buckets = trends?.buckets ?? [];
  const max = Math.max(...buckets.map((b) => parseAmount(b.total)), 0);
  if (buckets.length === 0) return <p className="text-sm text-app-muted">No trend data for this period.</p>;

  return (
    <div className="space-y-3">
      {buckets.map((bucket) => {
        const total = parseAmount(bucket.total);
        return (
          <div key={bucket.key}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <p className="truncate text-xs text-app-muted">{bucket.label}</p>
              <p className="shrink-0 text-xs font-semibold text-app-text">{formatAmount(total)}</p>
            </div>
            <div className="h-2 overflow-hidden rounded-pill bg-surface-soft">
              <div className="h-full rounded-pill bg-accent-forest" style={{ width: pct(total, max) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryTrendList({ categoryTrends, bucketBy }) {
  const cats = categoryTrends?.categories ?? [];
  if (cats.length === 0) return <p className="text-sm text-app-muted">No category trend data.</p>;

  return (
    <div className="space-y-3">
      {cats.map((cat) => {
        const buckets = cat.buckets ?? [];
        const maxBucket = Math.max(...buckets.map((b) => parseAmount(b.total)), 0);
        return (
          <div key={cat.category?.id} className="rounded-tile bg-surface-soft/50 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm">{cat.category?.icon ?? '📦'}</span>
                <p className="truncate text-sm font-semibold text-app-text">{cat.category?.name}</p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <p className="text-xs font-semibold text-app-text">{formatAmount(cat.total)}</p>
                <p className="text-[10px]">
                  <TrendArrow direction={cat.trend} pctChange={cat.changePct} />
                </p>
              </div>
            </div>
            {buckets.length > 1 && (
              <div className="flex items-end gap-0.5 h-8">
                {buckets.map((b) => {
                  const h = maxBucket > 0 ? Math.max(4, (parseAmount(b.total) / maxBucket) * 100) : 4;
                  return (
                    <div
                      key={b.key}
                      className="flex-1 rounded-sm"
                      style={{ height: `${h}%`, backgroundColor: cat.category?.color ?? '#0f6d56', opacity: 0.7 }}
                      title={`${b.label}: ${formatAmount(b.total)}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MemberTrendList({ memberTrends }) {
  const members = memberTrends?.members ?? [];
  if (members.length === 0) return <p className="text-sm text-app-muted">No member trend data.</p>;

  return (
    <div className="space-y-3">
      {members.map((m) => {
        const buckets = m.buckets ?? [];
        const maxBucket = Math.max(...buckets.map((b) => parseAmount(b.paid)), 0);
        const net = parseAmount(m.net);
        return (
          <div key={m.user?.id} className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-app-text">{m.user?.name}</p>
              <p className={`text-xs font-semibold ${net >= 0 ? 'text-accent-forest' : 'text-accent-coral'}`}>
                {net >= 0 ? '+' : '−'}{formatAmount(net)} net
              </p>
            </div>
            {buckets.length > 0 && (
              <div className="space-y-1.5">
                {buckets.map((b) => (
                  <div key={b.key} className="flex items-center gap-2">
                    <p className="w-14 shrink-0 text-[10px] text-app-muted truncate">{b.label}</p>
                    <div className="flex-1 h-1.5 rounded-pill overflow-hidden bg-surface-soft">
                      <div className="h-full rounded-pill bg-accent-forest" style={{ width: pct(parseAmount(b.paid), maxBucket) }} />
                    </div>
                    <p className="w-16 shrink-0 text-right text-[10px] font-medium text-app-text">{formatAmount(b.paid)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── PATTERNS components ── */

function WeekdayPattern({ patterns }) {
  const days = patterns?.byWeekday ?? [];
  if (days.length === 0) return <p className="text-sm text-app-muted">No pattern data.</p>;
  const sorted = [...days].sort((a, b) => a.weekdayIndex - b.weekdayIndex);
  const max = Math.max(...sorted.map((d) => parseAmount(d.total)), 0);

  return (
    <div className="space-y-2">
      {sorted.map((day) => {
        const total = parseAmount(day.total);
        const isMax = total === max && total > 0;
        return (
          <div key={day.weekday} className="flex items-center gap-3">
            <p className={`w-8 shrink-0 text-xs font-medium ${isMax ? 'text-accent-coral' : 'text-app-muted'}`}>
              {day.weekday.slice(0, 3)}
            </p>
            <div className="flex-1 h-6 rounded-pill bg-surface-soft overflow-hidden">
              <div
                className="h-full rounded-pill flex items-center pl-2 transition-all"
                style={{ width: pct(total, max), backgroundColor: isMax ? '#f87171' : '#0f6d5666' }}
              />
            </div>
            <div className="w-20 shrink-0 text-right">
              <p className={`text-xs font-semibold ${isMax ? 'text-accent-coral' : 'text-app-text'}`}>{formatAmount(total)}</p>
              <p className="text-[10px] text-app-muted">{day.expenseCount} exp</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HighestSpendDays({ patterns }) {
  const days = patterns?.highestSpendDays ?? [];
  if (days.length === 0) return <p className="text-sm text-app-muted">Not enough data.</p>;

  return (
    <div className="divide-y divide-app-border/30">
      {days.slice(0, 5).map((d) => (
        <div key={d.date} className="flex items-center justify-between gap-3 py-2.5">
          <p className="text-sm text-app-muted">{d.date}</p>
          <div className="text-right">
            <p className="text-sm font-semibold text-app-text">{formatAmount(d.total)}</p>
            <p className="text-[10px] text-app-muted">{d.expenseCount} exp</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecurringCard({ patterns }) {
  const items = patterns?.recurringVsOneOff ?? [];
  if (items.length === 0) return null;
  const recurring = items.find((i) => i.type === 'recurring');
  const oneOff = items.find((i) => i.type === 'one_off');

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-tile bg-surface-soft/50 p-3 text-center">
        <p className="text-[10px] uppercase tracking-label text-app-muted">Recurring</p>
        <p className="mt-1.5 text-base font-semibold text-app-text">{formatAmount(recurring?.total ?? 0)}</p>
        <p className="mt-0.5 text-xs text-app-muted">{recurring?.expenseCount ?? 0} expenses</p>
      </div>
      <div className="rounded-tile bg-surface-soft/50 p-3 text-center">
        <p className="text-[10px] uppercase tracking-label text-app-muted">One-off</p>
        <p className="mt-1.5 text-base font-semibold text-app-text">{formatAmount(oneOff?.total ?? 0)}</p>
        <p className="mt-0.5 text-xs text-app-muted">{oneOff?.expenseCount ?? 0} expenses</p>
      </div>
    </div>
  );
}

/* ── MAIN PAGE ── */

export default function GroupAnalyticsPage() {
  const { groupId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';

  const [from, setFrom] = useState(monthStartString());
  const [to, setTo] = useState(todayString());
  const [bucketBy, setBucketBy] = useState('month');
  const [group, setGroup] = useState(null);
  const [summary, setSummary] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [trends, setTrends] = useState(null);
  const [categories, setCategories] = useState(null);
  const [categoryTrends, setCategoryTrends] = useState(null);
  const [members, setMembers] = useState(null);
  const [memberTrends, setMemberTrends] = useState(null);
  const [tags, setTags] = useState(null);
  const [patterns, setPatterns] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError('');
    const base = { from, to };
    try {
      const [
        groupData, summaryData, comparisonData, trendsData,
        catData, catTrendsData, membersData, memberTrendsData,
        tagsData, patternsData, anomaliesData,
      ] = await Promise.all([
        getGroup(groupId),
        getGroupAnalyticsSummary(groupId, base).catch(() => null),
        getGroupAnalyticsComparison(groupId, base).catch(() => null),
        getGroupAnalyticsTrends(groupId, { ...base, by: bucketBy }).catch(() => null),
        getGroupAnalyticsCategories(groupId, base).catch(() => null),
        getGroupAnalyticsCategoryTrends(groupId, { ...base, by: bucketBy }).catch(() => null),
        getGroupAnalyticsMembers(groupId, base).catch(() => null),
        getGroupAnalyticsMemberTrends(groupId, { ...base, by: bucketBy }).catch(() => null),
        getGroupAnalyticsTags(groupId, base).catch(() => null),
        getGroupAnalyticsPatterns(groupId, base).catch(() => null),
        getGroupAnalyticsAnomalies(groupId, base).catch(() => null),
      ]);
      setGroup(groupData);
      setSummary(summaryData);
      setComparison(comparisonData);
      setTrends(trendsData);
      setCategories(catData);
      setCategoryTrends(catTrendsData);
      setMembers(membersData);
      setMemberTrends(memberTrendsData);
      setTags(tagsData);
      setPatterns(patternsData);
      setAnomalies(anomaliesData);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, [bucketBy, from, groupId, to]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const change = summary?.vsLastPeriod;
  const changeValue = parseAmount(change?.changeAmount);
  const changeIsUp = changeValue > 0;
  const anomalyCount = (anomalies?.unusualExpenses?.length ?? 0) + (anomalies?.categorySpikes?.length ?? 0);
  const categoryTotal = useMemo(
    () => (categories?.categories ?? []).reduce((sum, c) => sum + parseAmount(c.total), 0),
    [categories],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 pb-8 sm:px-6">

      {/* Header */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link
          to={`/groups/${groupId}`}
          className="flex h-10 items-center gap-2 rounded-pill bg-surface-soft px-3 text-sm font-medium text-app-text transition active:opacity-70"
        >
          <ChevronLeft />
          {group?.name ?? 'Group'}
        </Link>
        <button
          type="button"
          onClick={async () => {
            setExporting(true);
            try {
              await downloadCsv(`/groups/${groupId}/analytics/export.csv`, {
                params: { from, to },
                filename: `analytics-${from}_${to}.csv`,
              });
            } finally {
              setExporting(false);
            }
          }}
          disabled={exporting}
          className="rounded-pill bg-surface-soft px-3 py-2 text-xs font-semibold text-app-text disabled:opacity-50 transition active:opacity-70"
        >
          {exporting ? 'Downloading…' : 'Export CSV'}
        </button>
      </header>

      <h1 className="mb-4 text-xl font-semibold text-app-text">Analytics</h1>

      {/* Filters */}
      <section className="mb-5 rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-label text-app-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-3 text-sm text-app-text outline-none focus:border-accent-forest/60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-label text-app-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-3 text-sm text-app-text outline-none focus:border-accent-forest/60"
            />
          </label>
          <div className="space-y-1.5">
            <span className="block text-[10px] font-medium uppercase tracking-label text-app-muted">Bucket</span>
            <div className="flex h-12 rounded-card bg-surface-soft p-1">
              {['day', 'week', 'month'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBucketBy(mode)}
                  className={`flex-1 rounded-tile text-xs font-semibold capitalize transition ${
                    bucketBy === mode ? 'bg-surface-inverted text-white' : 'text-app-muted'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="mb-5 flex rounded-pill bg-surface-soft p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSearchParams(tab.key === 'overview' ? {} : { tab: tab.key })}
            className={`relative flex h-10 flex-1 items-center justify-center rounded-pill text-sm font-semibold transition ${
              activeTab === tab.key ? 'bg-surface-inverted text-white' : 'text-app-muted'
            }`}
          >
            {tab.label}
            {tab.key === 'overview' && anomalyCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white">
                {anomalyCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-5 rounded-card border border-app-border/40 bg-surface-base p-4 text-sm text-accent-coral shadow-card">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse rounded-card bg-surface-soft" />)}
          </div>
          {[1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-card bg-surface-soft" />)}
        </div>
      ) : (
        <main className="space-y-5">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Total spend" value={formatAmount(summary?.totalSpend ?? 0)} />
                <StatTile
                  label="Expenses"
                  value={summary?.expenseCount ?? 0}
                  sub={`Avg ${formatAmount(summary?.avgExpenseAmount ?? 0)}`}
                />
                <StatTile
                  label="Equal share"
                  value={formatAmount(members?.equalShare ?? 0)}
                  sub={`${members?.members?.length ?? 0} members`}
                />
                <StatTile
                  label="Vs last period"
                  value={`${changeIsUp ? '+' : '−'}${formatAmount(changeValue)}`}
                  tone={changeIsUp ? 'danger' : 'good'}
                  sub={change?.changePct ? `${Math.abs(Number.parseFloat(change.changePct)).toFixed(1)}%` : 'No comparison'}
                />
              </section>

              <ComparisonCard comparison={comparison} />
              <AnomalyCard anomalies={anomalies} />

              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Largest</p>
                  <h2 className="mb-4 text-base font-semibold text-app-text">Top expenses</h2>
                  <TopExpenses expenses={summary?.topExpenses} />
                </section>

                <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Categories</p>
                      <h2 className="text-base font-semibold text-app-text">Where money went</h2>
                    </div>
                    <p className="text-sm font-semibold text-app-muted">{formatAmount(categoryTotal)}</p>
                  </div>
                  <CategoryBreakdown categories={categories} />
                </section>
              </div>

              <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Members</p>
                <h2 className="mb-4 text-base font-semibold text-app-text">Fairness & contribution</h2>
                <MemberBreakdown members={members} />
              </section>
            </>
          )}

          {/* ── TRENDS ── */}
          {activeTab === 'trends' && (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Trend</p>
                  <h2 className="mb-4 text-base font-semibold text-app-text">Spending by {bucketBy}</h2>
                  <TrendBars trends={trends} />
                </section>

                <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Categories over time</p>
                  <h2 className="mb-4 text-base font-semibold text-app-text">Category trends</h2>
                  <CategoryTrendList categoryTrends={categoryTrends} bucketBy={bucketBy} />
                </section>
              </div>

              <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Contribution</p>
                <h2 className="mb-4 text-base font-semibold text-app-text">Member spend by {bucketBy}</h2>
                <MemberTrendList memberTrends={memberTrends} />
              </section>

              <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Tags</p>
                <h2 className="mb-4 text-base font-semibold text-app-text">Trips & events</h2>
                {(tags?.tags ?? []).length > 0 ? (
                  <div className="space-y-3">
                    {tags.tags.map((tag) => {
                      const total = parseAmount(tag.total);
                      const max = Math.max(...(tags?.tags ?? []).map((t) => parseAmount(t.total)), 0);
                      return (
                        <div key={tag.tagId} className="rounded-tile bg-surface-soft/50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color ?? '#06B6D4' }} />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-app-text">{tag.name}</p>
                                <p className="mt-0.5 text-xs text-app-muted">{tag.expenseCount} expenses</p>
                              </div>
                            </div>
                            <p className="shrink-0 text-sm font-semibold text-app-text">{formatAmount(total)}</p>
                          </div>
                          <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-surface-base">
                            <div className="h-full rounded-pill" style={{ width: pct(total, Math.max(...(tags?.tags ?? []).map((t) => parseAmount(t.total)), 0)), backgroundColor: tag.color ?? '#06B6D4' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-app-muted">No tagged spending in this period.</p>
                )}
              </section>
            </>
          )}

          {/* ── PATTERNS ── */}
          {activeTab === 'patterns' && (
            <>
              <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">When you spend</p>
                <h2 className="mb-4 text-base font-semibold text-app-text">Weekday breakdown</h2>
                <WeekdayPattern patterns={patterns} />
              </section>

              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Biggest days</p>
                  <h2 className="mb-4 text-base font-semibold text-app-text">Highest spend dates</h2>
                  <HighestSpendDays patterns={patterns} />
                </section>

                <section className="rounded-card border border-app-border/40 bg-surface-base p-4 shadow-card">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-label text-app-muted">Behaviour</p>
                  <h2 className="mb-4 text-base font-semibold text-app-text">Recurring vs one-off</h2>
                  <RecurringCard patterns={patterns} />
                </section>
              </div>
            </>
          )}

        </main>
      )}
    </div>
  );
}
