import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { toPng } from "html-to-image";
import type { Person, Task, StudentProfile, FilterState, ProgressRecord, ProfileFieldDef, AppState, Class, Role, AttachmentMeta } from "@/types";
import { initialPeople, initialTasks, getColorForIndex, initialProfileFieldDefs } from "@/data";
import {
  getStats,
  encodeSyncData,
  decodeSyncData,
} from "@/utils";
import { api, ApiError, type AuthUser, type RemoteState } from "@/lib/api";
import { isProtectedFieldKey } from "@/lib/profileFields";

let nextTaskId = 100;
let nextProgressId = 1000;

function generateTaskId(): string {
  nextTaskId++;
  return `t${nextTaskId}`;
}

function generateProgressId(): string {
  nextProgressId++;
  return `ph${nextProgressId}`;
}

/** 水合后同步 ID 计数器到已有最大号，避免新建任务/记录撞出重复 id */
function syncIdCounters(tasks: Task[]): void {
  let maxTask = nextTaskId;
  let maxProgress = nextProgressId;
  for (const task of tasks) {
    const match = /^t(\d+)$/.exec(task.id);
    if (match) maxTask = Math.max(maxTask, Number(match[1]));
    for (const record of task.progressHistory ?? []) {
      const progressMatch = /^ph(\d+)$/.exec(record.id);
      if (progressMatch) maxProgress = Math.max(maxProgress, Number(progressMatch[1]));
    }
  }
  nextTaskId = maxTask;
  nextProgressId = maxProgress;
}

// ============================================================
// Main state management hook
// ============================================================

