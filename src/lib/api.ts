import type { AppState, AttachmentMeta, Role } from "@/types";

export interface AuthUser {
  personId: string;
  username: string;
  name: string;
  role: Role;
  /** false = 账号已停用（离线模式：可登录查看，修改不会保存） */
  active?: boolean;
}

export interface RemoteState {
  people: AppState["people"];
  tasks: AppState["tasks"];
  studentProfiles: NonNullable<AppState["studentProfiles"]>;
  profileFieldDefs: NonNullable<AppState["profileFieldDefs"]>;
  classes: NonNullable<AppState["classes"]>;
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
  changeOwnPassword: (oldPassword: string, password: string) =>
    request<void>("/api/auth/password", {
      method: "PUT",
      body: JSON.stringify({ old_password: oldPassword, password }),
    }),
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
    role: Role;
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
  uploadAttachment: async (file: File): Promise<AttachmentMeta> => {
    // FormData 不能走 request()：浏览器需要自动生成 multipart boundary，不可手动设 Content-Type
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/attachments", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!response.ok) {
      let message = "附件上传失败，请稍后重试";
      try {
        const body = await response.json();
        if (typeof body.detail === "string") message = body.detail;
      } catch {
        // 服务器未返回 JSON 时保留通用提示
      }
      throw new ApiError(response.status, message);
    }
    return response.json() as Promise<AttachmentMeta>;
  },
  getAiStatus: () => request<AiStatus>("/api/ai/status"),
  getAiSettings: () => request<AiSettings>("/api/ai/settings"),
  saveAiSettings: (settings: { enabled: boolean; model: string }) =>
    request<{ ok: true }>("/api/ai/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  listAiConversations: () =>
    request<{ conversations: AiConversation[] }>("/api/ai/conversations"),
  createAiConversation: (title?: string) =>
    request<{ id: string; title: string }>("/api/ai/conversations", {
      method: "POST",
      body: JSON.stringify({ title: title ?? "" }),
    }),
  deleteAiConversation: (conversationId: string) =>
    request<void>(`/api/ai/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  listAiMessages: (conversationId: string) =>
    request<{ messages: AiMessage[] }>(
      `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`
    ),
  sendAiChat: (conversationId: string, content: string) =>
    request<{ assistantMessageId: number }>("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ conversation_id: conversationId, content }),
    }),
  aiFileText: (file: File) => uploadForText("/api/ai/file-text", file),
};

/** 附件下载地址（cookie 会话自动携带） */
export const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

// ===================== AI 助手 =====================

export interface AiStatus {
  available: boolean;
  enabled: boolean;
}

export interface AiSettings {
  enabled: boolean;
  model: string;
  available: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  state: "pending" | "done" | "error";
  createdAt: string;
}

export interface AiStreamEvent {
  seq: number;
  type: "delta" | "done" | "error";
  text?: string;
  message?: string;
}

async function uploadForText(path: string, file: File): Promise<{ name: string; text: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(path, { method: "POST", credentials: "include", body: form });
  if (!response.ok) {
    let message = "文件处理失败";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // 服务器未返回 JSON 时保留通用提示
    }
    throw new ApiError(response.status, message);
  }
  return response.json();
}

/**
 * 读取 AI 回复的 SSE 流。返回前通过 onEvent 逐事件回调；
 * 流正常结束（done/error 事件）时 resolve，异常中断时 reject。
 */
export async function readAiStream(
  messageId: number,
  fromSeq: number,
  onEvent: (event: AiStreamEvent) => void
): Promise<void> {
  const response = await fetch(
    `/api/ai/stream/${messageId}?from=${fromSeq}`,
    { credentials: "include" }
  );
  if (!response.ok || !response.body) {
    let message = "AI 连接失败";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf("\n\n");
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as AiStreamEvent;
        onEvent(event);
        if (event.type === "done" || event.type === "error") {
          finished = true;
        }
      }
    }
  }
  if (!finished) throw new Error("stream-interrupted");
}
