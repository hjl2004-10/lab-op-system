import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { CloudAlert, LoaderCircle } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { holidays } from "@/data";
import type { Task } from "@/types";

import LoginPage from "@/components/LoginPage";
import AddTaskSheet from "@/components/AddTaskSheet";
import AIAssistant from "@/components/AIAssistant";
import TaskEditDialog from "@/components/TaskEditDialog";
import SyncPanel from "@/components/SyncPanel";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import SchedulePage from "@/components/workspace/SchedulePage";

const AnalyticsPage = lazy(() => import("@/components/workspace/AnalyticsPage"));
const HistoryPage = lazy(() => import("@/components/workspace/HistoryPage"));
const ProfilesPage = lazy(() => import("@/components/workspace/ProfilesPage"));
const SystemPage = lazy(() => import("@/components/workspace/SystemPage"));

import type { AuthUser } from "@/lib/api";

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="workspace-loader">
        <LoaderCircle className="spin" size={22} />
        <span>正在恢复会话</span>
      </div>
    );
  }

  if (!auth.user) return <LoginPage onLogin={auth.login} />;

  return (
    <AuthenticatedWorkspace
      key={auth.user.personId}
      user={auth.user}
      logout={auth.logout}
    />
  );
}

interface AuthenticatedWorkspaceProps {
  user: AuthUser;
  logout: () => Promise<void>;
}

function AuthenticatedWorkspace({ user, logout }: AuthenticatedWorkspaceProps) {
  const [autoSave, setAutoSave] = useState(true);
  const state = useAppState(user, autoSave);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.darkMode);
  }, [state.darkMode]);

  if (state.loading) {
    return (
      <div className="workspace-loader">
        <LoaderCircle className="spin" size={22} />
        <span>正在加载实验室工作区</span>
      </div>
    );
  }

  if (state.loadError) {
    return (
      <div className="workspace-error">
        <CloudAlert size={28} />
        <h1>工作区暂时无法打开</h1>
        <p>{state.loadError}</p>
        <div>
          <button onClick={() => window.location.reload()}>重新加载</button>
          <button onClick={logout}>退出登录</button>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === "admin";
  const isTeacher = user.role === "teacher";
  const isManager = isAdmin || isTeacher;
  const currentUserId = user.personId;
  const currentUserName = user.name;

  const exportGanttImage = () => {
    const element = document.getElementById("gantt-chart");
    if (element) void state.exportImage(element);
  };

  const handleLogout = async () => {
    try {
      await state.flushSave();
    } finally {
      await logout();
    }
  };

  return (
    <WorkspaceShell
      user={user}
      syncStatus={state.syncStatus}
      darkMode={state.darkMode}
      onToggleDarkMode={() => state.setDarkMode(!state.darkMode)}
      onLogout={handleLogout}
    >
      {state.accountDisabled && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <CloudAlert className="size-4" />
          账号已停用（离线模式）：可继续查看，修改不会保存；如需恢复请联系管理员启用
        </div>
      )}
      <Suspense
        fallback={
          <div className="workspace-loader workspace-section-loader">
            <LoaderCircle className="spin" size={20} />
            <span>正在加载模块</span>
          </div>
        }
      >
        <Routes>
        <Route path="/" element={<Navigate to="/schedule" replace />} />
        <Route
          path="/schedule"
          element={
            <SchedulePage
              tasks={state.filteredTasks}
              allTasks={state.tasks}
              people={state.people}
              filters={state.filters}
              isManager={isManager}
              holidays={holidays}
              selectedStudentIds={state.selectedStudentIds}
              onSelectedStudentIdsChange={state.setSelectedStudentIds}
              onFiltersChange={state.setFilters}
              onAddTask={() => setShowAddTask(true)}
              onTaskClick={setEditingTask}
              onReorder={state.reorderTasks}
              onExportImage={exportGanttImage}
            />
          }
        />
        <Route
          path="/profiles"
          element={
            isManager ? (
              <ProfilesPage
                people={state.people}
                profiles={state.studentProfiles || []}
                isAdmin={isAdmin}
                isManager={isManager}
                currentUserId={currentUserId}
                selectedStudentIds={state.selectedStudentIds}
                onSelectedStudentIdsChange={state.setSelectedStudentIds}
                profileFieldDefs={state.profileFieldDefs}
                onUpdateProfile={state.updateProfile}
                onUpdateProfileAdminData={state.updateProfileAdminData}
                onReorderProfileFields={state.reorderProfileFields}
                onAddCategory={state.addProfileCategory}
                onRemoveField={state.removeProfileField}
                addProfileFieldDef={state.addProfileFieldDef}
                removeProfileFieldDef={state.removeProfileFieldDef}
                addProfileFieldOption={state.addProfileFieldOption}
                removeProfileFieldOption={state.removeProfileFieldOption}
              />
            ) : (
              <Navigate to="/schedule" replace />
            )
          }
        />
        <Route
          path="/analytics"
          element={
            <AnalyticsPage
              tasks={state.tasks}
              people={state.people}
              isAdmin={isManager}
              currentUserId={currentUserId}
            />
          }
        />
        <Route
          path="/history"
          element={
            <HistoryPage
              tasks={state.tasks}
              people={state.people}
              isAdmin={isManager}
            />
          }
        />
        <Route
          path="/system"
          element={
            isManager ? (
              <SystemPage
                people={state.people}
                classes={state.classes}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                isTeacher={isTeacher}
                manageableStudentIds={state.manageableStudentIds}
                canManageStudent={state.canManageStudent}
                onAdd={state.addPerson}
                onDelete={state.deletePerson}
                onUpdateAccount={state.updateAccount}
                onSetPassword={state.setPersonPassword}
                onReorder={state.reorderPeople}
                onArchive={state.toggleArchivePerson}
                onAddClass={state.addClass}
                onRemoveClass={state.removeClass}
                onRenameClass={state.renameClass}
                onSetClassMembers={state.setClassMembers}
                autoSave={autoSave}
                onToggleAutoSave={() => setAutoSave((value) => !value)}
                onExportJson={state.exportToJson}
                onImportJson={state.importFromJson}
                onOpenSync={() => setShowSyncPanel(true)}
                onReset={state.resetData}
              />
            ) : (
              <Navigate to="/schedule" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/schedule" replace />} />
        </Routes>
      </Suspense>

      <AddTaskSheet
        open={showAddTask}
        onOpenChange={setShowAddTask}
        people={state.people}
        canAssignTasks={isManager}
        currentUserId={currentUserId}
        onAdd={state.addTask}
      />

      {editingTask && (
        <TaskEditDialog
          key={editingTask.id}
          open
          task={editingTask}
          people={state.people}
          canAssignTasks={isManager}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onOpenChange={(open) => {
            if (!open) setEditingTask(null);
          }}
          onSave={(taskId, updates) => {
            state.updateTask(taskId, updates);
            if ((updates.progress ?? 0) >= 100) {
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
              authorId: currentUserId,
            })
          }
          onAddProgressReply={state.addProgressReply}
          onSetRating={state.setTaskRating}
        />
      )}

      <SyncPanel
        open={showSyncPanel}
        onOpenChange={setShowSyncPanel}
        people={state.people}
        tasks={state.tasks}
        studentProfiles={state.studentProfiles || []}
        currentUserId={currentUserId}
        currentUserRole={user.role}
        onImport={state.importData}
      />

      <AIAssistant
        people={state.people}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        currentUserRole={user.role}
        isManager={isManager}
        onAddTask={state.addTask}
        onAddAccount={state.addPerson}
      />
    </WorkspaceShell>
  );
}