export function useAppState(authUser: AuthUser | null, autoSave = true) {
  // -- Core state ------------------------------------------------
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const currentUserId = authUser?.personId ?? null;
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem("gantt-dark-mode") === "true");
  const [studentProfiles, setStudentProfiles] = useState<StudentProfile[]>([]);
  const [profileFieldDefs, setProfileFieldDefsState] = useState<ProfileFieldDef[]>(initialProfileFieldDefs);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // 账号停用 → 离线模式：可查看，保存被拦截
  const [accountDisabled, setAccountDisabled] = useState(authUser?.active === false);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  // 水合时填充，供 AI 完成后/窗口聚焦时刷新工作区复用
  const applyRemoteStateRef = useRef<(state: RemoteState) => void>(() => undefined);

  // -- 角色权限 --------------------------------------------------
  const isAdmin = authUser?.role === "admin";
  const isTeacher = authUser?.role === "teacher";
  const isManager = isAdmin || isTeacher;

  useEffect(() => {
    localStorage.setItem("gantt-dark-mode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    if (!authUser) {
      hydratedRef.current = false;
      return;
    }

    let active = true;
    hydratedRef.current = false;

    const applyState = (state: RemoteState) => {
      let people = state.people;
      // 管理者自身不在成员表时自动补一条（保证能建自己的任务、出现在负责人列表）
      if (
        (authUser.role === "admin" || authUser.role === "teacher") &&
        !people.some((p) => p.id === authUser.personId)
      ) {
        const colors = getColorForIndex(people.filter((p) => p.status !== "archived").length);
        people = [
          ...people,
          {
            id: authUser.personId,
            username: authUser.username,
            name: authUser.name,
            color: colors.color,
            lightColor: colors.lightColor,
            borderColor: colors.borderColor,
            textColor: "#FFFFFF",
            role: authUser.role,
            order: people.length,
            status: "active",
            classIds: [],
          },
        ];
      }
      setPeople(people);
      setTasks(state.tasks);
      syncIdCounters(state.tasks);
      setStudentProfiles(state.studentProfiles || []);
      setClasses(state.classes || []);
      // 服务端无预设字段（旧库）时兜底播种默认预设
      setProfileFieldDefsState(
        state.profileFieldDefs && state.profileFieldDefs.length
          ? state.profileFieldDefs
          : initialProfileFieldDefs
      );
    };
    applyRemoteStateRef.current = applyState;

    api.getState()
      .then(async ({ state }) => {
        if (state) {
          if (active) applyState(state);
          return;
        }
        if (authUser.role === "admin") {
          const seed: RemoteState = {
            people: initialPeople,
            tasks: initialTasks,
            studentProfiles: [],
            profileFieldDefs: initialProfileFieldDefs,
            classes: [],
          };
          await api.saveState(seed);
          if (active) applyState(seed);
          return;
        }
        throw new Error("系统尚未初始化，请先由教师登录");
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : "工作区加载失败");
      })
      .finally(() => {
        if (active) {
          hydratedRef.current = true;
          setLoading(false);
        }
      });

    return () => {
      active = false;
      hydratedRef.current = false;
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !hydratedRef.current || loadError || !autoSave || accountDisabled) {
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushWorkspaceRef.current();
    }, 650);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [authUser, people, tasks, studentProfiles, profileFieldDefs, classes, loadError, autoSave, accountDisabled]);

  // -- 工作区数据镜像 + 立即冲刷 --
  // 冲刷 = 把本地最新状态立即保存到服务器；关键写操作（增删成员）后立刻调用，
  // 不等 650ms 防抖，收窄"账号已建但成员条目未落盘"的幽灵窗口。
  const workspaceRef = useRef({ people, tasks, studentProfiles, profileFieldDefs, classes });
  useEffect(() => {
    workspaceRef.current = { people, tasks, studentProfiles, profileFieldDefs, classes };
  }, [people, tasks, studentProfiles, profileFieldDefs, classes]);

  // 刷新被"保存中"挡下时标记延后：保存一结束就补一次刷新，AI 的写入不丢
  const pendingRefreshRef = useRef(false);
  const refreshFromServerRef = useRef<() => Promise<void>>(async () => {});

  const flushWorkspace = useCallback(async (): Promise<boolean> => {
    if (!authUser || !hydratedRef.current || loadError || !autoSave || accountDisabled) {
      return false;
    }
    if (savingRef.current) return false;
    setSyncStatus("saving");
    savingRef.current = true;
    try {
      await api.saveState(workspaceRef.current);
      setSyncStatus("saved");
      return true;
    } catch (error) {
      console.error("Unable to save workspace", error);
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        error.message.includes("停用")
      ) {
        // 管理员刚停用了本账号：切换到离线模式（只读）
        setAccountDisabled(true);
      }
      setSyncStatus("error");
      return false;
    } finally {
      savingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refreshFromServerRef.current();
      }
    }
  }, [authUser, loadError, autoSave, accountDisabled]);

  const flushWorkspaceRef = useRef(flushWorkspace);
  useEffect(() => {
    flushWorkspaceRef.current = flushWorkspace;
  }, [flushWorkspace]);

  // -- 工作区刷新：AI 直接写库后（或窗口重新聚焦时）重拉服务端状态，
  //    避免本地旧状态自动保存覆盖掉 AI 的修改 --
  // 注意：刷新前必须先把未落盘的本地修改冲刷到服务器，
  // 否则刚新增的成员/任务会被拉回来的旧状态吞掉（幽灵账号 bug 的根因）。
  const refreshFromServer = useCallback(async () => {
    if (!authUser || !hydratedRef.current || loadError) return;
    if (savingRef.current) {
      // 有保存在途：标记延后，保存完成后（finally）自动补刷新
      pendingRefreshRef.current = true;
      return;
    }
    const hadPending = saveTimerRef.current !== null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (hadPending) {
      const ok = await flushWorkspaceRef.current();
      if (!ok) return; // 冲刷失败不刷新，避免旧状态覆盖本地修改
    }
    try {
      const { state } = await api.getState();
      if (state) applyRemoteStateRef.current(state);
    } catch {
      // 拉取失败保持现状，下次事件再试
    }
  }, [authUser, loadError]);

  useEffect(() => {
    refreshFromServerRef.current = refreshFromServer;
  }, [refreshFromServer]);

  useEffect(() => {
    const handler = () => {
      void refreshFromServer();
    };
    window.addEventListener("gantt:ai-updated", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("gantt:ai-updated", handler);
      window.removeEventListener("focus", handler);
    };
  }, [refreshFromServer]);

  // -- 管理员/老师勾选学生（主页学生专属卡片，跨任务/表格共享）--
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  // people 加载后默认全选（当前为空才填充；"一键清空"后不自动恢复）
  useEffect(() => {
    const studentIds = people
      .filter((p) => p.role === "student" && p.status !== "archived")
      .map((p) => p.id);
    let defaultIds: string[] = [];
    if (isAdmin) {
      defaultIds = studentIds;
    } else if (isTeacher) {
      // 老师只默认勾选自己创建的学生
      defaultIds = studentIds.filter((id) => {
        const s = people.find((p) => p.id === id);
        return s?.createdBy === currentUserId;
      });
    }
    // 管理者本人也是一等选择项：默认与自己的学生一起勾选（自己的任务可管理/可切换显示）
    if (isManager && currentUserId) {
      defaultIds = [currentUserId, ...defaultIds];
    }
    if (selectedStudentIds.length === 0 && defaultIds.length > 0) {
      setSelectedStudentIds(defaultIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  // -- Filters ---------------------------------------------------
  const [filters, setFilters] = useState<FilterState>({
    statusFilter: "all",
    viewMode: "day",
    keyword: "",
    statsView: "cards",
  });

  // -- Computed --------------------------------------------------
  const currentUser = useMemo(
    () => people.find((p) => p.id === currentUserId) || null,
    [people, currentUserId]
  );

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    // STUDENT: can ONLY see their own tasks
    if (currentUser?.role === "student") {
      result = result.filter((t) => t.assigneeId === currentUserId);
    }
    // ADMIN/TEACHER: see all tasks, then filter by selected students

    // 按勾选成员过滤（管理者本人与学生对称：勾选谁就显示谁的任务）
    if (isManager) {
      const selected = new Set(selectedStudentIds);
      result = result.filter((t) => selected.has(t.assigneeId));
    }

    // Status filter
    if (filters.statusFilter === "active") {
      result = result.filter((t) => t.progress < 100);
    } else if (filters.statusFilter === "completed") {
      result = result.filter((t) => t.progress >= 100);
    }

    // Keyword filter
    if (filters.keyword.trim()) {
      const kw = filters.keyword.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(kw) ||
          t.description.toLowerCase().includes(kw) ||
          t.detail.currentProgress.toLowerCase().includes(kw) ||
          t.detail.mainProblems.toLowerCase().includes(kw) ||
          t.detail.solutions.toLowerCase().includes(kw)
      );
    }

    return result;
  }, [tasks, filters, currentUser, currentUserId, isManager, selectedStudentIds]);

  const stats = useMemo(() => getStats(tasks), [tasks]);

  // -- Task actions ----------------------------------------------

  const addTask = useCallback(
    (task: Omit<Task, "id" | "order" | "progressHistory" | "isMilestone" | "archivedAt">) => {
      const newTask: Task = {
        ...task,
        id: generateTaskId(),
        order: tasks.length,
        isMilestone: false,
        progressHistory: [],
        archivedAt: task.progress >= 100 ? new Date().toISOString().split("T")[0] : undefined,
      };
      setTasks((prev) => [...prev, newTask]);
    },
    [tasks.length, setTasks]
  );

  const updateTask = useCallback(
    (id: string, updates: Partial<Task>) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    [setTasks]
  );

  const deleteTask = useCallback(
    (id: string) => {
      setTasks((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        // Re-order remaining tasks
        return filtered.map((t, i) => ({ ...t, order: i }));
      });
    },
    [setTasks]
  );

  const reorderTasks = useCallback(
    (taskIds: string[]) => {
      setTasks((previous) => {
        const visibleIds = new Set(taskIds);
        const visibleTasks = new Map(
          taskIds
            .map((id) => previous.find((task) => task.id === id))
            .filter((task): task is Task => Boolean(task))
            .map((task) => [task.id, task])
        );
        let visibleIndex = 0;
        return previous.map((task) => {
          if (!visibleIds.has(task.id)) return task;
          const replacement = visibleTasks.get(taskIds[visibleIndex]);
          visibleIndex += 1;
          return replacement ? { ...replacement, order: task.order } : task;
        });
      });
    },
    []
  );

  const addProgressRecord = useCallback(
    (
      taskId: string,
      record: {
        currentProgress: string;
        mainProblems: string;
        solutions: string;
        author: string;
        authorId: string;
        attachments: AttachmentMeta[];
      }
    ) => {
      const newRecord: ProgressRecord = {
        ...record,
        id: generateProgressId(),
        date: new Date().toISOString().split("T")[0],
        replies: [],
      };
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                progressHistory: [...t.progressHistory, newRecord],
                detail: {
                  currentProgress: record.currentProgress || t.detail.currentProgress,
                  mainProblems: record.mainProblems || t.detail.mainProblems,
                  solutions: record.solutions || t.detail.solutions,
                },
              }
            : t
        )
      );
    },
    [setTasks]
  );

  const addProgressReply = useCallback(
    (
      taskId: string,
      recordId: string,
      content: string,
      authorId: string,
      authorName: string,
      attachments: AttachmentMeta[] = []
    ) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                progressHistory: t.progressHistory.map((ph) =>
                  ph.id === recordId
                    ? {
                        ...ph,
                        replies: [
                          ...(ph.replies || []),
                          {
                            id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            date: new Date().toISOString().split("T")[0],
                            author: authorName,
                            authorId,
                            content,
                            attachments,
                          },
                        ],
                      }
                    : ph
                ),
              }
            : t
        )
      );
    },
    [setTasks]
  );

  const autoArchiveCompleted = useCallback(
    (taskId: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId && t.progress >= 100 && !t.archivedAt
            ? { ...t, archivedAt: new Date().toISOString().split("T")[0] }
            : t
        )
      );
    },
    [setTasks]
  );

  const setTaskRating = useCallback(
    (taskId: string, rating: number) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, rating } : t))
      );
    },
    [setTasks]
  );

  // -- Person actions --------------------------------------------

  const addPerson = useCallback(
    async (account: {
      username: string;
      name: string;
      role: Role;
      password: string;
      classIds?: string[];
      phone?: string;
    }) => {
      const activePeople = people.filter((p) => p.status !== "archived");
      const index = activePeople.length;
      const colors = getColorForIndex(index);
      const personId = `p${Date.now()}`;
      await api.createUser({ personId, ...account });
      const newPerson: Person = {
        id: personId,
        username: account.username,
        name: account.name,
        color: colors.color,
        lightColor: colors.lightColor,
        borderColor: colors.borderColor,
        textColor: "#FFFFFF",
        role: account.role,
        order: index,
        status: "active",
        classIds: account.classIds || [],
        createdBy: currentUserId || undefined,
      };
      setPeople((prev) => [...prev, newPerson]);
      // 立即冲刷：账号已在 users 表落盘，成员条目必须马上持久化，
      // 收窄"窗口期事件吞掉待保存状态"造成幽灵账号的窗口
      await new Promise((resolve) => setTimeout(resolve, 50)); // 等 workspaceRef 镜像同步
      void flushWorkspaceRef.current();
    },
    [people, setPeople, currentUserId]
  );

  const deletePerson = useCallback(
    async (id: string) => {
      // 先把本地移除并冲刷到服务器，确认成功后再删账号——
      // 顺序反了的话：一旦 payload 保存失败而 users 行已删，
      // 后续所有保存都会 422（存在未注册账户），保存永久卡死
      const removedPerson = people.find((p) => p.id === id) ?? null;
      const removedTasks = tasks.filter((t) => t.assigneeId === id);
      setTasks((prev) => prev.filter((t) => t.assigneeId !== id));
      setPeople((prev) => prev.filter((p) => p.id !== id));
      await new Promise((resolve) => setTimeout(resolve, 50)); // 等 workspaceRef 镜像同步
      const saved = await flushWorkspaceRef.current();
      if (!saved && autoSave) {
        // 冲刷失败（网络等）：恢复本地状态，避免界面与服务器不一致；用户稍后重试
        if (removedPerson) {
          setPeople((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, removedPerson]));
        }
        if (removedTasks.length) {
          setTasks((prev) => [...prev, ...removedTasks]);
        }
        throw new Error("网络异常，成员数据尚未同步，请稍后重试删除");
      }
      await api.deleteUser(id);
    },
    [people, tasks, setPeople, setTasks, autoSave]
  );

  const updatePerson = useCallback(
    (personId: string, updates: Partial<Person>) => {
      setPeople((prev) =>
        prev.map((p) => (p.id === personId ? { ...p, ...updates } : p))
      );
    },
    [setPeople]
  );

  const updateAccount = useCallback(
    async (
      personId: string,
      updates: { username: string; name: string; phone?: string | null }
    ) => {
      await api.updateUser(personId, updates);
      setPeople((prev) =>
        prev.map((person) =>
          person.id === personId ? { ...person, ...updates } : person
        )
      );
    },
    []
  );

  const setPersonPassword = useCallback(
    (personId: string, password: string) => api.resetPassword(personId, password),
    []
  );

  const toggleArchivePerson = useCallback(
    (id: string, status: "active" | "archived") => {
      setPeople((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status } : p))
      );
    },
    [setPeople]
  );

  const reorderPeople = useCallback(
    (personIds: string[]) => {
      setPeople((prev) => {
        const personMap = new Map(prev.map((p) => [p.id, p]));
        const reordered: Person[] = [];
        personIds.forEach((id, i) => {
          const p = personMap.get(id);
          if (p) {
            reordered.push({ ...p, order: i });
          }
        });
        // Append any people not in the new order
        prev.forEach((p) => {
          if (!personIds.includes(p.id)) {
            reordered.push(p);
          }
        });
        return reordered;
      });
    },
    [setPeople]
  );

  // -- Data import/export ----------------------------------------

  const resetData = useCallback(() => {
    setPeople(initialPeople);
    setTasks(initialTasks);
    setStudentProfiles([]);
    setProfileFieldDefsState(initialProfileFieldDefs);
    setClasses([]);
    setFilters({
      statusFilter: "all",
      viewMode: "day",
      keyword: "",
      statsView: "cards",
    });
  }, [setPeople, setTasks, setStudentProfiles]);

  const exportToJson = useCallback(() => {
    const data = {
      people,
      tasks,
      currentUserId,
      darkMode,
      studentProfiles,
      profileFieldDefs,
      classes,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gantt-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [people, tasks, currentUserId, darkMode, studentProfiles, profileFieldDefs, classes]);

  const importFromJson = useCallback(
    (json: string) => {
      try {
        const data = JSON.parse(json);
        if (data.people) setPeople(data.people);
        if (data.tasks) setTasks(data.tasks);
        if (data.studentProfiles) setStudentProfiles(data.studentProfiles);
        if (data.profileFieldDefs) setProfileFieldDefsState(data.profileFieldDefs);
        if (data.classes) setClasses(data.classes);
        if (data.darkMode !== undefined) setDarkMode(data.darkMode);
        return true;
      } catch {
        return false;
      }
    },
    [setPeople, setTasks, setStudentProfiles, setProfileFieldDefsState, setClasses, setDarkMode]
  );

  const exportImage = useCallback(async (element: HTMLElement) => {
    try {
      const dataUrl = await toPng(element, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `gantt-${new Date().toISOString().split("T")[0]}.png`;
      a.click();
      return true;
    } catch {
      return false;
    }
  }, []);

  const generateSyncCode = useCallback(
    (target?: string | "all"): string => {
      if (!currentUser) return "";

      const targetId = target || currentUser.id;

      if (isAdmin && targetId === "all") {
        // Admin full backup
        return encodeSyncData({
          v: 3,
          fromRole: "admin",
          fromPersonId: currentUser.id,
          timestamp: Date.now(),
          people,
          tasks,
          studentProfiles: studentProfiles || [],
        });
      }

      // Export ONLY the target person's data
      const targetPerson = people.find(p => p.id === targetId);
      if (!targetPerson) return "";

      return encodeSyncData({
        v: 3,
        fromRole: targetPerson.role,
        fromPersonId: targetId,
        timestamp: Date.now(),
        people: [targetPerson],
        tasks: tasks.filter(t => t.assigneeId === targetId),
        studentProfiles: (studentProfiles || []).filter(sp => sp.personId === targetId),
      });
    },
    [isAdmin, currentUser, people, tasks, studentProfiles]
  );

  const importSyncCode = useCallback(
    (code: string): boolean => {
      const syncData = decodeSyncData(code);
      if (!syncData) return false;

      const incomingPeople = syncData.people || [];
      const incomingTasks = syncData.tasks || [];
      const incomingProfiles = syncData.studentProfiles || [];

      // Determine if we should reassign tasks to current user
      const shouldReassign = !isAdmin && currentUser;
      const targetPersonId = shouldReassign ? currentUser.id : null;

      // ── Build personId map: incoming personId -> local personId ──
      const personIdMap: Record<string, string> = {};
      for (const incoming of incomingPeople) {
        const localPerson = people.find(
          p => p.name === incoming.name && p.role === incoming.role
        );
        if (localPerson && localPerson.id !== incoming.id) {
          personIdMap[incoming.id] = localPerson.id;
        }
      }

      // Helper: map a personId to local personId
      const mapPersonId = (incomingPersonId: string): string => {
        if (shouldReassign && incomingPersonId === syncData.fromPersonId) {
          return targetPersonId!;
        }
        return personIdMap[incomingPersonId] || incomingPersonId;
      };

      // Import people: add or update, never delete
      setPeople(prev => {
        const next = [...prev];
        for (const incoming of incomingPeople) {
          const idx = next.findIndex(p => p.id === incoming.id);
          if (idx >= 0) {
            next[idx] = { ...next[idx], ...incoming };
          } else if (!shouldReassign) {
            // Admin: add new people
            next.push(incoming);
          }
          // Student: don't add new people (they already exist locally)
        }
        return next;
      });

      // Import tasks: merge by task ID, map assigneeId
      setTasks(prev => {
        const next = [...prev];
        for (const incoming of incomingTasks) {
          const idx = next.findIndex(t => t.id === incoming.id);
          const mappedAssigneeId = mapPersonId(incoming.assigneeId);

          // Merge progress history
          const existingHistory = idx >= 0 ? next[idx].progressHistory : [];
          const incomingHistory = incoming.progressHistory || [];
          const historyMap = new Map(existingHistory.map(h => [h.id, h]));
          for (const h of incomingHistory) {
            if (!historyMap.has(h.id)) {
              historyMap.set(h.id, { ...h, replies: h.replies || [] });
            } else {
              const existing = historyMap.get(h.id)!;
              const replyMap = new Map((existing.replies || []).map(r => [r.id, r]));
              for (const ir of h.replies || []) {
                if (!replyMap.has(ir.id)) replyMap.set(ir.id, ir);
              }
              historyMap.set(h.id, {
                ...h,
                replies: Array.from(replyMap.values()),
              });
            }
          }

          const mergedTask = {
            ...incoming,
            assigneeId: mappedAssigneeId,
            progressHistory: Array.from(historyMap.values()),
          };

          if (idx >= 0) {
            next[idx] = mergedTask;
          } else {
            next.push(mergedTask);
          }
        }
        return next;
      });

      // Import profiles: merge by personId (with mapping)
      setStudentProfiles(prev => {
        const next = prev.length > 0 ? [...prev] : [];
        for (const incoming of incomingProfiles) {
          const mappedPersonId = mapPersonId(incoming.personId);
          const idx = next.findIndex(p => p.personId === mappedPersonId);
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              data: { ...next[idx].data, ...incoming.data },
              adminOnlyData: {
                fields: incoming.adminOnlyData?.fields || next[idx].adminOnlyData?.fields || [],
                values: { ...next[idx].adminOnlyData?.values, ...incoming.adminOnlyData?.values },
                note: incoming.adminOnlyData?.note || next[idx].adminOnlyData?.note || "",
              },
            };
          } else {
            next.push({
              ...incoming,
              personId: mappedPersonId,
              adminOnlyData: incoming.adminOnlyData || { fields: [], values: {}, note: "" },
            });
          }
        }
        return next;
      });

      return true;
    },
    [isAdmin, currentUser, people, setPeople, setTasks, setStudentProfiles]
  );

  // Student self-registration from sync code
  const registerFromSync = useCallback(
    (name: string, code: string): { success: boolean; personName?: string } => {
      // First decode the sync code to get the data
      const syncData = decodeSyncData(code);
      if (!syncData) {
        return { success: false };
      }

      // Create a new person for this student
      const newPersonId = `p${Date.now()}`;
      const activeCount = people.filter(p => p.status !== "archived" && p.role === "student").length;
      const colors = getColorForIndex(activeCount);
      const newPerson: Person = {
        id: newPersonId,
        name,
        color: colors.color,
        lightColor: colors.lightColor,
        borderColor: colors.borderColor,
        textColor: "#FFFFFF",
        role: "student",
        order: activeCount,
        status: "active",
      };

      // Add the new person
      const updatedPeople = [...people, newPerson];
      setPeople(updatedPeople);

      // Merge tasks from sync code - reassign tasks that belong to the sync sender to this new person
      const mergedTasks = [...tasks];
      const incomingTasks = syncData.tasks || [];
      for (const incoming of incomingTasks) {
        const idx = mergedTasks.findIndex(t => t.id === incoming.id);
        if (idx >= 0) {
          // Merge progress history
          const existingHistory = mergedTasks[idx].progressHistory;
          const incomingHistory = incoming.progressHistory || [];
          const historyMap = new Map(existingHistory.map(h => [h.id, h]));
          for (const h of incomingHistory) {
            if (!historyMap.has(h.id)) {
              historyMap.set(h.id, { ...h, replies: h.replies || [] });
            }
          }
          mergedTasks[idx] = {
            ...mergedTasks[idx],
            assigneeId: newPersonId, // Reassign to the new student
            progressHistory: Array.from(historyMap.values()),
          };
        } else {
          // New task - reassign to the new person
          mergedTasks.push({
            ...incoming,
            assigneeId: newPersonId, // Reassign to the new student
            progressHistory: (incoming.progressHistory || []).map(h => ({
              ...h,
              replies: h.replies || [],
            })),
          });
        }
      }
      setTasks(mergedTasks);

      // Import profile data from sync code (if any)
      // The sync code may contain 1 person's data (the sender).
      // Import ANY profile found in the sync code.
      const syncProfiles = syncData.studentProfiles || [];
      const incomingProfile = syncProfiles.length > 0 ? syncProfiles[0] : null;

      // Create a profile for the new student with imported data
      const newProfile: StudentProfile = {
        personId: newPersonId,
        personName: name,
        data: incomingProfile?.data || {},
        adminOnlyData: {
          fields: incomingProfile?.adminOnlyData?.fields || [],
          values: incomingProfile?.adminOnlyData?.values || {},
          note: incomingProfile?.adminOnlyData?.note || "",
        },
      };
      const existingProfileIdx = (studentProfiles || []).findIndex(sp => sp.personId === newPersonId);
      if (existingProfileIdx >= 0) {
        setStudentProfiles((prev) => prev.map((p, i) => i === existingProfileIdx ? newProfile : p));
      } else {
        setStudentProfiles((prev) => [...prev, newProfile]);
      }

      return { success: true, personName: name };
    },
    [people, tasks, studentProfiles, setPeople, setTasks, setStudentProfiles]
  );

  // -- Student profile actions -----------------------------------

  const updateProfile = useCallback(
    (profile: StudentProfile) => {
      setStudentProfiles((prev) => {
        const idx = prev.findIndex((p) => p.personId === profile.personId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = profile;
          return next;
        }
        return [...prev, profile];
      });
    },
    [setStudentProfiles]
  );

  const updateProfileAdminData = useCallback(
    (personId: string, updates: { fields?: ProfileFieldDef[]; values?: Record<string, string>; note?: string }) => {
      setStudentProfiles((prev) => {
        const idx = prev.findIndex((p) => p.personId === personId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            adminOnlyData: {
              fields: updates.fields || next[idx].adminOnlyData?.fields || [],
              values: updates.values !== undefined
                ? { ...next[idx].adminOnlyData?.values, ...updates.values }
                : (next[idx].adminOnlyData?.values || {}),
              note: updates.note !== undefined ? updates.note : (next[idx].adminOnlyData?.note || ""),
            },
          };
          return next;
        }
        // Profile does not exist: create a new one
        const person = people.find(p => p.id === personId);
        const newProfile: StudentProfile = {
          personId,
          personName: person?.name || "",
          data: {},
          adminOnlyData: {
            fields: updates.fields || [],
            values: updates.values || {},
            note: updates.note !== undefined ? updates.note : "",
          },
        };
        return [...prev, newProfile];
      });
    },
    [setStudentProfiles, people]
  );

  const reorderProfileFields = useCallback(
    (personId: string, fieldKeys: string[]) => {
      setStudentProfiles((prev) => {
        const idx = prev.findIndex((p) => p.personId === personId);
        if (idx < 0) return prev;
        const profile = prev[idx];
        const currentFields = profile.adminOnlyData?.fields || [];
        const fieldMap = new Map(currentFields.map(f => [f.key, f]));
        const reordered = fieldKeys.map(k => fieldMap.get(k)).filter(Boolean) as ProfileFieldDef[];
        // Append any fields not in the new order
        currentFields.forEach(f => {
          if (!fieldKeys.includes(f.key)) reordered.push(f);
        });
        const next = [...prev];
        next[idx] = {
          ...profile,
          adminOnlyData: {
            ...profile.adminOnlyData,
            fields: reordered,
          },
        };
        return next;
      });
    },
    [setStudentProfiles]
  );

  const addProfileCategory = useCallback(
    (category: string) => {
      setStudentProfiles((prev) =>
        prev.map((p) => ({
          ...p,
          data: {
            ...p.data,
            [category]: p.data[category] ?? "",
          },
        }))
      );
    },
    [setStudentProfiles]
  );

  const removeProfileField = useCallback(
    (field: string) => {
      setStudentProfiles((prev) =>
        prev.map((p) => {
          const nextData = { ...p.data };
          delete nextData[field];
          return { ...p, data: nextData };
        })
      );
    },
    [setStudentProfiles]
  );

  // -- 全局预设字段管理（教师端）-----------------------------
  const addProfileFieldDef = useCallback((def: ProfileFieldDef): void => {
    setProfileFieldDefsState((prev) =>
      prev.some((field) => field.key === def.key) ? prev : [...prev, def]
    );
  }, []);

  const removeProfileFieldDef = useCallback((key: string): void => {
    // 学号等受保护字段不可删除
    if (isProtectedFieldKey(key)) return;
    // 删字段同时清理所有学生档案中该 key 的值（公开档案 data + 教师备注 values），避免残留孤儿
    setProfileFieldDefsState((prev) => prev.filter((field) => field.key !== key));
    setStudentProfiles((prev) =>
      prev.map((p) => {
        const nextData = { ...p.data };
        delete nextData[key];
        const adminValues = { ...(p.adminOnlyData?.values ?? {}) };
        delete adminValues[key];
        return {
          ...p,
          data: nextData,
          adminOnlyData: {
            fields: p.adminOnlyData?.fields ?? [],
            values: adminValues,
            note: p.adminOnlyData?.note ?? "",
          },
        };
      })
    );
  }, []);

  const addProfileFieldOption = useCallback((fieldKey: string, option: string): void => {
    const value = option.trim();
    if (!value) return;
    setProfileFieldDefsState((prev) =>
      prev.map((field) =>
        field.key === fieldKey && !(field.options ?? []).includes(value)
          ? { ...field, options: [...(field.options ?? []), value] }
          : field
      )
    );
  }, []);

  const removeProfileFieldOption = useCallback((fieldKey: string, option: string): void => {
    setProfileFieldDefsState((prev) =>
      prev.map((field) =>
        field.key === fieldKey && field.options
          ? { ...field, options: field.options.filter((o) => o !== option) }
          : field
      )
    );
    // 清理所有档案里恰好等于该选项的值
    setStudentProfiles((prev) =>
      prev.map((p) => {
        if (p.data[fieldKey] === option) {
          const nextData = { ...p.data };
          delete nextData[fieldKey];
          return { ...p, data: nextData };
        }
        return p;
      })
    );
  }, []);

  const setProfileFieldDefs = useCallback(
    (defs: ProfileFieldDef[]): void => setProfileFieldDefsState(defs),
    []
  );

  // -- 班级管理（admin/teacher）----------------------------------
  const addClass = useCallback((name: string): void => {
    const value = name.trim();
    if (!value) return;
    const cls: Class = {
      id: `c${Date.now()}`,
      name: value,
      teacherId: currentUserId || "",
    };
    setClasses((prev) => [...prev, cls]);
  }, [currentUserId]);

  const removeClass = useCallback((classId: string): void => {
    setClasses((prev) => prev.filter((c) => c.id !== classId));
    // 同时清掉学生身上该班级的归属
    setPeople((prev) =>
      prev.map((p) =>
        p.classIds?.includes(classId)
          ? { ...p, classIds: (p.classIds ?? []).filter((id) => id !== classId) }
          : p
      )
    );
  }, []);

  const renameClass = useCallback((classId: string, name: string): void => {
    setClasses((prev) =>
      prev.map((c) => (c.id === classId ? { ...c, name: name.trim() || c.name } : c))
    );
  }, []);

  const setClassMembers = useCallback((classId: string, memberIds: string[]): void => {
    const memberSet = new Set(memberIds);
    setPeople((prev) =>
      prev.map((p) => {
        if (p.role !== "student") return p;
        const has = p.classIds?.includes(classId) ?? false;
        if (memberSet.has(p.id) && !has) {
          return { ...p, classIds: [...(p.classIds ?? []), classId] };
        }
        if (!memberSet.has(p.id) && has) {
          return { ...p, classIds: (p.classIds ?? []).filter((id) => id !== classId) };
        }
        return p;
      })
    );
  }, []);

  // -- 权限 helper（供页面按角色控制）----------------------------
  const canAssignTasks = isManager;
  const canManageStudent = useCallback(
    (personId: string): boolean => {
      if (!isManager) return false;
      if (isAdmin) return true;
      const s = people.find((p) => p.id === personId);
      if (!s || s.role !== "student") return false;
      return s.createdBy === currentUserId;
    },
    [isManager, isAdmin, people, currentUserId]
  );
  const manageableStudentIds = useMemo(
    () =>
      people
        .filter((p) => p.role === "student" && canManageStudent(p.id))
        .map((p) => p.id),
    [people, canManageStudent]
  );

  // -- Dark mode on html element ---------------------------------
  const applyDarkMode = useCallback((dm: boolean) => {
    const root = document.documentElement;
    if (dm) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, []);

  // -- Import data (atomic update for sync) -----------------------
  const importData = useCallback(
    (data: Partial<AppState>) => {
      if (data.people) setPeople(data.people);
      if (data.tasks) setTasks(data.tasks);
      if (data.studentProfiles !== undefined) setStudentProfiles(data.studentProfiles);
      if (data.profileFieldDefs !== undefined) setProfileFieldDefsState(data.profileFieldDefs);
      if (data.classes !== undefined) setClasses(data.classes);
    },
    [setPeople, setTasks, setStudentProfiles, setProfileFieldDefsState, setClasses]
  );

  const flushSave = useCallback(async () => {
    if (!authUser || !hydratedRef.current || loadError) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSyncStatus("saving");
    try {
      await api.saveState({ people, tasks, studentProfiles, profileFieldDefs, classes });
      setSyncStatus("saved");
    } catch (error) {
      setSyncStatus("error");
      throw error;
    }
  }, [authUser, people, tasks, studentProfiles, profileFieldDefs, classes, loadError]);

  return {
    // State
    people,
    tasks,
    currentUser,
    currentUserId,
    isAdmin,
    darkMode,
    filters,
    filteredTasks,
    stats,
    studentProfiles,
    profileFieldDefs,
    classes,
    selectedStudentIds,
    isTeacher,
    isManager,
    canAssignTasks,
    manageableStudentIds,
    loading,
    loadError,
    accountDisabled,
    syncStatus,
    flushSave,

    // Setters
    setFilters,
    setDarkMode,
    applyDarkMode,
    setSelectedStudentIds,

    // Task actions
    addTask,
    updateTask,
    deleteTask,
    reorderTasks,
    addProgressRecord,
    addProgressReply,
    autoArchiveCompleted,
    setTaskRating,

    // Person actions
    addPerson,
    deletePerson,
    updatePerson,
    updateAccount,
    setPersonPassword,
    toggleArchivePerson,
    reorderPeople,

    // Data actions
    resetData,
    exportToJson,
    importFromJson,
    exportImage,
    generateSyncCode,
    importSyncCode,
    importData,
    registerFromSync,

    // Profile actions
    updateProfile,
    updateProfileAdminData,
    reorderProfileFields,
    addProfileCategory,
    removeProfileField,

    // 全局预设字段管理
    addProfileFieldDef,
    removeProfileFieldDef,
    addProfileFieldOption,
    removeProfileFieldOption,
    setProfileFieldDefs,

    // 班级管理
    addClass,
    removeClass,
    renameClass,
    setClassMembers,
    canManageStudent,
  };
}
