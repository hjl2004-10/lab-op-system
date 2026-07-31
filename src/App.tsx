import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { CloudAlert, LoaderCircle } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { holidays } from "@/data";
import type { Task } from "@/types";

import LoginPage from "@/components/LoginPage";
import AddTaskSheet from "@/components/AddTaskSheet";
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
              isAdmin={isAdmin}
              holidays={holidays}
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
            <ProfilesPage
              people={state.people}
              profiles={state.studentProfiles || []}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onUpdateProfile={state.updateProfile}
              onUpdateProfileAdminData={state.updateProfileAdminData}
              onReorderProfileFields={state.reorderProfileFields}
              onAddCategory={state.addProfileCategory}
              onRemoveField={state.removeProfileField}
            />
          }
        />
        <Route
          path="/analytics"
          element={
            <AnalyticsPage
              tasks={state.tasks}
              people={state.people}
              isAdmin={isAdmin}
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
              isAdmin={isAdmin}
            />
          }
        />
        <Route
          path="/system"
          element={
            isAdmin ? (
              <SystemPage
                people={state.people}
                currentUserId={currentUserId}
                onAdd={state.addPerson}
                onDelete={state.deletePerson}
                onUpdateAccount={state.updateAccount}
                onSetPassword={state.setPersonPassword}
                onReorder={state.reorderPeople}
                onArchive={state.toggleArchivePerson}
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
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        onAdd={state.addTask}
      />

      {editingTask && (
        <TaskEditDialog
          key={editingTask.id}
          open
          task={editingTask}
          people={state.people}
          isAdmin={isAdmin}
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
    </WorkspaceShell>
  );
}
