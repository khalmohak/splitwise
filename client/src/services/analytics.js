import api from './api';

export const getGroupAnalyticsSummary = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/summary`, { params }).then((r) => r.data);

export const getGroupAnalyticsTrends = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/trends`, { params }).then((r) => r.data);

export const getGroupAnalyticsCategories = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/categories`, { params }).then((r) => r.data);

export const getGroupAnalyticsMembers = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/members`, { params }).then((r) => r.data);

export const getGroupAnalyticsTags = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/tags`, { params }).then((r) => r.data);

export const getGroupAnalyticsComparison = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/comparison`, { params }).then((r) => r.data);

export const getGroupAnalyticsCategoryTrends = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/categories/trends`, { params }).then((r) => r.data);

export const getGroupAnalyticsMemberTrends = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/members/trends`, { params }).then((r) => r.data);

export const getGroupAnalyticsPatterns = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/patterns`, { params }).then((r) => r.data);

export const getGroupAnalyticsAnomalies = (groupId, params) =>
  api.get(`/groups/${groupId}/analytics/anomalies`, { params }).then((r) => r.data);

export const getPersonalAnalyticsTrends = (params) =>
  api.get('/users/me/analytics/trends', { params }).then((r) => r.data);
