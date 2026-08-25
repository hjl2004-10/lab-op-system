import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  GraduationCap,
  Loader2,
  LogOut,
  Monitor,
  Pencil,
  RefreshCw,
  RotateCcw,
  School,
  Settings2,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

import PeopleManager from "@/components/PeopleManager";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Person, Class, Role } from "@/types";
import { api, readAiStream, type SessionInfo } from "@/lib/api";

interface NewAccount {
  username: string;
  name: string;
  role: Role;
  password: string;
}

interface ImportPreview {
  filename: string;
  text: string;
  peopleCount: number;
  taskCount: number;
  profileCount: number;
}

type OperationResult = { type: "success" | "error"; message: string };

export interface SystemPageProps {
  people: Person[];
  classes: Class[];
  currentUserId: string;
  isAdmin: boolean;
  isTeacher: boolean;
  manageableStudentIds: string[];
  canManageStudent: (personId: string) => boolean;
  onAdd: (account: NewAccount) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateAccount: (
    personId: string,
    updates: { username: string; name: string }
  ) => Promise<void>;
  onSetPassword: (personId: string, password: string) => Promise<void>;
  onReorder: (personIds: string[]) => void;
  onArchive: (id: string, status: "active" | "archived") => void;
  onAddClass: (name: string) => void;
  onRemoveClass: (classId: string) => void;
  onRenameClass: (classId: string, name: string) => void;
  onSetClassMembers: (classId: string, memberIds: string[]) => void;
  autoSave: boolean;
  onToggleAutoSave: () => void;
  onExportJson: () => void;
  onImportJson: (json: string) => boolean | void | Promise<boolean | void>;
  onOpenSync: () => void;
  onReset: () => void | Promise<void>;
}

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function validateImportFile(file: File, text: string): ImportPreview {
  if (!file.name.toLowerCase().endsWith(".json")) {
    throw new Error("请选择 .json 格式的数据文件");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("文件不能超过 10 MB");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON 根节点必须是对象");
  }

  const data = value as Record<string, unknown>;
  const supportedKeys = ["people", "tasks", "studentProfiles"];
  if (!supportedKeys.some((key) => key in data)) {
    throw new Error("文件不包含人员、任务或档案数据");
  }
  for (const key of supportedKeys) {
    if (key in data && !Array.isArray(data[key])) {
      throw new Error(`${key} 必须是数组`);
    }
  }

  return {
    filename: file.name,
    text,
    peopleCount: Array.isArray(data.people) ? data.people.length : 0,
    taskCount: Array.isArray(data.tasks) ? data.tasks.length : 0,
    profileCount: Array.isArray(data.studentProfiles)
      ? data.studentProfiles.length
      : 0,
  };
}

