export interface PublicUser {
  id: number;
  name: string;
  display: string;
  level: string;
  hasPin: boolean;
}

export interface RuleMeta {
  id: string;
  title: string;
  level: string;
  tags: string[];
  requires: string[];
}

export interface TestSummary {
  file: string;
  kind: "level" | "drill";
  rule?: string;
  level?: string;
  title: string;
  count: number;
}

export interface Item {
  id: string;
  type: "choice" | "inflect" | "cloze" | "article" | "translate";
  prompt: string;
  options?: string[];
  answer: string;
  accept?: string[];
  why: string;
  words: string[];
  tags: string[];
  rule: string;
  due: string | null;
  isNew: boolean;
}

export interface ReviewResult {
  itemId: string;
  rating: "Again" | "Hard" | "Good" | "Easy";
  state: string;
  due: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => request<{ user: PublicUser }>("GET", "/api/me"),
  users: () => request<{ users: PublicUser[] }>("GET", "/api/users"),
  createUser: (name: string, display: string, pin: string) =>
    request<{ user: PublicUser }>("POST", "/api/users", { name, display, pin }),
  login: (name: string, pin: string) =>
    request<{ user: PublicUser }>("POST", "/api/session", { name, pin }),
  logout: () => request<{ ok: true }>("POST", "/api/session/logout"),
  rules: () => request<{ rules: RuleMeta[] }>("GET", "/api/content/rules"),
  tests: () => request<{ tests: TestSummary[] }>("GET", "/api/content/tests"),
  rule: (id: string) => request<RuleMeta & { body: string }>("GET", `/api/content/rules/${id}`),
  queue: (rule: string, limit = 20) =>
    request<{ items: Item[]; total: number; due: number; new: number }>(
      "GET",
      `/api/queue?rule=${encodeURIComponent(rule)}&limit=${limit}`,
    ),
  review: (body: { itemId: string; correct: boolean; ms: number; peeked: boolean; answered: string }) =>
    request<ReviewResult>("POST", "/api/review", body),
  stats: (days: number) => request<Stats>("GET", `/api/stats?days=${days}`),
  compare: (days: number) =>
    request<{ days: number; users: { display: string; name: string; total: number; right: number }[] }>(
      "GET",
      `/api/stats/compare?days=${days}`,
    ),
};

export interface StatBucket {
  key: string;
  total: number;
  right: number;
  errorRate: number;
  enough: boolean;
}

export interface Stats {
  days: number;
  total: number;
  right: number;
  errorRate: number;
  byRule: StatBucket[];
  byTag: StatBucket[];
  perDay: { day: string; count: number }[];
}
