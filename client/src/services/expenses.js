import api from './api';

export const getExpenses = (groupId, params) =>
  api.get(`/groups/${groupId}/expenses`, { params }).then((r) => r.data);

export const getExpense = (groupId, expenseId) =>
  api.get(`/groups/${groupId}/expenses/${expenseId}`).then((r) => r.data);

export const createExpense = (groupId, body) =>
  api.post(`/groups/${groupId}/expenses`, body).then((r) => r.data);

export const updateExpense = (groupId, expenseId, body) =>
  api.put(`/groups/${groupId}/expenses/${expenseId}`, body).then((r) => r.data);

export const deleteExpense = (groupId, expenseId) =>
  api.delete(`/groups/${groupId}/expenses/${expenseId}`);
