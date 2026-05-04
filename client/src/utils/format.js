const rupee = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const formatAmount = (amount) => rupee.format(Math.abs(parseFloat(amount ?? 0)));

export const toMoneyString = (amount) => {
  const value = Number.parseFloat(amount);
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
};

export const formatDate = (dateStr) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${dateStr}T00:00:00`));

export const formatDateHeading = (dateStr) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateStr}T00:00:00`)).toUpperCase();

export const timeAgo = (dateStr) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};
