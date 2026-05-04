import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ThemeToggleButton from '../components/ThemeToggleButton';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(name, email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-svh bg-app-bg font-sans text-app-text">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-auth-hero" />
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggleButton />
      </div>

      <div className="flex min-h-svh items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="rounded-panel bg-surface-inverted p-6 shadow-soft sm:p-8">

            <div className="flex items-center justify-between">
              <span className="rounded-pill bg-accent-lime/20 px-3 py-1 text-xs font-medium uppercase tracking-tag text-accent-lime">
                Splitwise
              </span>
              <span className="rounded-pill bg-white/[0.06] px-3 py-1 text-xs font-medium uppercase tracking-tag text-white/40">
                Register
              </span>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-label text-white/40">Get started</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Create an account</h2>
            </div>

            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">

              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-medium text-white/70">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  className="h-14 w-full rounded-card border border-white/10 bg-white/[0.08] px-4 text-base text-white outline-none transition placeholder:text-white/30 focus:border-accent-lime/50 focus:bg-white/[0.12]"
                />
              </div>

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
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-white/70">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required
                  minLength={8}
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
                {loading ? 'Creating account…' : 'Create account'}
              </button>

            </form>

            <p className="mt-6 text-center text-sm text-white/45">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-accent-lime">
                Sign in
              </Link>
            </p>

          </div>
        </div>
      </div>
    </div>
  );
}
