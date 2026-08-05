import { useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  CircleDot,
  Gauge,
  ListChecks,
  Star,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Person, Task } from "@/types";

export interface AnalyticsPageProps {
  tasks: Task[];
  people: Person[];
  isAdmin: boolean;
  currentUserId: string | null;
}

const DISTRIBUTION_COLORS = {
  completed: "#2563eb",
  inProgress: "#ca8a04",
  notStarted: "#64748b",
};

function clampProgress(progress: number) {
  return Math.max(0, Math.min(100, progress));
}

export default function AnalyticsPage({
  tasks,
  people,
  isAdmin,
  currentUserId,
}: AnalyticsPageProps) {
  const [selectedPersonId, setSelectedPersonId] = useState("all");

  const activeMembers = useMemo(
    () =>
      people
        .filter((person) => person.status !== "archived")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [people]
  );

  const effectivePersonId = isAdmin ? selectedPersonId : currentUserId;

  // Every KPI and chart below is derived from this single task scope.
  const scopedTasks = useMemo(() => {
    if (isAdmin && effectivePersonId === "all") return tasks;
    if (!effectivePersonId) return [];
    return tasks.filter((task) => task.assigneeId === effectivePersonId);
  }, [effectivePersonId, isAdmin, tasks]);

  const scopedPeople = useMemo(() => {
    if (!isAdmin) {
      return people.filter((person) => person.id === currentUserId);
    }
    if (selectedPersonId === "all") return activeMembers;
    return activeMembers.filter((person) => person.id === selectedPersonId);
  }, [activeMembers, currentUserId, isAdmin, people, selectedPersonId]);

  const stats = useMemo(() => {
    const total = scopedTasks.length;
    const completed = scopedTasks.filter((task) => task.progress >= 100).length;
    const inProgress = scopedTasks.filter(
      (task) => task.progress > 0 && task.progress < 100
    ).length;
    const overallProgress = total
      ? Math.round(
          scopedTasks.reduce((sum, task) => sum + clampProgress(task.progress), 0) /
            total
        )
      : 0;
    const ratedTasks = scopedTasks.filter((task) => task.rating > 0);
    const averageRating = ratedTasks.length
      ? (
          ratedTasks.reduce((sum, task) => sum + task.rating, 0) /
          ratedTasks.length
        ).toFixed(1)
      : "-";

    return { total, completed, inProgress, overallProgress, averageRating };
  }, [scopedTasks]);

  const distributionData = useMemo(
    () => [
      {
        name: "已完成",
        value: scopedTasks.filter((task) => task.progress >= 100).length,
        color: DISTRIBUTION_COLORS.completed,
      },
      {
        name: "进行中",
        value: scopedTasks.filter(
          (task) => task.progress > 0 && task.progress < 100
        ).length,
        color: DISTRIBUTION_COLORS.inProgress,
      },
      {
        name: "未开始",
        value: scopedTasks.filter((task) => task.progress <= 0).length,
        color: DISTRIBUTION_COLORS.notStarted,
      },
    ],
    [scopedTasks]
  );

  const memberProgressData = useMemo(
    () =>
      scopedPeople.map((person) => {
        const personTasks = scopedTasks.filter(
          (task) => task.assigneeId === person.id
        );
        const progress = personTasks.length
          ? Math.round(
              personTasks.reduce(
                (sum, task) => sum + clampProgress(task.progress),
                0
              ) / personTasks.length
            )
          : 0;
        return {
          name: person.name,
          progress,
          tasks: personTasks.length,
          color: person.color || "#2563eb",
        };
      }),
    [scopedPeople, scopedTasks]
  );

  const kpis = [
    { label: "任务总数", value: stats.total, icon: ListChecks },
    { label: "已完成", value: stats.completed, icon: CheckCircle2 },
    { label: "进行中", value: stats.inProgress, icon: CircleDot },
    { label: "平均进度", value: `${stats.overallProgress}%`, icon: Gauge },
    { label: "平均评分", value: stats.averageRating, icon: Star },
  ];

  const hasDistribution = distributionData.some((item) => item.value > 0);

  return (
    <main className="min-w-0 space-y-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-blue-900/15 pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-blue-300/15">
        <div>
          <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
            <BarChart3 className="size-5" />
            <h1 className="text-lg font-semibold">任务统计</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {isAdmin ? "实验室任务概览" : "我的任务概览"}
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Users className="size-4 text-slate-400" />
            <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
              <SelectTrigger className="h-9 w-full min-w-44 rounded-md bg-white text-sm sm:w-52 dark:bg-slate-900">
                <SelectValue placeholder="选择成员" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部成员</SelectItem>
                {activeMembers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="关键指标">
        {kpis.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex min-h-20 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2">
            <h2 className="text-sm font-semibold">任务分布</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              按当前成员范围统计任务状态
            </p>
          </div>
          <div className="h-64 min-w-0">
            {hasDistribution ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distributionData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={86}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {distributionData.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={28} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                当前范围暂无任务
              </div>
            )}
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2">
            <h2 className="text-sm font-semibold">成员进度</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              当前范围内各成员任务平均完成度
            </p>
          </div>
          <div className="h-64 min-w-0 overflow-x-auto">
            {memberProgressData.length ? (
              <div
                className="h-full"
                style={{ minWidth: Math.max(360, memberProgressData.length * 76) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={memberProgressData}
                    margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="progress" name="平均进度" radius={[4, 4, 0, 0]}>
                      {memberProgressData.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                当前范围暂无成员数据
              </div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
