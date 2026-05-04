import api from './api';

export const getGroupTags = (groupId) =>
  api.get(`/groups/${groupId}/tags`).then((r) => r.data);

export const createGroupTag = (groupId, body) =>
  api.post(`/groups/${groupId}/tags`, body).then((r) => r.data);

export const updateGroupTag = (groupId, tagId, body) =>
  api.put(`/groups/${groupId}/tags/${tagId}`, body).then((r) => r.data);

export const deleteGroupTag = (groupId, tagId) =>
  api.delete(`/groups/${groupId}/tags/${tagId}`);
