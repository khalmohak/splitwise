import api from './api';

export const getMe = () => api.get('/users/me').then((r) => r.data);
export const getDashboard = () => api.get('/users/me/dashboard').then((r) => r.data);
export const getMyBalances = (params) => api.get('/users/me/balances', { params }).then((r) => r.data);
export const getMyActivity = (params) => api.get('/users/me/activity', { params }).then((r) => r.data);
export const updateMe = (body) => api.put('/users/me', body).then((r) => r.data);

export const listUsers = (params) => api.get('/users', { params }).then((r) => r.data);

export const getPeople = () => api.get('/users/me/people').then((r) => r.data);
export const getPerson = (userId) => api.get(`/users/me/people/${userId}`).then((r) => r.data);
export const settleWithPerson = (userId) =>
  api.post(`/users/me/people/${userId}/settle`).then((r) => r.data);
