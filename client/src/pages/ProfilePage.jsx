import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { THEME_OPTIONS, useTheme } from '../contexts/ThemeContext';
import { changePassword } from '../services/auth';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwStatus, setPwStatus] = useState({ type: '', message: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? '?';

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwStatus({ type: '', message: '' });
    setPwLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPwStatus({ type: 'success', message: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
      setShowPasswordForm(false);
    } catch (err) {
      setPwStatus({ type: 'error', message: err.response?.data?.error ?? 'Update failed.' });
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">

      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-label text-app-muted">Account</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-app-text">Profile</h1>
      </div>

      {/* Identity card */}
      <div className="rounded-panel bg-surface-inverted p-5 shadow-soft">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-lime/20 text-lg font-semibold text-accent-lime">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">{user?.name}</p>
            <p className="mt-0.5 truncate text-sm text-white/50">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">

        {/* Appearance */}
        <div className="overflow-hidden rounded-card border border-app-border/40 bg-surface-base shadow-card">
          <div className="px-4 py-4">
            <p className="text-sm font-semibold text-app-text">Appearance</p>
            <p className="mt-0.5 text-xs text-app-muted">
              {theme === 'system'
                ? `Following device: ${resolvedTheme}`
                : `Using ${theme} theme`}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-app-border/30 px-4 pb-4">
            {THEME_OPTIONS.map((option) => {
              const selected = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  className={`rounded-card border px-3 py-3 text-left transition active:opacity-80 ${
                    selected
                      ? 'border-accent-forest/50 bg-accent-forest/[0.10] text-app-text'
                      : 'border-app-border/40 bg-surface-soft/30 text-app-muted'
                  }`}
                >
                  <p className="text-sm font-semibold">{option.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-app-muted">{option.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Change password */}
        <div className="overflow-hidden rounded-card border border-app-border/40 bg-surface-base shadow-card">
          <button
            type="button"
            onClick={() => setShowPasswordForm((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-medium text-app-text transition active:bg-surface-soft/40"
          >
            Change password
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`h-4 w-4 text-app-muted transition-transform ${showPasswordForm ? 'rotate-180' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {showPasswordForm && (
            <form onSubmit={handleChangePassword} className="border-t border-app-border/30 px-4 pb-4 pt-3 space-y-3">
              <div>
                <label htmlFor="current-pw" className="mb-1.5 block text-xs font-medium text-app-muted">
                  Current password
                </label>
                <input
                  id="current-pw"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none transition placeholder:text-app-muted/60 focus:border-accent-forest/60 focus:bg-surface-base"
                />
              </div>
              <div>
                <label htmlFor="new-pw" className="mb-1.5 block text-xs font-medium text-app-muted">
                  New password
                </label>
                <input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="h-12 w-full rounded-card border border-app-border/60 bg-surface-soft/40 px-4 text-sm text-app-text outline-none transition placeholder:text-app-muted/60 focus:border-accent-forest/60 focus:bg-surface-base"
                />
              </div>

              {pwStatus.message && (
                <p className={`text-xs ${pwStatus.type === 'error' ? 'text-accent-coral' : 'text-status-success'}`}>
                  {pwStatus.message}
                </p>
              )}

              <button
                type="submit"
                disabled={pwLoading}
                className="h-12 w-full rounded-card bg-accent-forest text-sm font-semibold text-white transition active:opacity-85 disabled:opacity-50"
              >
                {pwLoading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>

        {/* Sign out */}
        <button
          type="button"
          onClick={handleLogout}
          className="h-14 w-full rounded-card border border-accent-coral/20 bg-accent-coral/[0.07] text-sm font-semibold text-accent-coral transition active:bg-accent-coral/[0.14]"
        >
          Sign out
        </button>

      </div>
    </div>
  );
}