export default function SystemPage({
  people,
  classes,
  currentUserId,
  isAdmin,
  isTeacher,
  manageableStudentIds,
  canManageStudent,
  onAdd,
  onDelete,
  onUpdateAccount,
  onSetPassword,
  onReorder,
  onArchive,
  onAddClass,
  onRemoveClass,
  onRenameClass,
  onSetClassMembers,
  autoSave,
  onToggleAutoSave,
  onExportJson,
  onImportJson,
  onOpenSync,
  onReset,
}: SystemPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [peopleManagerOpen, setPeopleManagerOpen] = useState(false);
  // 班级管理 state
  const [newClassName, setNewClassName] = useState("");
  const [renamingClassId, setRenamingClassId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [assigningClass, setAssigningClass] = useState<Class | null>(null);
  const [assigningDraft, setAssigningDraft] = useState<Set<string>>(new Set());
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // AI 设置 state
  const [aiDraft, setAiDraft] = useState({ enabled: false, model: "" });
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<string | null>(null);
  // 在线会话 state（仅 admin）
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await api.listSessions();
      setSessions(data.sessions);
    } catch {
      // 静默失败：面板下次刷新重试
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      api.listSessions().then((data) => setSessions(data.sessions)).catch(() => undefined);
    }
  }, [isAdmin]);

  const handleKillSession = async (session: SessionInfo) => {
    if (!window.confirm(`确定将「${session.name}」的这个会话强制下线吗？该设备需要重新登录。`)) {
      return;
    }
    try {
      await api.killSession(session.tokenHash);
      await loadSessions();
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "下线失败",
      });
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    api
      .getAiSettings()
      .then((settings) => {
        setAiDraft({ enabled: settings.enabled, model: settings.model });
        setAiAvailable(settings.available);
      })
      .catch(() => setAiTestResult("AI 设置加载失败"));
  }, [isAdmin]);

  const handleSaveAiSettings = async () => {
    setAiSaving(true);
    setAiTestResult(null);
    try {
      await api.saveAiSettings(aiDraft);
      setResult({ type: "success", message: aiDraft.enabled ? "AI 功能已开启" : "AI 功能已关闭" });
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "保存失败",
      });
    } finally {
      setAiSaving(false);
    }
  };

  const handleTestAi = async () => {
    setAiTesting(true);
    setAiTestResult(null);
    let conversationId: string | null = null;
    try {
      const conversation = await api.createAiConversation("连接测试");
      conversationId = conversation.id;
      const { assistantMessageId } = await api.sendAiChat(conversationId, "你好，请回复「连接正常」四个字");
      let reply = "";
      let outcome: string | null = null;
      await readAiStream(assistantMessageId, 0, (event) => {
        if (event.type === "delta" && event.text) reply += event.text;
        if (event.type === "error") outcome = event.message ?? "AI 回复出错";
      });
      setAiTestResult(outcome ? `测试失败：${outcome}` : `测试成功，AI 回复：${reply.slice(0, 50)}`);
    } catch (error) {
      setAiTestResult(`测试失败：${error instanceof Error ? error.message : "连接异常"}`);
    } finally {
      setAiTesting(false);
      if (conversationId) {
        api.deleteAiConversation(conversationId).catch(() => undefined);
      }
    }
  };

  const activePeople = people.filter((person) => person.status !== "archived");
  const archivedPeople = people.filter((person) => person.status === "archived");
  const students = activePeople.filter((person) => person.role === "student");
  const teachers = activePeople.filter((person) => person.role === "teacher");

  // 班级成员（从 people.classIds 反推）
  const membersOfClass = (classId: string) =>
    people.filter((p) => p.classIds?.includes(classId));
  // 可指派进班的学生（admin 全部学生；teacher 自己可管理的）
  const assignableStudents = activePeople.filter(
    (p) => p.role === "student" && canManageStudent(p.id)
  );

  const handleAddClass = () => {
    if (!newClassName.trim()) return;
    onAddClass(newClassName);
    setNewClassName("");
  };
  const handleRenameClass = (classId: string) => {
    onRenameClass(classId, renamingName);
    setRenamingClassId(null);
  };

  const clearFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    try {
      const text = await file.text();
      setImportPreview(validateImportFile(file, text));
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "文件读取失败",
      });
      clearFileInput();
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    setResult(null);
    try {
      const imported = await onImportJson(importPreview.text);
      if (imported === false) throw new Error("导入回调未接受此文件");
      setResult({
        type: "success",
        message: `已导入 ${importPreview.filename}`,
      });
      setImportPreview(null);
      clearFileInput();
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "数据导入失败",
      });
    } finally {
      setImporting(false);
    }
  };

  const confirmReset = async () => {
    setResetting(true);
    setResult(null);
    try {
      await onReset();
      setResult({ type: "success", message: "系统数据已重置" });
      setResetOpen(false);
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "数据重置失败",
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="min-w-0 space-y-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <header className="border-b border-slate-200 pb-4 dark:border-slate-700">
        <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <Settings2 className="size-5" />
          <h1 className="text-lg font-semibold">系统管理</h1>
          <Badge className="rounded-md bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200">
            {isAdmin ? "管理员" : "老师"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          账户权限、数据备份与恢复
        </p>
      </header>

      {result && (
        <Alert
          variant={result.type === "error" ? "destructive" : "default"}
          className={
            result.type === "success"
              ? "rounded-lg border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
              : "rounded-lg"
          }
        >
          {result.type === "success" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          <AlertTitle>{result.type === "success" ? "操作完成" : "操作失败"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="accounts" className="space-y-4">
        <TabsList className="flex h-10 w-full max-w-2xl gap-1 rounded-lg bg-slate-950/5 dark:bg-slate-100/10">
          <TabsTrigger value="accounts" className="flex-1 rounded-md">
            <Users className="size-4" />账户管理
          </TabsTrigger>
          <TabsTrigger value="classes" className="flex-1 rounded-md">
            <School className="size-4" />班级管理
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="data" className="flex-1 rounded-md">
              <Database className="size-4" />数据管理
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="ai" className="flex-1 rounded-md">
              <Bot className="size-4" />AI 设置
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="accounts" className="mt-0 space-y-4">
          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { label: "启用账户", value: activePeople.length, icon: Users },
              { label: "老师", value: teachers.length, icon: GraduationCap },
              { label: "学生", value: students.length, icon: Users },
              { label: "停用账户", value: archivedPeople.length, icon: Users },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex min-h-20 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">账户与权限</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  新建账户、修改账号姓名、重置密码以及停用账户
                </p>
              </div>
              <Button
                className="bg-sky-500 hover:bg-sky-600"
                onClick={() => setPeopleManagerOpen(true)}
              >
                <Users className="size-4" />打开账户管理
              </Button>
            </div>
          </section>

          {isAdmin && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Monitor className="size-4 text-sky-500" />
                    在线会话
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    每个账号的登录设备与 IP（显示为北京时间）；可强制下线可疑会话
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={loadSessions} disabled={sessionsLoading}>
                  {sessionsLoading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  刷新
                </Button>
              </div>

              {sessions.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700">
                  {sessionsLoading ? "正在加载…" : "当前没有有效会话"}
                </p>
              ) : (
                <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                  {sessions.map((session) => (
                    <div
                      key={session.tokenHash}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs"
                    >
                      <span
                        className={
                          session.online
                            ? "size-2 shrink-0 rounded-full bg-emerald-500"
                            : "size-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
                        }
                        title={session.online ? "在线（30 分钟内有活动）" : "空闲（超过 30 分钟无活动）"}
                      />
                      <span className="min-w-20 font-medium">
                        {session.name}
                        <span className="ml-1 font-normal text-slate-400">{session.username}</span>
                      </span>
                      <span className="min-w-24 text-slate-500 dark:text-slate-400">
                        {describeDevice(session.userAgent)}
                      </span>
                      <span className="font-mono text-slate-400">{session.ip || "未知 IP"}</span>
                      <span className="text-slate-400">
                        最后活动 {formatSessionTime(session.lastSeen)}
                      </span>
                      <span className={session.online ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>
                        {session.online ? "在线" : "空闲"}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto h-7 px-2 text-red-500 hover:text-red-600"
                        onClick={() => handleKillSession(session)}
                      >
                        <LogOut className="size-3" />
                        强制下线
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </TabsContent>

        <TabsContent value="classes" className="mt-0 space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">班级管理</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                创建班级，并把学生编入班级（学生可属多个班级或不在任何班级）
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={newClassName}
                onChange={(event) => setNewClassName(event.target.value)}
                placeholder="输入班级名称，如：2026级研究生"
                className="max-w-xs"
              />
              <Button onClick={handleAddClass} disabled={!newClassName.trim()}>
                <School className="size-4" />创建班级
              </Button>
            </div>
          </section>

          {classes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-slate-700">
              暂无班级，请先创建
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {classes.map((cls) => {
                const memberList = membersOfClass(cls.id);
                const isOwn = cls.teacherId === currentUserId;
                return (
                  <div
                    key={cls.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      {renamingClassId === cls.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={renamingName}
                            onChange={(event) => setRenamingName(event.target.value)}
                            className="h-8 w-40"
                          />
                          <Button size="sm" onClick={() => handleRenameClass(cls.id)}>保存</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenamingClassId(null)}>取消</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{cls.name}</span>
                          {!isOwn && (
                            <Badge variant="secondary" className="text-sm font-normal">
                              {people.find((p) => p.id === cls.teacherId)?.name || "其他老师"}
                            </Badge>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => {
                            setRenamingClassId(cls.id);
                            setRenamingName(cls.name);
                          }}
                        >
                          <Pencil className="size-3.5" />改名
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-red-500"
                          onClick={() => onRemoveClass(cls.id)}
                        >
                          <Trash2 className="size-3.5" />删除
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      成员 {memberList.length} 人
                    </div>
                    {memberList.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {memberList.map((m) => (
                          <span
                            key={m.id}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <span className="size-2 rounded-full" style={{ backgroundColor: m.color }} />
                            {m.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAssigningClass(cls);
                          setAssigningDraft(
                            new Set(
                              memberList
                                .filter((m) => m.role === "student")
                                .map((m) => m.id)
                            )
                          );
                        }}
                      >
                        <Users className="size-3.5" />指派成员
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {isAdmin && (
        <TabsContent value="data" className="mt-0 space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">自动保存</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  数据变更后自动写入当前工作区
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={autoSave}
                  onCheckedChange={() => onToggleAutoSave()}
                  className="data-[state=checked]:bg-slate-700"
                />
                {autoSave ? "已开启" : "已关闭"}
              </label>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Download className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">导出备份</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    下载人员、任务和档案的完整 JSON 备份
                  </p>
                  <Button variant="outline" className="mt-4" onClick={onExportJson}>
                    <FileJson className="size-4" />导出 JSON
                  </Button>
                </div>
              </div>
            </article>

            <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Upload className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">导入备份</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    仅接受 10 MB 以内且结构有效的 JSON 文件
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-4" />选择文件
                  </Button>
                </div>
              </div>
            </article>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">旧同步码</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  打开原同步工具，继续使用已有同步码交换流程
                </p>
              </div>
              <Button variant="outline" onClick={onOpenSync}>
                <RefreshCw className="size-4" />打开同步入口
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-red-200 bg-red-50/60 p-4 dark:border-red-900 dark:bg-red-950/20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">危险区域</h2>
                <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">
                  重置会用初始数据替换当前人员、任务和学生档案
                </p>
              </div>
              <Button variant="destructive" onClick={() => setResetOpen(true)}>
                <RotateCcw className="size-4" />重置全部数据
              </Button>
            </div>
          </section>
        </TabsContent>
        )}

        {isAdmin && (
        <TabsContent value="ai" className="mt-0 space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="size-4 text-sky-500" />
                  AI 助手
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  通过服务器上的 Claude Code CLI 提供对话、快速建任务与花名册批量建号
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="ai-enabled"
                  checked={aiDraft.enabled}
                  onCheckedChange={(checked) =>
                    setAiDraft((previous) => ({ ...previous, enabled: checked }))
                  }
                  aria-label="开启 AI 功能"
                />
                <Label htmlFor="ai-enabled" className="text-xs text-slate-500">
                  {aiDraft.enabled ? "已开启" : "已关闭"}
                </Label>
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <Label htmlFor="ai-model" className="text-xs text-slate-500">
                模型（可选，留空用 Claude Code 默认模型）
              </Label>
              <Input
                id="ai-model"
                value={aiDraft.model}
                onChange={(event) =>
                  setAiDraft((previous) => ({ ...previous, model: event.target.value }))
                }
                placeholder="例如 claude-sonnet-4-5"
                className="max-w-xs"
                disabled={!aiAvailable}
              />
            </div>

            <div
              className={
                "mt-4 rounded-md border px-3 py-2 text-xs " +
                (aiAvailable
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                  : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300")
              }
            >
              {aiAvailable
                ? "已在服务器检测到 claude 命令，可以开启使用。"
                : "服务器未检测到 claude 命令：请安装 Claude Code CLI 并完成登录后重启服务。"}
            </div>

            {aiTestResult && (
              <p className="mt-3 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {aiTestResult}
              </p>
            )}

            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button size="sm" onClick={handleSaveAiSettings} disabled={aiSaving || !aiAvailable}>
                {aiSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                保存设置
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestAi}
                disabled={aiTesting || !aiAvailable || !aiDraft.enabled}
                title={aiDraft.enabled ? undefined : "请先开启并保存 AI 功能"}
              >
                {aiTesting ? <Loader2 className="size-4 animate-spin" /> : null}
                测试连接
              </Button>
            </div>
          </section>
        </TabsContent>
        )}
      </Tabs>

      {assigningClass && (
        <Dialog
          open={Boolean(assigningClass)}
          onOpenChange={(open) => {
            if (!open) setAssigningClass(null);
          }}
        >
          <DialogContent className="rounded-lg sm:max-w-md">
            <DialogHeader>
              <DialogTitle>指派成员到「{assigningClass.name}」</DialogTitle>
            </DialogHeader>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {assignableStudents.map((student) => {
                const checked = assigningDraft.has(student.id);
                return (
                  <label
                    key={student.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        setAssigningDraft((prev) => {
                          const next = new Set(prev);
                          if (value) next.add(student.id);
                          else next.delete(student.id);
                          return next;
                        });
                      }}
                    />
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: student.color }} />
                    <span>{student.name}</span>
                  </label>
                );
              })}
              {assignableStudents.length === 0 && (
                <div className="py-6 text-center text-sm text-slate-400">
                  {isTeacher
                    ? "还没有可指派的学生（老师只能指派自己创建的学生）"
                    : "暂无学生"}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAssigningClass(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (assigningClass) {
                    onSetClassMembers(assigningClass.id, Array.from(assigningDraft));
                  }
                  setAssigningClass(null);
                }}
              >
                保存成员
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <PeopleManager
        open={peopleManagerOpen}
        people={people}
        currentUserId={currentUserId}
        allowRoles={isAdmin ? ["student", "teacher", "admin"] : ["student"]}
        restrictedToIds={isAdmin ? null : new Set([...manageableStudentIds, currentUserId])}
        onOpenChange={setPeopleManagerOpen}
        onAdd={onAdd}
        onDelete={onDelete}
        onUpdateAccount={onUpdateAccount}
        onSetPassword={onSetPassword}
        onReorder={onReorder}
        onArchive={onArchive}
      />

      <AlertDialog
        open={Boolean(importPreview)}
        onOpenChange={(open) => {
          if (!open && !importing) {
            setImportPreview(null);
            clearFileInput();
          }
        }}
      >
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认导入数据</AlertDialogTitle>
            <AlertDialogDescription>
              导入“{importPreview?.filename}”将更新当前工作区。文件包含
              {importPreview?.peopleCount ?? 0} 个人员、
              {importPreview?.taskCount ?? 0} 个任务和
              {importPreview?.profileCount ?? 0} 份档案。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={importing}
              className="bg-sky-500 hover:bg-sky-600"
              onClick={(event) => {
                event.preventDefault();
                void confirmImport();
              }}
            >
              {importing ? "导入中" : "确认导入"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认重置全部数据</AlertDialogTitle>
            <AlertDialogDescription>
              此操作会替换当前人员、任务和档案数据，且无法撤销。建议先导出 JSON 备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                void confirmReset();
              }}
            >
              {resetting ? "重置中" : "确认重置"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

/** User-Agent 解析为人话：浏览器 · 操作系统 */
function describeDevice(userAgent: string): string {
  if (!userAgent) return "未知设备";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : /curl|python|okhttp|wget/i.test(userAgent)
              ? "命令行/程序"
              : "浏览器";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "未知系统";
  return `${browser} · ${os}`;
}

/** 会话时间显示为北京时间 MM-DD HH:mm */
function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const text = new Date(date.getTime() + 8 * 3600_000).toISOString();
  return `${text.slice(5, 10).replace("-", "/")} ${text.slice(11, 16)}`;
}
