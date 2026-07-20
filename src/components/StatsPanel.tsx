import { useMemo, useState } from "react";
import {
  LayoutGrid,
  CheckCircle,
  Clock,
  TrendingUp,
  Star,
  Award,
  Sparkles,
  BarChart3,
  LayoutTemplate,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface StatsPanelProps {
  stats: {
    total: number;
    completed: number;
    inProgress: number;
    overallProgress: number;
    totalStars: number;
    ratedCount: number;
    avgStars: string;
  };
  isAdmin: boolean;
  currentUserId?: string | null;
  selectedPersonId?: string | null;
  onPersonSelect?: (personId: string) => void;
  viewMode?: "cards" | "charts";
  onViewModeChange?: (mode: "cards" | "charts") => void;
  tasks?: Array<{
    id: string;
    name: string;
    assigneeId: string;
    progress: number;
    rating?: number;
  }>;
  people?: Array<{
    id: string;
    name: string;
    color: string;
    status?: "active" | "archived";
    role?: "admin" | "member";
  }>;
}

// ------------------------------------------------------------------
// Color constants for charts
// ------------------------------------------------------------------

const COLORS = {
  completed: "#10b981", // emerald-500
  inProgress: "#f59e0b", // amber-500
  notStarted: "#64748b", // slate-500
};

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function StatsPanel({
  stats,
  isAdmin,
  currentUserId,
  selectedPersonId: _selectedPersonId,
  onPersonSelect,
  viewMode = "cards",
  onViewModeChange,
  tasks = [],
  people = [],
}: StatsPanelProps) {
  // Internal state for selected person
  // Admin defaults to "all"; students default to themselves
  const [internalSelectedId, setInternalSelectedId] = useState<string>(
    isAdmin ? "all" : (currentUserId || "all")
  );

  // ── Filtered stats based on selected person ──
  const displayStats = useMemo(() => {
    const personId = internalSelectedId;
    if (!personId || personId === "all") return stats;
    const personTasks = (tasks || []).filter(t => t.assigneeId === personId);
    const total = personTasks.length;
    const completed = personTasks.filter(t => t.progress >= 100).length;
    const inProgress = personTasks.filter(t => t.progress > 0 && t.progress < 100).length;
    const overallProgress = total > 0 ? Math.round(personTasks.reduce((sum, t) => sum + t.progress, 0) / total) : 0;
    const totalStars = personTasks.filter(t => (t.rating || 0) > 0).reduce((sum, t) => sum + (t.rating || 0), 0);
    const ratedCount = personTasks.filter(t => (t.rating || 0) > 0).length;
    const avgStars = ratedCount > 0 ? (totalStars / ratedCount).toFixed(1) : "0";
    return { total, completed, inProgress, overallProgress, totalStars, ratedCount, avgStars };
  }, [stats, internalSelectedId, tasks]);

  // ── Chart data: task distribution ──
  const distributionData = useMemo(() => {
    if (!tasks || tasks.length === 0) {
      return [
        { name: "已完成", value: displayStats.completed, color: COLORS.completed },
        { name: "进行中", value: displayStats.inProgress, color: COLORS.inProgress },
        {
          name: "未开始",
          value: displayStats.total - displayStats.completed - displayStats.inProgress,
          color: COLORS.notStarted,
        },
      ];
    }
    const completed = tasks.filter((t) => t.progress >= 100).length;
    const inProgress = tasks.filter(
      (t) => t.progress > 0 && t.progress < 100
    ).length;
    const notStarted = tasks.filter((t) => t.progress === 0).length;
    return [
      { name: "已完成", value: completed, color: COLORS.completed },
      { name: "进行中", value: inProgress, color: COLORS.inProgress },
      { name: "未开始", value: notStarted, color: COLORS.notStarted },
    ];
  }, [tasks, displayStats]);

  // ── Chart data: progress by person ──
  const progressByPerson = useMemo(() => {
    if (!tasks || !people || tasks.length === 0 || people.length === 0) {
      return [];
    }
    return people
      .filter((p) => p.status !== "archived")
      .map((person) => {
        const personTasks = tasks.filter((t) => t.assigneeId === person.id);
        const avgProgress =
          personTasks.length > 0
            ? Math.round(
                personTasks.reduce((sum, t) => sum + t.progress, 0) /
                  personTasks.length
              )
            : 0;
        return {
          name: person.name,
          progress: avgProgress,
          count: personTasks.length,
          fill: person.color,
        };
      });
  }, [tasks, people]);

  // ── Custom tooltip for charts ──
  const renderTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 shadow-sm">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {label}
          </p>
          {payload.map((entry: any, idx: number) => (
            <p key={idx} className="text-xs text-slate-500 dark:text-slate-400">
              {entry.name}: {entry.value}
              {entry.name === "progress" ? "%" : ""}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // ── Base stat cards configuration ──
  const baseCards = [
    {
      label: "总任务数",
      value: displayStats.total,
      icon: LayoutGrid,
      iconColor: "text-slate-500",
      valueColor: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "已完成",
      value: displayStats.completed,
      icon: CheckCircle,
      iconColor: "text-emerald-500",
      valueColor: "text-emerald-600",
    },
    {
      label: "进行中",
      value: displayStats.inProgress,
      icon: Clock,
      iconColor: "text-amber-500",
      valueColor: "text-amber-600",
    },
    {
      label: "整体进度",
      value: `${displayStats.overallProgress}%`,
      icon: TrendingUp,
      iconColor: "text-sky-500",
      valueColor: "text-sky-600",
    },
  ];

  // ── Admin stat cards configuration ──
  const adminCards = [
    {
      label: "获得星数",
      value: displayStats.totalStars,
      icon: Star,
      iconColor: "text-amber-500",
      valueColor: "text-amber-600",
    },
    {
      label: "已评分任务",
      value: displayStats.ratedCount,
      icon: Award,
      iconColor: "text-amber-500",
      valueColor: "text-amber-600",
    },
    {
      label: "平均星级",
      value: displayStats.avgStars,
      icon: Sparkles,
      iconColor: "text-amber-500",
      valueColor: "text-amber-600",
    },
  ];

  // ── Render ──
  return (
    <div className="px-6 py-4">
      {/* Person selector for admin */}
      {isAdmin && people && people.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">查看:</span>
          <select
            value={internalSelectedId}
            onChange={(e) => {
              const id = e.target.value;
              setInternalSelectedId(id);
              onPersonSelect?.(id === "all" ? "all" : id);
            }}
            className="h-8 px-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
          >
            <option value="all">全部成员</option>
            {people.filter(p => p.status !== "archived").map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* View toggle for admin */}
      {isAdmin && onViewModeChange && (
        <div className="flex justify-end mb-3 gap-1">
          <Button
            variant={viewMode === "cards" ? "default" : "outline"}
            size="sm"
            onClick={() => onViewModeChange("cards")}
            className="text-xs gap-1"
          >
            <LayoutTemplate className="size-3.5" />
            卡片
          </Button>
          <Button
            variant={viewMode === "charts" ? "default" : "outline"}
            size="sm"
            onClick={() => onViewModeChange("charts")}
            className="text-xs gap-1"
          >
            <BarChart3 className="size-3.5" />
            图表
          </Button>
        </div>
      )}

      {/* Cards view */}
      {(!isAdmin || viewMode === "cards") && (
        <div
          className={cn(
            "grid gap-3",
            isAdmin ? "grid-cols-4 sm:grid-cols-4 lg:grid-cols-7" : "grid-cols-4"
          )}
        >
          {baseCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-col gap-1"
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn("size-4", card.iconColor)} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {card.label}
                  </span>
                </div>
                <span className={cn("text-2xl font-bold", card.valueColor)}>
                  {card.value}
                </span>
              </div>
            );
          })}

          {isAdmin &&
            adminCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-col gap-1"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("size-4", card.iconColor)} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {card.label}
                    </span>
                  </div>
                  <span className={cn("text-2xl font-bold", card.valueColor)}>
                    {card.value}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      {/* Charts view (admin only) */}
      {isAdmin && viewMode === "charts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Task Distribution Pie Chart */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              任务分布
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={distributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={renderTooltip} />
                <Legend
                  formatter={(value: string) => (
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Progress by Person Bar Chart */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              人均进度
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={progressByPerson}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148,163,184,0.2)"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={{ stroke: "rgba(148,163,184,0.3)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={{ stroke: "rgba(148,163,184,0.3)" }}
                  tickLine={false}
                  domain={[0, 100]}
                  unit="%"
                />
                <Tooltip content={renderTooltip} />
                <Bar dataKey="progress" name="进度" radius={[4, 4, 0, 0]}>
                  {progressByPerson.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
