import api from './api';

export const getGroups = (params) => api.get('/groups', { params }).then((r) => r.data);
export const getGroup = (id) => api.get(`/groups/${id}`).then((r) => r.data);
export const createGroup = (body) => api.post('/groups', body).then((r) => r.data);
export const updateGroup = (id, body) => api.put(`/groups/${id}`, body).then((r) => r.data);
export const deleteGroup = (id) => api.delete(`/groups/${id}`);

export const getGroupDashboard = (id) => api.get(`/groups/${id}/dashboard`).then((r) => r.data);
export const getGroupBalances = (id) => api.get(`/groups/${id}/balances`).then((r) => r.data);
export const getGroupBalancesSimplified = (id) => api.get(`/groups/${id}/balances/simplified`).then((r) => r.data);
export const getMyGroupBalance = (id) => api.get(`/groups/${id}/balances/me`).then((r) => r.data);
