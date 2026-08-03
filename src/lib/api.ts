import type { AppState } from "@/types";

export interface AuthUser {
  personId: string;
  username: string;
  name: string;
  role: "admin" | "member";
}

export interface RemoteState {
  people: AppState["people"];
  tasks: AppState["tasks"];
  studentProfiles: NonNullable<AppState["studentProfiles"]>;
  profileFieldDefs: NonNullable<AppState["profileFieldDefs"]>;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    let message = "请求失败，请稍后重试";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the generic message when the server did not return JSON.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: AuthUser | null }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  getState: () =>
    request<{ state: RemoteState | null; revision: number; updatedAt: string | null }>("/api/state"),
  saveState: (state: RemoteState) =>
    request<{ revision: number; updatedAt: string }>("/api/state", {
      method: "PUT",
      body: JSON.stringify(state),
    }),
  resetPassword: (personId: string, password: string) =>
    request<void>(`/api/users/${encodeURIComponent(personId)}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),
  createUser: (account: {
    personId: string;
    username: string;
    name: string;
    role: "admin" | "member";
    password: string;
  }) => request<{ user: AuthUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify({
      person_id: account.personId,
      username: account.username,
      name: account.name,
      role: account.role,
      password: account.password,
    }),
  }),
  updateUser: (personId: string, account: { username: string; name: string }) =>
    request<{ user: AuthUser }>(`/api/users/${encodeURIComponent(personId)}`, {
      method: "PUT",
      body: JSON.stringify(account),
    }),
  deleteUser: (personId: string) =>
    request<void>(`/api/users/${encodeURIComponent(personId)}`, { method: "DELETE" }),
};
