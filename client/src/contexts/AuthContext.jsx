import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../services/api';
import {
  login as loginApi,
  register as registerApi,
  logout as logoutApi,
} from '../services/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Verify stored token on mount — keeps the user logged in across refreshes
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/users/me')
      .then(({ data }) => {
        localStorage.setItem('user', JSON.stringify(data));
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user: me } = await loginApi(email, password);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(me));
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const { token, user: me } = await registerApi(name, email, password);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(me));
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // token may already be invalid — clear locally regardless
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
