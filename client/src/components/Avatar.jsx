const sizeMap = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
};

export default function Avatar({ name = '', size = 'md' }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : (parts[0]?.[0] ?? '?').toUpperCase();

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-lime/20 font-semibold text-accent-forest ${sizeMap[size] ?? sizeMap.md}`}
    >
      {initials}
    </div>
  );
}
