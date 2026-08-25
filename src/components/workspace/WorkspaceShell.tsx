import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudAlert,
  GraduationCap,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AuthUser } from "@/lib/api";
import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  user: AuthUser;
  syncStatus: "idle" | "saving" | "saved" | "error";
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => Promise<void>;
  children: ReactNode;
}

const pageTitles: Record<string, string> = {
  "/schedule": "任务排期",
  "/profiles": "学生档案",
  "/analytics": "数据统计",
  "/history": "进展历史",
  "/system": "系统管理",
};

function PasswordDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!oldPassword || password.length < 8) {
      setError("请填写完整：新密码至少 8 位且含大小写字母和数字");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.changeOwnPassword(oldPassword, password);
      setDone(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>
            修改成功后其他设备需要重新登录，当前设备保持登录
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            密码已修改。
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">旧密码</Label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">新密码</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位，含大写、小写字母和数字"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">确认新密码</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {!done && (
            <Button size="sm" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              确认修改
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkspaceShell({
  user,
  syncStatus,
  darkMode,
  onToggleDarkMode,
  onLogout,
  children,
}: WorkspaceShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("workspace-sidebar-collapsed") === "true"
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("workspace-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  const isAdminOrTeacher = user.role === "admin" || user.role === "teacher";
  const navItems = [
    { to: "/schedule", label: "任务排期", icon: CalendarDays },
    // 学生端不提供档案界面（图二），档案仅教师端维护
    ...(isAdminOrTeacher
      ? [{ to: "/profiles", label: "学生档案", icon: GraduationCap }]
      : []),
    { to: "/analytics", label: "数据统计", icon: BarChart3 },
    { to: "/history", label: "进展历史", icon: History },
    ...(isAdminOrTeacher
      ? [{ to: "/system", label: "系统管理", icon: Settings }]
      : []),
  ];

  const pageTitle = pageTitles[location.pathname] || "任务排期";
  const syncLabel =
    syncStatus === "saving"
      ? "保存中"
      : syncStatus === "error"
        ? "保存失败"
        : "已保存";

  const sidebar = (
    <>
      <div className="workspace-brand">
        <span className="workspace-brand-mark">
          <CalendarDays size={18} />
        </span>
        <div className="workspace-brand-copy">
          <strong>YANG11 LAB</strong>
          <span>实验进度协作台</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="workspace-mobile-close"
          onClick={() => setMobileOpen(false)}
          aria-label="关闭导航"
        >
          <X />
        </Button>
      </div>

      <nav className="workspace-nav" aria-label="工作台导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn("workspace-nav-item", isActive && "active")
              }
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        className="workspace-sidebar-toggle"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        <span>收起侧栏</span>
      </button>
    </>
  );

  return (
    <div className={cn("workspace-shell", collapsed && "sidebar-collapsed")}>
      <aside className="workspace-sidebar">{sidebar}</aside>

      {mobileOpen && (
        <div
          className="workspace-mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="工作台导航"
        >
          <button
            className="workspace-mobile-backdrop"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航"
          />
          <aside>{sidebar}</aside>
        </div>
      )}

      <section className="workspace-stage">
        <header className="workspace-topbar">
          <div className="workspace-topbar-title">
            <Button
              variant="ghost"
              size="icon-sm"
              className="workspace-menu-button"
              onClick={() => setMobileOpen(true)}
              aria-label="打开导航"
            >
              <Menu />
            </Button>
            <h1>{pageTitle}</h1>
          </div>

          <div className="workspace-account">
            <span
              className={cn(
                "workspace-save-state",
                syncStatus === "error" && "error",
                syncStatus === "saving" && "saving"
              )}
            >
              {syncStatus === "error" ? (
                <CloudAlert size={14} />
              ) : (
                <Cloud size={14} />
              )}
              {syncLabel}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="workspace-user-trigger" type="button">
                  <span className="workspace-user-avatar">
                    {user.name.slice(0, 1)}
                  </span>
                  <span className="workspace-user-copy">
                    <strong>{user.name}</strong>
                  </span>
                  <ChevronRight size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{user.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onToggleDarkMode}>
                  {darkMode ? <Sun /> : <Moon />}
                  {darkMode ? "切换到亮色模式" : "切换到暗色模式"}
                </DropdownMenuItem>
                {isAdminOrTeacher && (
                  <DropdownMenuItem onSelect={() => navigate("/profiles")}>
                    <GraduationCap />
                    学生档案
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                  <KeyRound />
                  修改密码
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void onLogout()}
                >
                  <LogOut />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="workspace-content">{children}</main>
      </section>

      {/* 关闭即卸载，表单状态自然重置 */}
      {passwordOpen && (
        <PasswordDialog
          onOpenChange={(next) => {
            if (!next) setPasswordOpen(false);
          }}
        />
      )}
    </div>
  );
}
