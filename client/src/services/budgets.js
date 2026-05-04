import api from './api';

export const getBudgets = (groupId, params) =>
  api.get(`/groups/${groupId}/budgets`, { params }).then((r) => r.data);

export const upsertBudget = (groupId, body) =>
  api.put(`/groups/${groupId}/budgets`, body).then((r) => r.data);

export const deleteBudget = (groupId, budgetId) =>
  api.delete(`/groups/${groupId}/budgets/${budgetId}`);
