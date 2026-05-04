import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import GroupsPage from './pages/GroupsPage';
import GroupDetailPage from './pages/GroupDetailPage';
import GroupAnalyticsPage from './pages/GroupAnalyticsPage';
import GroupBudgetsPage from './pages/GroupBudgetsPage';
import GroupCategoriesPage from './pages/GroupCategoriesPage';
import GroupTagsPage from './pages/GroupTagsPage';
import ExpenseDetailPage from './pages/ExpenseDetailPage';
import PeoplePage from './pages/PeoplePage';
import PersonDetailPage from './pages/PersonDetailPage';
import ProfilePage from './pages/ProfilePage';

function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-app-bg font-sans">
      <span className="text-sm text-app-muted">Loading…</span>
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      {/* Public — redirect away if already logged in */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />}
      />

      {/* Authenticated — redirect to login if not */}
      <Route
        path="/"
        element={isAuthenticated ? <AppLayout /> : <Navigate to="/login" replace />}
      >
        <Route index element={<DashboardPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/:groupId" element={<GroupDetailPage />} />
        <Route path="groups/:groupId/analytics" element={<GroupAnalyticsPage />} />
        <Route path="groups/:groupId/budgets" element={<GroupBudgetsPage />} />
        <Route path="groups/:groupId/categories" element={<GroupCategoriesPage />} />
        <Route path="groups/:groupId/tags" element={<GroupTagsPage />} />
        <Route path="groups/:groupId/expenses/:expenseId" element={<ExpenseDetailPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:userId" element={<PersonDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
