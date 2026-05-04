import api from './api';

export const createSettlement = (groupId, body) =>
  api.post(`/groups/${groupId}/settlements`, body).then((r) => r.data);

export const settleWith = (groupId, userId) =>
  api.post(`/groups/${groupId}/settlements/settle-with/${userId}`).then((r) => r.data);

export const getSettlements = (groupId, params) =>
  api.get(`/groups/${groupId}/settlements`, { params }).then((r) => r.data);

export const deleteSettlement = (groupId, settlementId) =>
  api.delete(`/groups/${groupId}/settlements/${settlementId}`);
