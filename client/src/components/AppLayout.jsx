import { Outlet, NavLink, matchPath, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AddExpenseSheet from './AddExpenseSheet';
import ThemeToggleButton from './ThemeToggleButton';

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="h-[22px] w-[22px]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function GroupsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="h-[22px] w-[22px]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="h-[22px] w-[22px]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="h-[22px] w-[22px]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function NavTab({ to, end, icon, label }) {
  return (
    <NavLink to={to} end={end} className="flex flex-1 items-center justify-center py-2">
      {({ isActive }) => (
        <div className="flex flex-col items-center gap-0.5">
          <div className={`flex items-center justify-center rounded-2xl px-3 py-1.5 transition-colors ${
            isActive ? 'bg-accent-forest/10' : 'bg-transparent'
          }`}>
            <span className={`transition-colors ${isActive ? 'text-accent-forest' : 'text-app-muted'}`}>
              {icon}
            </span>
          </div>
          <span className={`text-[10px] font-semibold transition-colors ${
            isActive ? 'text-accent-forest' : 'text-app-muted'
          }`}>
            {label}
          </span>
        </div>
      )}
    </NavLink>
  );
}

const navLinkClass = ({ isActive }) =>
  `text-sm font-medium transition ${isActive ? 'text-accent-forest' : 'text-app-muted hover:text-app-text'}`;

export default function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [toast, setToast] = useState('');
  const initials = user?.name?.charAt(0).toUpperCase() ?? '?';
  const groupMatch = matchPath('/groups/:groupId/*', location.pathname) ?? matchPath('/groups/:groupId', location.pathname);
  const activeGroupId = groupMatch?.params?.groupId;

  function handleExpenseSuccess() {
    setExpenseOpen(false);
    setToast('Expense added');
    window.dispatchEvent(new CustomEvent('splitwise:expenseChanged'));
    window.setTimeout(() => setToast(''), 2200);
  }

  return (
    <div className="min-h-svh bg-app-bg font-sans text-app-text">

      {/* Desktop top nav */}
      <header className="hidden lg:fixed lg:inset-x-0 lg:top-0 lg:z-10 lg:flex lg:h-14 lg:items-center lg:justify-between lg:border-b lg:border-app-border/40 lg:bg-surface-base/90 lg:px-8 lg:backdrop-blur-chrome">
        <span className="text-base font-semibold text-app-text">Splitwise</span>
        <nav className="flex items-center gap-6">
          <NavLink to="/" end className={navLinkClass}>Home</NavLink>
          <NavLink to="/groups" className={navLinkClass}>Groups</NavLink>
          <NavLink to="/people" className={navLinkClass}>People</NavLink>
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggleButton />
          <NavLink
            to="/profile"
            className="flex items-center gap-2 rounded-pill bg-surface-soft px-3 py-1.5 text-sm font-medium text-app-text transition hover:bg-surface-soft/80"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-lime/30 text-xs font-semibold text-accent-forest">
              {initials}
            </span>
            {user?.name?.split(' ')[0]}
          </NavLink>
        </div>
      </header>

      {/* Page content */}
      <div className="pb-24 lg:pb-0 lg:pt-14">
        <Outlet />
      </div>

      {/* Floating add expense button */}
      <button
        type="button"
        onClick={() => setExpenseOpen(true)}
        aria-label="Add expense"
        className="fixed bottom-[4.5rem] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-accent-forest text-white shadow-soft transition active:scale-95 lg:bottom-6 lg:right-8"
      >
        <PlusIcon />
      </button>

      {toast && (
        <div className="fixed bottom-36 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-surface-inverted px-4 py-2 text-sm font-medium text-white shadow-card lg:bottom-24">
          {toast}
        </div>
      )}

      <AddExpenseSheet
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onSuccess={handleExpenseSuccess}
        defaultGroupId={activeGroupId}
      />

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex h-16 border-t border-app-border/40 bg-surface-base/95 backdrop-blur-chrome lg:hidden">
        <NavTab to="/" end icon={<HomeIcon />} label="Home" />
        <NavTab to="/groups" icon={<GroupsIcon />} label="Groups" />
        <NavTab to="/people" icon={<PeopleIcon />} label="People" />
        <NavTab to="/profile" icon={<UserIcon />} label="You" />
      </nav>

    </div>
  );
}
