import { useState, useEffect, useRef, useCallback } from "react";
import { useAppState } from "@/hooks/useAppState";
import { holidays } from "@/data";
import type { Task } from "@/types";

import UserSelector from "@/components/UserSelector";
import StatsPanel from "@/components/StatsPanel";
import Toolbar from "@/components/Toolbar";
import PeopleFilter from "@/components/PeopleFilter";
import TaskList from "@/components/TaskList";
import Timeline from "@/components/Timeline";
import TaskEditDialog from "@/components/TaskEditDialog";
import PeopleManager from "@/components/PeopleManager";
import HistoryPanel from "@/components/HistoryPanel";
import StudentProfilePanel from "@/components/StudentProfilePanel";
import SyncPanel from "@/components/SyncPanel";

export default function App() {
  const state = useAppState();

  // Apply dark mode class on html element
  useEffect(() => {
    if (state.darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [state.darkMode]);

  // Dialog visibility states
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showPeopleManager, setShowPeopleManager] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [statsViewMode, setStatsViewMode] = useState<"cards" | "charts">("cards");
  const [showArchived, setShowArchived] = useState(false);

  // Sync panel state
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  // Add task form state
  const [newTask, setNewTask] = useState({
    name: "",
    assigneeId: state.isAdmin
      ? (state.people.find((p) => p.role === "member")?.id || "")
      : (state.currentUserId || ""),
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
    progress: 0,
    description: "",
  });

  const taskListRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Sync scroll between task list and timeline
  const handleTaskListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  const handleTimelineScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (taskListRef.current) {
      taskListRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  // Get current user name for task edit dialog
  const currentUserName = state.currentUser?.name || "";

  // Handle task add
  const handleAddTask = useCallback(() => {
    if (!newTask.name.trim()) return;
    state.addTask({
      name: newTask.name.trim(),
      assigneeId: newTask.assigneeId,
      startDate: newTask.startDate,
      endDate: newTask.endDate,
      progress: newTask.progress,
      description: newTask.description,
      detail: {
        currentProgress: "",
        mainProblems: "",
        solutions: "",
      },
      rating: 0,
    });
    setShowAddTask(false);
    setNewTask({
      name: "",
      assigneeId: state.isAdmin
        ? (state.people.find((p) => p.role === "member")?.id || "")
        : (state.currentUserId || ""),
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      progress: 0,
      description: "",
    });
  }, [newTask, state]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* User selector dialog */}
      <UserSelector
        open={!state.currentUserId}
        people={state.people}
        onSelect={(id) => state.setCurrentUserId(id)}
        onPasswordCheck={state.checkPassword}
        onInitStudent={(name, syncCode) => {
          const result = state.registerFromSync(name, syncCode);
          return result;
        }}
      />

      {/* Main content - only show when user is selected */}
      {state.currentUserId && (
        <>
          {/* Stats Panel */}
          {showStats && (
            <StatsPanel
              stats={state.stats}
              isAdmin={state.isAdmin}
              currentUserId={state.currentUserId}
              selectedPersonId={state.isAdmin ? undefined : state.currentUserId}
              onPersonSelect={(id) => {
                // Admin selects a person to view stats
                state.setFilters(prev => ({ ...prev, assigneeFilter: id === "all" ? "all" : id }));
              }}
              people={state.people}
              viewMode={statsViewMode}
              onViewModeChange={setStatsViewMode}
              tasks={state.tasks}
            />
          )}

          {/* Toolbar */}
          <Toolbar
            isAdmin={state.isAdmin}
            onAddTask={() => setShowAddTask(true)}
            onReset={() => {
              if (window.confirm("确定要重置所有数据吗？此操作不可恢复。")) {
                state.resetData();
              }
            }}
            onExportJson={state.exportToJson}
            onImportJson={state.importFromJson}
            onExportImage={() => {
              const el = document.getElementById("gantt-chart");
              if (el) state.exportImage(el);
            }}
            onToggleHistory={() => setShowHistory((v) => !v)}
            onToggleStats={() => setShowStats((v) => !v)}
            onToggleProfiles={() => setShowProfiles((v) => !v)}
            onManagePeople={() => setShowPeopleManager(true)}
            onOpenSync={() => setShowSyncPanel(true)}
            darkMode={state.darkMode}
            onToggleDarkMode={() => state.setDarkMode(!state.darkMode)}
            autoSave={autoSave}
            onToggleAutoSave={() => setAutoSave((v) => !v)}
            keyword={state.filters.keyword}
            onKeywordChange={(k) =>
              state.setFilters((prev) => ({ ...prev, keyword: k }))
            }
          />

          {/* People Filter */}
          <PeopleFilter
            people={state.people}
            tasks={state.tasks}
            currentFilter={state.filters.assigneeFilter}
            onFilterChange={(f) =>
              state.setFilters((prev) => ({ ...prev, assigneeFilter: f }))
            }
            viewMode={state.filters.viewMode}
            onViewModeChange={(m) =>
              state.setFilters((prev) => ({ ...prev, viewMode: m }))
            }
            statusFilter={state.filters.statusFilter}
            onStatusFilterChange={(f) =>
              state.setFilters((prev) => ({ ...prev, statusFilter: f }))
            }
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
          />

          {/* Gantt chart area */}
          <div
            id="gantt-chart"
            className="flex border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800"
            style={{ height: "500px" }}
          >
            <div
              ref={taskListRef}
              className="shrink-0 overflow-y-auto"
              style={{ width: "260px" }}
              onScroll={handleTaskListScroll}
            >
              <TaskList
                tasks={state.filteredTasks}
                people={state.people}
                currentUserId={state.currentUserId}
                isAdmin={state.isAdmin}
                onTaskClick={(task) => setEditingTask(task)}
                onReorder={state.reorderTasks}
                onDeleteTask={state.deleteTask}
              />
            </div>
            <div
              ref={timelineRef}
              className="flex-1 overflow-auto"
              onScroll={handleTimelineScroll}
            >
              <Timeline
                tasks={state.filteredTasks}
                people={state.people}
                viewMode={state.filters.viewMode}
                holidays={holidays}
                onTaskClick={(task) => setEditingTask(task)}
              />
            </div>
          </div>

          {/* Task edit dialog */}
          <TaskEditDialog
            open={!!editingTask}
            task={editingTask}
            people={state.people}
            isAdmin={state.isAdmin}
            currentUserId={state.currentUserId}
            currentUserName={currentUserName}
            onOpenChange={(open) => {
              if (!open) setEditingTask(null);
            }}
            onSave={(taskId, updates) => {
              state.updateTask(taskId, updates);
              if (updates.progress && updates.progress >= 100) {
                state.autoArchiveCompleted(taskId);
              }
              setEditingTask(null);
            }}
            onDelete={(taskId) => {
              state.deleteTask(taskId);
              setEditingTask(null);
            }}
            onAddProgressRecord={(taskId, record) =>
              state.addProgressRecord(taskId, {
                ...record,
                author: currentUserName,
                authorId: state.currentUserId || "",
              })
            }
            onAddProgressReply={state.addProgressReply}
            onSetRating={state.setTaskRating}
          />

          {/* People manager dialog */}
          <PeopleManager
            open={showPeopleManager}
            people={state.people}
            onOpenChange={setShowPeopleManager}
            onAdd={state.addPerson}
            onDelete={state.deletePerson}
            onSetPassword={state.setPersonPassword}
            onReorder={state.reorderPeople}
            onArchive={state.toggleArchivePerson}
            onGenerateSyncCode={(personId) => state.generateSyncCode(personId)}
          />

          {/* History panel */}
          <HistoryPanel
            open={showHistory}
            tasks={state.isAdmin ? state.tasks : state.tasks.filter(t => t.assigneeId === state.currentUserId)}
            people={state.people}
            isAdmin={state.isAdmin}
            onOpenChange={setShowHistory}
          />

          {/* Student profile panel */}
          <StudentProfilePanel
            open={showProfiles}
            people={state.people}
            profiles={state.studentProfiles || []}
            isAdmin={state.isAdmin}
            currentUserId={state.currentUserId}
            onOpenChange={setShowProfiles}
            onUpdateProfile={state.updateProfile}
            onUpdateProfileAdminData={state.updateProfileAdminData}
            onReorderProfileFields={state.reorderProfileFields}
            onAddCategory={state.addProfileCategory}
            onRemoveField={state.removeProfileField}
          />

          {/* Add task dialog */}
          {showAddTask && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => setShowAddTask(false)}
            >
              <div
                className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 w-[480px]"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">
                  新增任务
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      任务名称
                    </label>
                    <input
                      type="text"
                      value={newTask.name}
                      onChange={(e) =>
                        setNewTask((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100"
                      placeholder="输入任务名称"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      负责人
                    </label>
                    <select
                      value={newTask.assigneeId}
                      onChange={(e) =>
                        setNewTask((prev) => ({
                          ...prev,
                          assigneeId: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100"
                    >
                      {(state.isAdmin
                        ? state.people.filter((p) => p.status === "active")
                        : state.people.filter((p) => p.id === state.currentUserId)
                      ).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        开始日期
                      </label>
                      <input
                        type="date"
                        value={newTask.startDate}
                        onChange={(e) =>
                          setNewTask((prev) => ({
                            ...prev,
                            startDate: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                        结束日期
                      </label>
                      <input
                        type="date"
                        value={newTask.endDate}
                        onChange={(e) =>
                          setNewTask((prev) => ({
                            ...prev,
                            endDate: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      进度 ({newTask.progress}%)
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={newTask.progress}
                      onChange={(e) =>
                        setNewTask((prev) => ({
                          ...prev,
                          progress: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      备注
                    </label>
                    <textarea
                      value={newTask.description}
                      onChange={(e) =>
                        setNewTask((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 min-h-[60px]"
                      placeholder="输入备注..."
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleAddTask}
                    className="flex-1 px-4 py-2 rounded-md bg-sky-500 text-white text-sm hover:bg-sky-600"
                  >
                    添加
                  </button>
                  <button
                    onClick={() => setShowAddTask(false)}
                    className="flex-1 px-4 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-300"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sync Panel */}
          <SyncPanel
            open={showSyncPanel}
            onOpenChange={setShowSyncPanel}
            people={state.people}
            tasks={state.tasks}
            studentProfiles={state.studentProfiles || []}
            currentUserId={state.currentUserId}
            currentUserRole={state.currentUser?.role || null}
            onImport={state.importData}
          />
        </>
      )}
    </div>
  );
}
