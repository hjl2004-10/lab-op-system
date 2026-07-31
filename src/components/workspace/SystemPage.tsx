import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
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
import type { Person } from "@/types";

interface NewAccount {
  username: string;
  name: string;
  role: "admin" | "member";
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
  currentUserId: string;
  onAdd: (account: NewAccount) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateAccount: (
    personId: string,
    updates: { username: string; name: string }
  ) => Promise<void>;
  onSetPassword: (personId: string, password: string) => Promise<void>;
  onReorder: (personIds: string[]) => void;
  onArchive: (id: string, status: "active" | "archived") => void;
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
  currentUserId,
  onAdd,
  onDelete,
  onUpdateAccount,
  onSetPassword,
  onReorder,
  onArchive,
  autoSave,
  onToggleAutoSave,
  onExportJson,
  onImportJson,
  onOpenSync,
  onReset,
}: SystemPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [peopleManagerOpen, setPeopleManagerOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const activePeople = people.filter((person) => person.status !== "archived");
  const archivedPeople = people.filter((person) => person.status === "archived");
  const admins = activePeople.filter((person) => person.role === "admin");
  const students = activePeople.filter((person) => person.role === "member");

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
      <header className="border-b border-emerald-900/15 pb-4 dark:border-emerald-300/15">
        <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
          <Settings2 className="size-5" />
          <h1 className="text-lg font-semibold">系统管理</h1>
          <Badge className="rounded-md bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200">
            管理员
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
              ? "rounded-lg border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
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
        <TabsList className="grid h-10 w-full max-w-md grid-cols-2 rounded-lg bg-emerald-950/5 dark:bg-emerald-100/10">
          <TabsTrigger value="accounts" className="rounded-md">
            <Users className="size-4" />账户管理
          </TabsTrigger>
          <TabsTrigger value="data" className="rounded-md">
            <Database className="size-4" />数据管理
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-0 space-y-4">
          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { label: "启用账户", value: activePeople.length, icon: Users },
              { label: "管理员", value: admins.length, icon: ShieldCheck },
              { label: "学生", value: students.length, icon: Users },
              { label: "停用账户", value: archivedPeople.length, icon: Users },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex min-h-20 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
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
                className="bg-emerald-800 hover:bg-emerald-700"
                onClick={() => setPeopleManagerOpen(true)}
              >
                <Users className="size-4" />打开账户管理
              </Button>
            </div>
          </section>
        </TabsContent>

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
                  className="data-[state=checked]:bg-emerald-700"
                />
                {autoSave ? "已开启" : "已关闭"}
              </label>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
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
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
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
      </Tabs>

      <PeopleManager
        open={peopleManagerOpen}
        people={people}
        currentUserId={currentUserId}
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
              className="bg-emerald-800 hover:bg-emerald-700"
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
