import api from './api';

export const addMember = (groupId, email, role = 'member') =>
  api.post(`/groups/${groupId}/members`, { email, role }).then((r) => r.data);

export const changeMemberRole = (groupId, userId, role) =>
  api.patch(`/groups/${groupId}/members/${userId}`, { role }).then((r) => r.data);

export const removeMember = (groupId, userId) =>
  api.delete(`/groups/${groupId}/members/${userId}`);
