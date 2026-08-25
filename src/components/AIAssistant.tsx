import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  FileSpreadsheet,
  Loader2,
  Minus,
  Paperclip,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  api,
  readAiStream,
  type AiConversation,
  type AiMessage,
  type AiStatus,
} from "@/lib/api";
import type { Person, Role, Task } from "@/types";

type NewTask = Omit<
  Task,
  "id" | "order" | "progressHistory" | "isMilestone" | "archivedAt"
>;

interface AIAssistantProps {
  people: Person[];
  currentUserId: string | null;
  currentUserName: string;
  currentUserRole: Role;
  isManager: boolean;
  onAddTask: (task: NewTask) => void;
  onAddAccount: (account: {
    username: string;
    name: string;
    role: Role;
    password: string;
  }) => Promise<void>;
}

type Mode = "chat" | "tasks" | "roster";

interface ParsedTask {
  name: string;
  assignee: string;
  startDate: string;
  endDate: string;
  description: string;
  progress: number;
  assigneeId?: string;
  valid: boolean;
  reason?: string;
}

interface ParsedAccount {
  name: string;
  username: string;
  password: string;
  result?: "pending" | "ok" | "fail";
  message?: string;
}

interface TextFile {
  name: string;
  text: string;
}

const today = () => new Date().toISOString().split("T")[0];

/** 悬浮窗位置/尺寸钳制在视口内 */
function clampBox(box: { x: number; y: number; w: number; h: number }) {
  return {
    w: Math.min(Math.max(320, box.w), Math.max(340, window.innerWidth - 24)),
    h: Math.min(Math.max(360, box.h), Math.max(380, window.innerHeight - 24)),
    x: Math.min(Math.max(8, box.x), Math.max(8, window.innerWidth - 80)),
    y: Math.min(Math.max(8, box.y), Math.max(8, window.innerHeight - 80)),
  };
}

