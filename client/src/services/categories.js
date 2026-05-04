import api from './api';

export const getCategories = () =>
  api.get('/categories').then((r) => r.data);

export const getGroupCategories = (groupId) =>
  api.get(`/groups/${groupId}/categories`).then((r) => r.data);

export const createGroupCategory = (groupId, body) =>
  api.post(`/groups/${groupId}/categories`, body).then((r) => r.data);

export const updateGroupCategory = (groupId, categoryId, body) =>
  api.put(`/groups/${groupId}/categories/${categoryId}`, body).then((r) => r.data);

export const deleteGroupCategory = (groupId, categoryId) =>
  api.delete(`/groups/${groupId}/categories/${categoryId}`);
