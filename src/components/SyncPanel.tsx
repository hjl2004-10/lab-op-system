import { useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  RefreshCw,
  Share2,
  UserCheck,
  UserCircle,
  Copy,
  CheckCircle,
  ClipboardPaste,
  AlertCircle,
} from "lucide-react";
import type { Person, Task, StudentProfile, ProgressRecord } from "@/types";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface SyncPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: Person[];
  tasks: Task[];
  studentProfiles: StudentProfile[];
  currentUserId: string | null;
  currentUserRole: "admin" | "member" | null;
  onImport: (data: { people?: Person[]; tasks?: Task[]; studentProfiles?: StudentProfile[] }) => void;
}

interface SyncPayload {
  v: number;
  fromRole: "admin" | "member";
  fromPersonId: string;
  fromPersonName: string;
  people: Person[];
  tasks: Task[];
  studentProfiles: StudentProfile[];
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function createMemberPayload(
  people: Person[],
  tasks: Task[],
  studentProfiles: StudentProfile[],
  myId: string
): SyncPayload {
  const myPerson = people.find((p) => p.id === myId);
  return {
    v: 2,
    fromRole: "member",
    fromPersonId: myId,
    fromPersonName: myPerson?.name || "",
    people: people.filter((p) => p.id === myId),
    tasks: tasks.filter((t) => t.assigneeId === myId),
    studentProfiles: studentProfiles.filter((sp) => sp.personId === myId),
  };
}

function createAdminPayloadForStudent(
  people: Person[],
  tasks: Task[],
  studentProfiles: StudentProfile[],
  studentId: string
): SyncPayload {
  return {
    v: 2,
    fromRole: "admin",
    fromPersonId: "admin",
    fromPersonName: "杨老师",
    people: people.filter((p) => p.id === studentId),
    tasks: tasks.filter((t) => t.assigneeId === studentId),
    studentProfiles: studentProfiles.filter((sp) => sp.personId === studentId),
  };
}

function createAdminFullPayload(
  people: Person[],
  tasks: Task[],
  studentProfiles: StudentProfile[]
): SyncPayload {
  const adminPerson = people.find((p) => p.role === "admin");
  return {
    v: 2,
    fromRole: "admin",
    fromPersonId: adminPerson?.id || "admin",
    fromPersonName: "杨老师",
    people: [...people],
    tasks: [...tasks],
    studentProfiles: [...studentProfiles],
  };
}

export function encodeSyncCode(payload: SyncPayload): string {
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

export function decodeSyncCode(code: string): SyncPayload | null {
  try {
    // Remove all whitespace (spaces, newlines, tabs)
    const cleanCode = code.replace(/\s/g, "");
    // Auto-fix missing base64 padding
    let padded = cleanCode;
    while (padded.length % 4 !== 0) {
      padded += "=";
    }
    const data = JSON.parse(
      decodeURIComponent(atob(padded))
    ) as SyncPayload;
    return data.v === 2 ? data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function SyncPanel({
  open,
  onOpenChange,
  people,
  tasks,
  studentProfiles,
  currentUserId,
  currentUserRole,
  onImport,
}: SyncPanelProps) {
  const [tab, setTab] = useState<"share" | "receive">("share");
  const [syncCode, setSyncCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importResultType, setImportResultType] = useState<
    "success" | "error" | "warning"
  >("success");
  const [shareMode, setShareMode] = useState<"student" | "full">("student");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const isAdmin = currentUserRole === "admin";
  const students = useMemo(
    () => people.filter((p) => p.role === "member"),
    [people]
  );

  // ----------------------------------------------------------------
  // Generate sync code
  // ----------------------------------------------------------------
  const generateCode = useCallback(() => {
    if (!currentUserId) return;
    let payload: SyncPayload;
    if (isAdmin) {
      if (shareMode === "student" && selectedStudentId) {
        payload = createAdminPayloadForStudent(people, tasks, studentProfiles, selectedStudentId);
      } else {
        payload = createAdminFullPayload(people, tasks, studentProfiles);
      }
    } else {
      payload = createMemberPayload(people, tasks, studentProfiles, currentUserId);
    }
    setSyncCode(encodeSyncCode(payload));
  }, [currentUserId, isAdmin, shareMode, selectedStudentId, people, tasks, studentProfiles]);

  // ----------------------------------------------------------------
  // Copy to clipboard
  // ----------------------------------------------------------------
  const copyToClipboard = useCallback(async () => {
    if (!syncCode) return;
    try {
      await navigator.clipboard.writeText(syncCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById(
        "sync-code-text"
      ) as HTMLTextAreaElement;
      if (el) {
        el.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [syncCode]);

  // ----------------------------------------------------------------
  // Paste from clipboard
  // ----------------------------------------------------------------
  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInputCode(text);
    } catch {
      setImportResult("无法访问剪贴板");
      setImportResultType("error");
    }
  }, []);

  // ----------------------------------------------------------------
  // Receive / Import
  // ----------------------------------------------------------------
  const handleReceive = useCallback(() => {
    if (!inputCode.trim()) {
      setImportResult("请输入同步码");
      setImportResultType("error");
      return;
    }

    let payload = decodeSyncCode(inputCode.trim()) as SyncPayload;
    if (!payload) {
      setImportResult("无效的同步码");
      setImportResultType("error");
      return;
    }

    // Step 1: build idMap and compute incomingIds
    // idMap: incoming personId -> local personId (by name+role match)
    const idMap: Record<string, string> = {};
    payload.people.forEach((ip: Person) => {
      const local = people.find(
        (p: Person) => p.name === ip.name && p.role === ip.role
      );
      if (local && local.id !== ip.id) {
        idMap[ip.id] = local.id;
      }
    });
    // incomingIds contains BOTH original ids and mapped local ids
    // so tasks with assigneeId=localId can be matched
    const incomingIds = new Set<string>();
    payload.people.forEach((p: Person) => {
      incomingIds.add(p.id);
      const mapped = idMap[p.id];
      if (mapped) incomingIds.add(mapped);
    });

    // Step 2: if current user is member, filter to only their data
    // Use idMap to handle cross-device personId differences
    if (currentUserRole === "member") {
      const myId = currentUserId || "";
      const filteredPeople = payload.people.filter(
        (p: Person) => p.id === myId || idMap[p.id] === myId
      );
      const filteredTasks = payload.tasks.filter(
        (t: Task) => t.assigneeId === myId || idMap[t.assigneeId] === myId
      );
      const filteredProfiles = payload.studentProfiles.filter(
        (sp: StudentProfile) => sp.personId === myId || idMap[sp.personId] === myId
      );
      if (filteredPeople.length === 0) {
        setImportResult("同步码中没有您的数据。请确认身份后重试。");
        setImportResultType("error");
        return;
      }
      payload = {
        ...payload,
        people: filteredPeople,
        tasks: filteredTasks,
        studentProfiles: filteredProfiles,
      };
    }

    // Step 3: merge people — keep local role, overwrite other fields
    const mergedPeople: Person[] = people.map((p: Person) => {
      const u = payload.people.find((ip: Person) => ip.id === p.id);
      return u ? { ...u, role: p.role } : p;
    });
    payload.people.forEach((ip: Person) => {
      if (!people.find((p: Person) => p.id === ip.id)) {
        // 按名字+角色匹配，避免创建重复角色
        const byName = people.find(
          (p: Person) => p.name === ip.name && p.role === ip.role
        );
        if (!byName) {
          mergedPeople.push(ip); // 只有真正的新人才添加
        }
        // 如果找到同名角色，不添加（数据已通过上面的 map 合并）
      }
    });

    // Step 4: merge tasks — only tasks whose assigneeId is in incomingIds
    const mergedTasks: Task[] = tasks.map((t: Task) => {
      if (!incomingIds.has(t.assigneeId)) return t;
      const u = payload.tasks.find((it: Task) => it.id === t.id);
      if (u) {
        // Merge progressHistory with Map dedup, sort by date desc
        const hm = new Map(
          (t.progressHistory || []).map((h: ProgressRecord) => [h.id, h])
        );
        (u.progressHistory || []).forEach((h: ProgressRecord) => {
          if (!hm.has(h.id)) hm.set(h.id, h);
        });
        return {
          ...u,
          assigneeId: t.assigneeId, // keep local assigneeId, do not overwrite with sender's personId
          progressHistory: Array.from(hm.values()).sort(
            (a: ProgressRecord, b: ProgressRecord) =>
              new Date(b.date).getTime() - new Date(a.date).getTime()
          ),
        };
      }
      return t;
    });
    payload.tasks.forEach((it: Task) => {
      if (!tasks.find((t: Task) => t.id === it.id)) {
        // Map assigneeId from incoming personId to local personId
        const mappedAssigneeId = idMap[it.assigneeId] || it.assigneeId;
        mergedTasks.push({
          ...it,
          assigneeId: mappedAssigneeId,
        });
      }
    });

    // Step 5: merge studentProfiles
    const mergedProfiles: StudentProfile[] = studentProfiles.map((sp) => {
      if (!incomingIds.has(sp.personId)) return sp;
      const u = payload.studentProfiles.find(
        (isp) => isp.personId === sp.personId
      );
      return u || sp;
    });
    payload.studentProfiles.forEach((isp: StudentProfile) => {
      const localPersonId = idMap[isp.personId] || isp.personId;
      if (!studentProfiles.find((sp) => sp.personId === localPersonId)) {
        mergedProfiles.push({
          ...isp,
          personId: localPersonId,
        });
      }
    });

    // Step 6: call onImport
    onImport({
      people: mergedPeople,
      tasks: mergedTasks,
      studentProfiles: mergedProfiles,
    });

    setImportResult("同步成功！已更新数据。");
    setImportResultType("success");
    setTimeout(() => {
      setImportResult(null);
      setInputCode("");
    }, 5000);
  }, [inputCode, currentUserRole, currentUserId, people, tasks, studentProfiles, onImport]);

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg dark:bg-slate-900 dark:border-slate-700">
        <DialogHeader>
          <DialogTitle className="dark:text-slate-100 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-sky-500" />
            数据同步
          </DialogTitle>
        </DialogHeader>

        {/* Tab switch */}
        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            onClick={() => {
              setTab("share");
              setSyncCode("");
            }}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
              tab === "share"
                ? "bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700"
            }`}
          >
            <Share2 className="w-3.5 h-3.5 inline mr-1" />
            分享数据
          </button>
          <button
            onClick={() => setTab("receive")}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
              tab === "receive"
                ? "bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-200"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700"
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 inline mr-1" />
            接收数据
          </button>
        </div>

        {/* Share tab */}
        {tab === "share" && (
          <div className="space-y-3">
            {/* Admin: share mode selection */}
            {isAdmin && (
              <div className="space-y-2">
                <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800/50 rounded">
                  <button
                    onClick={() => {
                      setShareMode("student");
                      setSyncCode("");
                    }}
                    className={`flex-1 py-1 px-2 rounded text-xs ${
                      shareMode === "student"
                        ? "bg-sky-500 text-white"
                        : "text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    分享给指定学生
                  </button>
                  <button
                    onClick={() => {
                      setShareMode("full");
                      setSyncCode("");
                    }}
                    className={`flex-1 py-1 px-2 rounded text-xs ${
                      shareMode === "full"
                        ? "bg-sky-500 text-white"
                        : "text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    全部数据（备份）
                  </button>
                </div>
                {shareMode === "student" && (
                  <div className="flex gap-2 flex-wrap">
                    {students.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedStudentId(s.id);
                          setSyncCode("");
                        }}
                        className={`px-2 py-1 rounded-full text-xs flex items-center gap-1 transition-all ${
                          selectedStudentId === s.id
                            ? "bg-slate-700 text-white"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                        }`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Member hint */}
            {!isAdmin && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 p-2 rounded">
                <UserCircle className="w-3.5 h-3.5" />
                您将分享<strong>仅属于您自己的数据</strong>。
              </div>
            )}

            {/* Admin selected student hint */}
            {isAdmin && shareMode === "student" && selectedStudentId && (
              <div className="text-xs text-slate-500 bg-sky-50 dark:bg-sky-900/20 p-2 rounded">
                将分享{" "}
                <strong>
                  {students.find((s) => s.id === selectedStudentId)?.name}
                </strong>{" "}
                的数据。
              </div>
            )}

            {/* Generate button or sync code display */}
            {!syncCode ? (
              <Button
                size="sm"
                onClick={generateCode}
                disabled={
                  isAdmin && shareMode === "student" && !selectedStudentId
                }
                className="w-full"
              >
                生成同步码
              </Button>
            ) : (
              <>
                <Textarea
                  id="sync-code-text"
                  value={syncCode}
                  readOnly
                  className="text-[10px] font-mono dark:bg-slate-800 dark:border-slate-700 h-28 resize-none"
                />
                <Button
                  size="sm"
                  onClick={copyToClipboard}
                  className="w-full gap-1"
                >
                  {copied ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" /> 已复制
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> 复制同步码
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Receive tab */}
        {tab === "receive" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              粘贴收到的同步码导入数据。
            </p>
            <Textarea
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="在此粘贴同步码..."
              className="text-xs font-mono dark:bg-slate-800 dark:border-slate-700 h-28"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={pasteFromClipboard}
                className="flex-1 gap-1"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                从剪贴板粘贴
              </Button>
              <Button
                size="sm"
                onClick={handleReceive}
                className="flex-1"
              >
                开始同步
              </Button>
            </div>
            {importResult && (
              <div
                className={`text-xs flex items-center gap-1 ${
                  importResultType === "success"
                    ? "text-emerald-500"
                    : "text-red-500"
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                {importResult}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
