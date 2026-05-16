import { env } from "../env.js";

function baseUrl(): string {
  return env.APP_BASE_URL.endsWith("/") ? env.APP_BASE_URL : `${env.APP_BASE_URL}/`;
}

export function appUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalized, baseUrl()).toString();
}

export function inviteUrl(code: string): string {
  return appUrl(`/invite/${code}`);
}

export function groupUrl(groupId: string, tab?: string): string {
  const url = new URL(appUrl(`/groups/${groupId}`));
  if (tab) url.searchParams.set("tab", tab);
  return url.toString();
}

export function expenseUrl(groupId: string, expenseId: string): string {
  return appUrl(`/groups/${groupId}/expenses/${expenseId}`);
}

export function groupsUrl(): string {
  return appUrl("/groups");
}

export function settlementUrl(groupId: string): string {
  return groupUrl(groupId, "settlements");
}
