import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ThemeToggleButton from '../components/ThemeToggleButton';

const trustPoints = [
  { title: 'Fast on mobile', copy: 'Built for quick check-ins and one-thumb actions.' },
  { title: 'Shared totals', copy: 'Track balances, trips, and home expenses in one place.' },
  { title: 'Cache-first', copy: 'Core data stays fast even on flaky networks.' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-svh bg-app-bg font-sans text-app-text">
      {/* background gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-auth-hero" />
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggleButton />
      </div>

      <div className="mx-auto flex min-h-svh max-w-6xl flex-col items-center justify-center gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:px-8 lg:py-16">

        {/* Hero — desktop only */}
        <aside className="hidden lg:flex lg:flex-1 lg:flex-col">
          <span className="inline-flex w-fit rounded-pill bg-accent-lime/20 px-3 py-1 text-sm font-medium text-accent-forest">
            Splitwise
          </span>
          <h1 className="mt-6 text-hero font-semibold text-app-text">
            Split bills fast,<br />on the go.
          </h1>
          <p className="mt-4 max-w-sm text-base leading-7 text-app-muted">
            Track shared expenses, settle debts, and keep your group finances clear — from any device.
          </p>
          <div className="mt-8 grid gap-3">
            {trustPoints.map((p) => (
              <div
                key={p.title}
                className="rounded-tile border border-app-border/60 bg-surface-soft/70 px-4 py-3"
              >
                <p className="text-sm font-semibold text-app-text">{p.title}</p>
                <p className="mt-0.5 text-sm leading-5 text-app-muted">{p.copy}</p>
              </div>
            ))}
          </div>
        </aside>

        {/* Form card */}
        <div className="w-full max-w-sm lg:flex-shrink-0">
          <div className="rounded-panel bg-surface-inverted p-6 shadow-soft sm:p-8">

            {/* card header */}
            <div className="flex items-center justify-between">
              <span className="rounded-pill bg-accent-lime/20 px-3 py-1 text-xs font-medium uppercase tracking-tag text-accent-lime">
                Splitwise
              </span>
              <span className="rounded-pill bg-white/[0.06] px-3 py-1 text-xs font-medium uppercase tracking-tag text-white/40">
                Sign in
              </span>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-label text-white/40">Welcome back</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Enter your details</h2>
            </div>

            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-white/70">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-14 w-full rounded-card border border-white/10 bg-white/[0.08] px-4 text-base text-white outline-none transition placeholder:text-white/30 focus:border-accent-lime/50 focus:bg-white/[0.12]"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-white/70">
                    Password
                  </label>
                  <button type="button" className="text-sm font-medium text-accent-lime">
                    Forgot?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-14 w-full rounded-card border border-white/10 bg-white/[0.08] px-4 text-base text-white outline-none transition placeholder:text-white/30 focus:border-accent-lime/50 focus:bg-white/[0.12]"
                />
              </div>

              {error && (
                <div className="rounded-card bg-accent-coral/10 px-4 py-3">
                  <p className="text-sm text-accent-coral">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-14 w-full rounded-card bg-accent-forest px-5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                className="h-14 w-full rounded-card border border-white/[0.12] bg-white/[0.06] px-5 text-base font-semibold text-white transition hover:bg-white/10"
              >
                Continue with Google
              </button>

            </form>

            <p className="mt-6 text-center text-sm text-white/45">
              No account?{' '}
              <Link to="/register" className="font-medium text-accent-lime">
                Create one
              </Link>
            </p>

          </div>
        </div>

      </div>
    </div>
  );
}
