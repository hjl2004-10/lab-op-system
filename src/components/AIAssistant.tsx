import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Minus, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
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

interface TextFile {
  name: string;
  text: string;
}

/** 悬浮窗位置/尺寸钳制在视口内 */
function clampBox(box: { x: number; y: number; w: number; h: number }) {
  return {
    w: Math.min(Math.max(320, box.w), Math.max(340, window.innerWidth - 24)),
    h: Math.min(Math.max(360, box.h), Math.max(380, window.innerHeight - 24)),
    x: Math.min(Math.max(8, box.x), Math.max(8, window.innerWidth - 80)),
    y: Math.min(Math.max(8, box.y), Math.max(8, window.innerHeight - 80)),
  };
}

/**
 * 全局 AI 助手：悬浮球 + 可拖拽缩放的悬浮窗，单一自由对话模式。
 * AI 通过服务端受限的数据库工具（MCP）读写实验室数据，权限与会话属主一致。
 */
export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<TextFile[]>([]);
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [firstDelta, setFirstDelta] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const [unread, setUnread] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const attachInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const usable = status?.available && status?.enabled;

  useEffect(() => {
    api.getAiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!open || isMobile) return;
    if (!placedRef.current) {
      placedRef.current = true;
      const { w, h } = windowBoxRef.current;
      setWindowBox({
        w,
        h,
        x: Math.max(8, window.innerWidth - w - 24),
        y: Math.max(8, window.innerHeight - h - 88),
      });
    } else {
      setWindowBox((box) => clampBox(box));
    }
  }, [open, isMobile]);

  useEffect(() => {
    localStorage.setItem("gantt-ai-window", JSON.stringify(windowBox));
  }, [windowBox]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText]);

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
    setStreamText(null);
    setAttachments([]);
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

  // ---- 流式读取（断线自动重连，按 seq 续传） ----
  const streamReply = useCallback(async (messageId: number): Promise<string> => {
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
    return "__ERROR__AI 连接不稳定，请稍后重新打开对话查看结果";
  }, []);

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw || sending || !usable) return;
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
      const content = attachments.length
        ? [...attachments.map((file) => `[文件：${file.name}]\n${file.text}`), raw].join("\n\n")
        : raw;
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          role: "user",
          content: attachments.length
            ? `[${attachments.map((file) => file.name).join("、")}] ${raw}`
            : raw,
          state: "done",
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput("");
      setAttachments([]);

      const { assistantMessageId } = await api.sendAiChat(conversationId, content);
      const result = await streamReply(assistantMessageId);
      if (result.startsWith("__ERROR__")) {
        setNotice({ type: "error", text: result.slice(9) });
      }
      const data = await api.listAiMessages(conversationId);
      setMessages(data.messages);
      setStreamText(null);
      if (!open) setUnread(true);
      await loadConversations();
      // 通知工作区刷新：AI 可能通过数据库工具改了任务/成员，重拉避免旧状态覆盖
      window.dispatchEvent(new Event("gantt:ai-updated"));
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "发送失败" });
      setStreamText(null);
    } finally {
      setSending(false);
    }
  }, [input, sending, usable, currentId, attachments, streamReply, loadConversations, open]);

  const handleAttach = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingFile(true);
    try {
      const next: TextFile[] = [];
      for (const file of Array.from(files)) {
        next.push(await api.aiFileText(file));
      }
      setAttachments((prev) => [...prev, ...next]);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "文件读取失败" });
    } finally {
      setUploadingFile(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  };

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

          {/* 状态引导 */}
          {status && !status.available && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              服务器未安装 Claude Code CLI，请联系管理员在服务器安装并登录 Claude Code。
            </div>
          )}
          {status?.available && !status.enabled && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              AI 功能未开启，请联系管理员到「系统管理 → AI 设置」开启。
            </div>
          )}

          {/* 消息流 */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 dark:bg-slate-950">
            {messages.length === 0 && streamText === null && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
                <Bot className="size-8" />
                <p className="max-w-[280px] text-center text-xs leading-relaxed">
                  直接吩咐即可，如：给张三建一个文献调研任务，9 月底截止 / 查一下本周大家的进展 /
                  把今天的周报记录到「综述撰写」任务下
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
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 px-2"
                onClick={() => attachInputRef.current?.click()}
                disabled={uploadingFile || !usable}
                title="上传文本/Excel 附件"
              >
                {uploadingFile ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Paperclip className="size-4" />
                )}
              </Button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder="直接吩咐，AI 会通过受限数据库工具操作，如：给张三建个调研任务，9 月底截止"
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
