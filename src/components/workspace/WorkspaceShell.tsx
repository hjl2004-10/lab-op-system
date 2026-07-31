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
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/lib/api";

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

  useEffect(() => {
    localStorage.setItem("workspace-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  const navItems = [
    { to: "/schedule", label: "任务排期", icon: CalendarDays },
    {
      to: "/profiles",
      label: user.role === "admin" ? "学生档案" : "我的档案",
      icon: GraduationCap,
    },
    { to: "/analytics", label: "数据统计", icon: BarChart3 },
    { to: "/history", label: "进展历史", icon: History },
    ...(user.role === "admin"
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
                    <small>{user.role === "admin" ? "管理员" : "学生"}</small>
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
                <DropdownMenuItem onSelect={() => navigate("/profiles")}>
                  <GraduationCap />
                  {user.role === "admin" ? "学生档案" : "我的档案"}
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
    </div>
  );
}