/** 从 AI 回复中提取最外层 JSON 对象或数组（剥 code fence） */
function extractJson<T>(text: string): T | null {
  const stripped = text.replace(/```(?:json)?/g, "").replace(/```/g, "");
  const objectStart = stripped.indexOf("{");
  const arrayStart = stripped.indexOf("[");
  const candidates: string[] = [];
  if (objectStart >= 0) candidates.push(stripped.slice(objectStart, stripped.lastIndexOf("}") + 1));
  if (arrayStart >= 0) candidates.push(stripped.slice(arrayStart, stripped.lastIndexOf("]") + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

export default function AIAssistant({
  people,
  currentUserId,
  currentUserName,
  currentUserRole,
  isManager,
  onAddTask,
  onAddAccount,
}: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [mode, setMode] = useState<Mode>("chat");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<TextFile[]>([]);
  const [rosterFile, setRosterFile] = useState<TextFile | null>(null);
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [firstDelta, setFirstDelta] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const [unread, setUnread] = useState(false);
  const [taskPreview, setTaskPreview] = useState<ParsedTask[] | null>(null);
  const [accountPreview, setAccountPreview] = useState<ParsedAccount[] | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const attachInputRef = useRef<HTMLInputElement>(null);
  const rosterInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const usable = status?.available && status?.enabled;

  // ---- 悬浮窗：可拖动（标题栏）/可缩放（右下角），位置尺寸记忆 ----
  const isMobile = useIsMobile();
  const [windowBox, setWindowBox] = useState<{ x: number; y: number; w: number; h: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gantt-ai-window") || "null");
      if (saved && saved.x != null && saved.y != null && saved.w && saved.h) return saved;
    } catch {
      // 本地存储损坏时回落默认值
    }
    return { x: 0, y: 0, w: 400, h: 560 };
  });
  const windowBoxRef = useRef(windowBox);
  useEffect(() => {
    windowBoxRef.current = windowBox;
  }, [windowBox]);
  const placedRef = useRef(false);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ px: number; py: number; ow: number; oh: number } | null>(null);

  useEffect(() => {
    if (!open || isMobile) return;
    if (!placedRef.current) {
      // 首次打开贴右下角（悬浮球上方）
      placedRef.current = true;
      const { w, h } = windowBoxRef.current;
      setWindowBox({
        w,
        h,
        x: Math.max(8, window.innerWidth - w - 24),
        y: Math.max(8, window.innerHeight - h - 88),
      });
    } else {
      // 记忆窗口已保存过位置：仅做边界钳制
      setWindowBox((box) => clampBox(box));
    }
  }, [open, isMobile]);

  useEffect(() => {
    localStorage.setItem("gantt-ai-window", JSON.stringify(windowBox));
  }, [windowBox]);

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if ((event.target as HTMLElement).closest("button, select, input")) return;
    dragRef.current = {
      px: event.clientX,
      py: event.clientY,
      ox: windowBoxRef.current.x,
      oy: windowBoxRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWindowBox((box) =>
      clampBox({ ...box, x: drag.ox + event.clientX - drag.px, y: drag.oy + event.clientY - drag.py })
    );
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = {
      px: event.clientX,
      py: event.clientY,
      ow: windowBoxRef.current.w,
      oh: windowBoxRef.current.h,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    setWindowBox((box) =>
      clampBox({
        ...box,
        w: resize.ow + event.clientX - resize.px,
        h: resize.oh + event.clientY - resize.py,
      })
    );
  };
  const endResize = () => {
    resizeRef.current = null;
  };

  useEffect(() => {
    api.getAiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText, taskPreview, accountPreview]);

  const loadConversations = useCallback(async () => {
    const data = await api.listAiConversations();
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  const openDrawer = useCallback(async () => {
    setOpen(true);
    setUnread(false);
    try {
      await loadConversations();
    } catch {
      setNotice({ type: "error", text: "对话列表加载失败" });
    }
  }, [loadConversations]);

  const selectConversation = useCallback(async (id: string) => {
    setCurrentId(id);
    setTaskPreview(null);
    setAccountPreview(null);
    setRosterFile(null);
    setAttachments([]);
    setStreamText(null);
    try {
      const data = await api.listAiMessages(id);
      setMessages(data.messages);
    } catch {
      setNotice({ type: "error", text: "历史加载失败" });
    }
  }, []);

  const newConversation = useCallback(() => {
    setCurrentId(null);
    setMessages([]);
    setTaskPreview(null);
    setAccountPreview(null);
    setRosterFile(null);
    setAttachments([]);
    setStreamText(null);
  }, []);

  const deleteCurrent = useCallback(async () => {
    if (!currentId) return;
    if (!window.confirm("确定删除这个对话吗？聊天记录将一并删除。")) return;
    try {
      await api.deleteAiConversation(currentId);
      await loadConversations();
      newConversation();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "删除失败" });
    }
  }, [currentId, loadConversations, newConversation]);

  // ---- 模式化 prompt 组装 ----
  const buildContent = useCallback(
    (raw: string): string => {
      if (mode === "chat") {
        const parts = attachments.map((file) => `[文件：${file.name}]\n${file.text}`);
        if (parts.length) parts.push(raw);
        return parts.join("\n\n") || raw;
      }
      if (mode === "tasks") {
        const roster =
          currentUserRole === "student"
            ? `${currentUserName}(${currentUserId ?? ""})`
            : people
                .filter((p) => p.role === "student" && p.status !== "archived")
                .map((p) => `${p.name}(${p.username ?? p.id})`)
                .join("、") || "（暂无学生）";
        return [
          "【快速建任务】",
          `今天是 ${today()}。可分配成员（姓名(学号)）：${roster}`,
          "请把下面的指令转成任务列表，只输出严格 JSON 数组，不要任何解释：",
          '[{"name":"任务名","assignee":"姓名或学号","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","description":"描述","progress":0}]',
          "指令未提到的信息自行合理设定：日期默认今天开始、一周后结束；进度默认 0；学生角色时负责人只能是本人。",
          `指令：${raw}`,
        ].join("\n");
      }
      // roster
      const header = rosterFile
        ? `【批量建账号】花名册文件「${rosterFile.name}」内容：\n${rosterFile.text}`
        : "【批量建账号·继续】请继续按花名册导入要求处理。";
      return [
        header,
        "请提取全部学生，只输出严格 JSON，不要任何解释：",
        '{"password":"初始密码（指令或花名册指定时填写，否则为 null）","students":[{"name":"姓名","username":"学号"}]}',
        "若 password 为 null，先用一句话向管理员询问初始密码，不要输出 JSON。",
        `补充指令：${raw || "无"}`,
      ].join("\n");
    },
    [attachments, currentUserId, currentUserName, currentUserRole, mode, people, rosterFile]
  );

  // ---- AI 回复解析为预览 ----
  const applyAssistantContent = useCallback(
    (content: string) => {
      if (mode === "tasks") {
        const parsed = extractJson<Record<string, unknown>[]>(content);
        if (!Array.isArray(parsed)) return;
        const preview: ParsedTask[] = parsed.map((item) => {
          const assignee = String(item.assignee ?? item.name ?? "");
          const person = people.find(
            (p) =>
              p.name === assignee ||
              p.username === assignee ||
              p.id === assignee
          );
          const startDate = String(item.startDate ?? "");
          const endDate = String(item.endDate ?? "");
          const name = String(item.name ?? "");
          const valid = Boolean(person) && /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
            /^\d{4}-\d{2}-\d{2}$/.test(endDate) && Boolean(name);
          return {
            name,
            assignee,
            startDate,
            endDate,
            description: String(item.description ?? ""),
            progress: Number(item.progress) >= 0 ? Math.min(100, Number(item.progress) || 0) : 0,
            assigneeId: person?.id,
            valid,
            reason: !person ? `未匹配到成员「${assignee}」` : !name ? "缺少任务名" : undefined,
          };
        });
        if (preview.length) setTaskPreview(preview);
        return;
      }
      if (mode === "roster") {
        const parsed = extractAiRoster(content);
        if (parsed) setAccountPreview(parsed);
      }
    },
    [mode, people]
  );

  // ---- 流式读取（断线自动重连，按 seq 续传） ----
  const streamReply = useCallback(
    async (messageId: number): Promise<string> => {
      let seq = 0;
      let text = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        let interrupted = false;
        let failure: string | null = null;
        try {
          await readAiStream(messageId, seq, (event) => {
            if (event.seq <= seq) return;
            seq = event.seq;
            if (event.type === "delta" && event.text) {
              text += event.text;
              setFirstDelta(true);
              setStreamText(text);
            }
            if (event.type === "error") failure = event.message ?? "AI 回复出错";
          });
        } catch (error) {
          if (error instanceof Error && error.message === "stream-interrupted") {
            interrupted = true;
          } else {
            failure = error instanceof Error ? error.message : "AI 连接失败";
          }
        }
        if (failure) return `__ERROR__${failure}`;
        if (!interrupted) return text;
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
      }
      return `__ERROR__AI 连接不稳定，请稍后重新打开对话查看结果`;
    },
    []
  );

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw || sending || !usable) return;
    if (mode === "roster" && !rosterFile && !currentId) {
      setNotice({ type: "info", text: "请先上传花名册文件" });
      return;
    }
    setNotice(null);
    setSending(true);
    setStreamText("");
    setFirstDelta(false);
    try {
      let conversationId = currentId;
      if (!conversationId) {
        const created = await api.createAiConversation();
        conversationId = created.id;
        setCurrentId(conversationId);
        setConversations((prev) => [
          { id: created.id, title: "新对话", updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      }
      const content = buildContent(raw);
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          role: "user",
          content: mode === "chat" && attachments.length
            ? `[${attachments.map((f) => f.name).join("、")}] ${raw}`
            : mode === "roster" && rosterFile ? `[花名册：${rosterFile.name}] ${raw}` : raw,
          state: "done",
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput("");
      if (mode === "roster" && rosterFile) setRosterFile(null);
      if (mode === "chat") setAttachments([]);

      const { assistantMessageId } = await api.sendAiChat(conversationId, content);
      const result = await streamReply(assistantMessageId);
      if (result.startsWith("__ERROR__")) {
        setNotice({ type: "error", text: result.slice(9) });
      }
      // 终态：重拉历史拿权威内容（含此前所有轮次）
      const data = await api.listAiMessages(conversationId);
      setMessages(data.messages);
      setStreamText(null);
      const lastAssistant = [...data.messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant?.state === "done" && lastAssistant.content) {
        applyAssistantContent(lastAssistant.content);
      }
      if (!open) setUnread(true);
      await loadConversations();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "发送失败" });
      setStreamText(null);
    } finally {
      setSending(false);
    }
  }, [
    input, sending, usable, mode, rosterFile, currentId, attachments,
    buildContent, streamReply, applyAssistantContent, loadConversations, open,
  ]);

  const confirmTasks = useCallback(() => {
    if (!taskPreview) return;
    taskPreview.filter((task) => task.valid).forEach((task) => {
      onAddTask({
        name: task.name,
        assigneeId: task.assigneeId!,
        startDate: task.startDate,
        endDate: task.endDate,
        progress: task.progress,
        description: task.description,
        detail: { currentProgress: "", mainProblems: "", solutions: "" },
        rating: 0,
      });
    });
    setTaskPreview(null);
    setNotice({ type: "info", text: "任务已创建，请到「任务排期」查看" });
  }, [taskPreview, onAddTask]);

  const confirmAccounts = useCallback(async () => {
    if (!accountPreview) return;
    if (accountPreview.some((row) => !row.password)) {
      setNotice({ type: "error", text: "还有账号未填写初始密码（需含大小写字母和数字，至少 8 位）" });
      return;
    }
    setAccountPreview(accountPreview.map((row) => ({ ...row, result: "pending" as const })));
    const rows = [...accountPreview];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        await onAddAccount({ username: row.username, name: row.name, role: "student", password: row.password });
        rows[index] = { ...row, result: "ok" };
      } catch (error) {
        rows[index] = {
          ...row,
          result: "fail",
          message: error instanceof Error ? error.message : "创建失败",
        };
      }
      setAccountPreview([...rows]);
    }
  }, [accountPreview, onAddAccount]);

  const handleAttach = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingFile(true);
    try {
      const next: TextFile[] = [];
      for (const file of Array.from(files)) {
        const result = await api.aiFileText(file);
        next.push(result);
      }
      setAttachments((prev) => [...prev, ...next]);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "文件读取失败" });
    } finally {
      setUploadingFile(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  };

  const handleRosterFile = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingFile(true);
    try {
      const result = await api.aiFileText(files[0]);
      setRosterFile(result);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "花名册读取失败" });
    } finally {
      setUploadingFile(false);
      if (rosterInputRef.current) rosterInputRef.current.value = "";
    }
  };

  const modes: { value: Mode; label: string }[] = [
    { value: "chat", label: "自由对话" },
    { value: "tasks", label: "建任务" },
    ...(isManager ? [{ value: "roster" as Mode, label: "建账号" }] : []),
  ];

  return (
    <>
      {/* 悬浮球（点击开/关悬浮窗） */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDrawer())}
        aria-label={open ? "收起 AI 助手" : "打开 AI 助手"}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center",
          "rounded-full bg-slate-800 text-white shadow-lg transition-colors",
          "hover:bg-sky-500 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-sky-400 dark:hover:text-white"
        )}
      >
        <Bot className="size-6" />
        {unread && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-white bg-red-500 dark:border-slate-950" />
        )}
      </button>

      {/* 悬浮窗 */}
      {open && (
        <div
          role="dialog"
          aria-label="AI 助手"
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          style={
            isMobile
              ? { left: 8, right: 8, top: 72, bottom: 8 }
              : { left: windowBox.x, top: windowBox.y, width: windowBox.w, height: windowBox.h }
          }
        >
          <div
            className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="flex items-center gap-2 text-base font-semibold">
              <Bot className="size-4 text-sky-500" />
              <span className="select-none">AI 助手</span>
              {status && (
                <span
                  className={cn(
                    "ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-normal",
                    usable
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  )}
                >
                  {status.available
                    ? status.enabled ? "已就绪" : "未开启"
                    : "服务器未安装 Claude Code"}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  aria-label="最小化"
                  title="最小化为悬浮球"
                >
                  <Minus className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  aria-label="关闭"
                  title="关闭"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <select
                value={currentId ?? ""}
                onChange={(event) => event.target.value && selectConversation(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                aria-label="切换历史对话"
              >
                <option value="">＋ 新对话</option>
                {conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.title}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={newConversation} title="新对话">
                <Plus className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-red-500 hover:text-red-600"
                onClick={deleteCurrent}
                disabled={!currentId}
                title="删除当前对话"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* 模式切换 */}
          <div className="flex border-b border-slate-200 dark:border-slate-700">
            {modes.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  "flex-1 border-r border-slate-200 py-2 text-xs font-medium transition-colors last:border-r-0 dark:border-slate-700",
                  mode === item.value
                    ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
                onClick={() => {
                  setMode(item.value);
                  setTaskPreview(null);
                  setAccountPreview(null);
                  setNotice(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* 状态引导 */}
          {status && !status.available && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              服务器未安装 Claude Code CLI，请联系管理员在服务器安装并登录 Claude Code。
            </div>
          )}
          {status?.available && !status.enabled && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {isManager || currentUserRole === "admin"
                ? "AI 功能未开启，请到「系统管理 → AI 设置」开启。"
                : "AI 功能未开启，请联系管理员开通。"}
            </div>
          )}

          {/* 消息流 */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 dark:bg-slate-950">
            {messages.length === 0 && streamText === null && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
                <Bot className="size-8" />
                <p className="text-xs">
                  {mode === "chat" && "上传文件、提问，或直接对话"}
                  {mode === "tasks" && "用一句话描述，AI 帮你建任务（如：给张三建一个写周报的任务，下周五截止）"}
                  {mode === "roster" && "上传学生花名册（xlsx/csv），AI 提取后批量创建账号"}
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed",
                    message.role === "user"
                      ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "border border-slate-200 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  )}
                >
                  {message.state === "error" ? "（回复失败）" : message.content || "…"}
                </div>
              </div>
            ))}
            {streamText !== null && (
              <div className="flex justify-start">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {firstDelta ? (
                    <>
                      {streamText}
                      <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-sky-500 align-middle" />
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <Loader2 className="size-3 animate-spin" /> 思考中…
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 建任务预览 */}
            {taskPreview && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  识别到 {taskPreview.filter((t) => t.valid).length} 个有效任务
                </p>
                {taskPreview.map((task, index) => (
                  <div
                    key={index}
                    className={cn(
                      "rounded-md border p-2 text-xs",
                      task.valid
                        ? "border-slate-200 dark:border-slate-700"
                        : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{task.name}</span>
                      <span className={task.valid ? "text-slate-400" : "text-red-500"}>
                        {task.assignee} · {task.startDate}~{task.endDate}
                      </span>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">{task.description}</p>
                    )}
                    {!task.valid && <p className="mt-1 text-red-500">{task.reason}</p>}
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 bg-sky-500 hover:bg-sky-600" onClick={confirmTasks}>
                    创建有效任务
                  </Button>
                  <Button variant="outline" size="sm" className="h-7" onClick={() => setTaskPreview(null)}>
                    放弃
                  </Button>
                </div>
              </div>
            )}

            {/* 建账号预览 */}
            {accountPreview && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  识别到 {accountPreview.length} 名学生
                </p>
                <div className="max-h-56 overflow-y-auto">
                  {accountPreview.map((row, index) => (
                    <div key={index} className="flex items-center gap-1.5 py-1 text-xs">
                      <span className="w-16 shrink-0 truncate">{row.name}</span>
                      <span className="w-20 shrink-0 truncate text-slate-500">{row.username}</span>
                      <input
                        value={row.password}
                        onChange={(event) => {
                          const next = [...accountPreview];
                          next[index] = { ...row, password: event.target.value };
                          setAccountPreview(next);
                        }}
                        placeholder="初始密码"
                        disabled={row.result === "ok"}
                        className="h-7 min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 dark:border-slate-600 dark:bg-slate-900"
                      />
                      {row.result === "pending" && <Loader2 className="size-3 animate-spin text-slate-400" />}
                      {row.result === "ok" && <span className="text-[10px] text-emerald-500">已创建</span>}
                      {row.result === "fail" && (
                        <span className="max-w-24 truncate text-[10px] text-red-500" title={row.message}>
                          {row.message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 bg-sky-500 hover:bg-sky-600" onClick={confirmAccounts}>
                    批量创建
                  </Button>
                  <Button variant="outline" size="sm" className="h-7" onClick={() => setAccountPreview(null)}>
                    放弃
                  </Button>
                </div>
              </div>
            )}
          </div>

          {notice && (
            <div
              className={cn(
                "border-t px-4 py-2 text-xs",
                notice.type === "error"
                  ? "border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                  : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900"
              )}
            >
              {notice.text}
            </div>
          )}

          {/* 输入区 */}
          <div className="border-t border-slate-200 p-3 dark:border-slate-700">
            {mode === "roster" && rosterFile && (
              <div className="mb-2 flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800">
                <FileSpreadsheet className="size-3.5 text-emerald-500" />
                <span className="min-w-0 flex-1 truncate">{rosterFile.name}</span>
                <button type="button" onClick={() => setRosterFile(null)} aria-label="移除花名册">
                  <X className="size-3 text-slate-400" />
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((file, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] dark:border-slate-700 dark:bg-slate-800"
                  >
                    <Paperclip className="size-2.5" />
                    {file.name}
                    <button
                      type="button"
                      onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
                      aria-label={`移除 ${file.name}`}
                    >
                      <X className="size-2.5 text-slate-400" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={attachInputRef}
                type="file"
                multiple
                hidden
                accept=".txt,.csv,.md,.json,.log,.xlsx,.xlsm"
                onChange={(event) => handleAttach(event.target.files)}
              />
              <input
                ref={rosterInputRef}
                type="file"
                hidden
                accept=".txt,.csv,.md,.json,.xlsx,.xlsm"
                onChange={(event) => handleRosterFile(event.target.files)}
              />
              {mode === "roster" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 px-2"
                  onClick={() => rosterInputRef.current?.click()}
                  disabled={uploadingFile || !usable}
                  title="上传花名册"
                >
                  {uploadingFile ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="size-4" />
                  )}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 px-2"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={uploadingFile || !usable || mode === "tasks"}
                  title={mode === "tasks" ? "建任务模式无需附件" : "上传文本/Excel 附件"}
                >
                  {uploadingFile ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Paperclip className="size-4" />
                  )}
                </Button>
              )}
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  mode === "tasks"
                    ? "例如：给张三、李四各建一个文献调研任务，9月结束"
                    : mode === "roster"
                      ? "上传花名册后点发送（可补充指令，如：初始密码统一为 Abc202600）"
                      : "输入问题，Enter 发送，Shift+Enter 换行"
                }
                rows={2}
                disabled={!usable}
                className="min-h-9 max-h-32 flex-1 resize-none rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-sky-400 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:disabled:bg-slate-900"
              />
              <Button
                size="sm"
                className="h-9 w-9 shrink-0 bg-sky-500 p-0 hover:bg-sky-600"
                onClick={send}
                disabled={!input.trim() || sending || !usable}
                aria-label="发送"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>

          {/* 缩放手柄（桌面端） */}
          {!isMobile && (
            <div
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
              title="拖动调整窗口大小"
              aria-label="调整窗口大小"
            >
              <svg viewBox="0 0 16 16" className="size-full text-slate-300 dark:text-slate-600">
                <path d="M14 6 L6 14 M14 10 L10 14" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function extractAiRoster(content: string): ParsedAccount[] | null {
  const parsed = extractJson<{
    password?: string | null;
    students?: { name?: string; username?: string }[];
  }>(content);
  if (!parsed || !Array.isArray(parsed.students)) return null;
  const password = typeof parsed.password === "string" ? parsed.password : "";
  return parsed.students
    .filter((row) => row.name && row.username)
    .map((row) => ({
      name: String(row.name),
      username: String(row.username),
      password,
    }));
}
