import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { toPng } from "html-to-image";
import type { Person, Task, StudentProfile, FilterState, ProgressRecord, ProfileFieldDef, AppState, Class, Role } from "@/types";
import { initialPeople, initialTasks, getColorForIndex, initialProfileFieldDefs } from "@/data";
import {
  getStats,
  encodeSyncData,
  decodeSyncData,
} from "@/utils";
import { api, type AuthUser, type RemoteState } from "@/lib/api";
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
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setPeople(state.people);
      setTasks(state.tasks);
      setStudentProfiles(state.studentProfiles || []);
      setClasses(state.classes || []);
      // 服务端无预设字段（旧库）时兜底播种默认预设
      setProfileFieldDefsState(
        state.profileFieldDefs && state.profileFieldDefs.length
          ? state.profileFieldDefs
          : initialProfileFieldDefs
      );
    };

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
    if (!authUser || !hydratedRef.current || loadError || !autoSave) {
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSyncStatus("saving");
      api.saveState({ people, tasks, studentProfiles, profileFieldDefs, classes })
        .then(() => setSyncStatus("saved"))
        .catch((error) => {
          console.error("Unable to save workspace", error);
          setSyncStatus("error");
        });
    }, 650);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [authUser, people, tasks, studentProfiles, profileFieldDefs, classes, loadError, autoSave]);

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

    // 按勾选学生过滤（本人任务始终可见）
    if (isManager) {
      const selected = new Set(selectedStudentIds);
      result = result.filter(
        (t) => t.assigneeId === currentUserId || selected.has(t.assigneeId)
      );
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
    (taskId: string, record: { currentProgress: string; mainProblems: string; solutions: string; author: string; authorId: string }) => {
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
    (taskId: string, recordId: string, content: string, authorId: string, authorName: string) => {
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
    },
    [people, setPeople, currentUserId]
  );

  const deletePerson = useCallback(
    async (id: string) => {
      await api.deleteUser(id);
      // Also delete all tasks assigned to this person
      setTasks((prev) => prev.filter((t) => t.assigneeId !== id));
      setPeople((prev) => prev.filter((p) => p.id !== id));
    },
    [setPeople, setTasks]
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
    async (personId: string, updates: { username: string; name: string }) => {
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
