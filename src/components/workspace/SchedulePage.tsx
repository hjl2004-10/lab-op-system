import { useMemo } from "react";
import {
  CircleCheck,
  Download,
  ListTodo,
  Percent,
  Plus,
  Search,
  X,
} from "lucide-react";
import GanttWorkspace from "@/components/workspace/GanttWorkspace";
import StudentCards from "@/components/workspace/StudentCards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getStats } from "@/utils";
import type { FilterState, Person, Task } from "@/types";

interface SchedulePageProps {
  tasks: Task[];
  allTasks: Task[];
  people: Person[];
  filters: FilterState;
  isManager: boolean;
  currentUserId: string | null;
  holidays: Record<string, string>;
  selectedStudentIds: string[];
  onSelectedStudentIdsChange: (ids: string[]) => void;
  onFiltersChange: (updater: (current: FilterState) => FilterState) => void;
  onAddTask: () => void;
  onTaskClick: (task: Task) => void;
  onReorder: (taskIds: string[]) => void;
  onExportImage: () => void;
}

/** zip 原型分段控件：选中项深灰底白字，语义色可选 */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: string; activeClass?: string }[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors",
            "border-r border-slate-200 last:border-r-0 dark:border-slate-700",
            value === option.value
              ? cn("text-white", option.activeClass ?? "bg-slate-800 dark:bg-slate-200 dark:text-slate-900")
              : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          )}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function SchedulePage({
  tasks,
  allTasks,
  people,
  filters,
  isManager,
  currentUserId,
  holidays,
  selectedStudentIds,
  onSelectedStudentIdsChange,
  onFiltersChange,
  onAddTask,
  onTaskClick,
  onReorder,
  onExportImage,
}: SchedulePageProps) {
  const stats = useMemo(() => getStats(tasks), [tasks]);
  const members = useMemo(
    () =>
      people
        .filter((person) => person.status !== "archived")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [people]
  );

  // -- 学生筛选胶囊：仅列出学生，勾选影响任务视图与档案表格 --
  const memberStudents = useMemo(
    () => members.filter((person) => person.role === "student"),
    [members]
  );
  // 每人任务数用 allTasks（未过滤），避免随筛选变小而失真
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allTasks.forEach((task) => {
      counts[task.assigneeId] = (counts[task.assigneeId] ?? 0) + 1;
    });
    return counts;
  }, [allTasks]);
  const hasFilters =
    filters.statusFilter !== "all" || filters.keyword.trim() !== "";

  const setFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    onFiltersChange((current) => ({ ...current, [key]: value }));
  };

  const statCards = [
    { label: "任务总数", value: `${stats.total}`, icon: ListTodo, tone: "text-slate-900 dark:text-slate-100" },
    { label: "进行中", value: `${stats.inProgress}`, icon: Percent, tone: "text-amber-500" },
    { label: "已完成", value: `${stats.completed}`, icon: CircleCheck, tone: "text-emerald-500" },
    { label: "整体进度", value: `${stats.overallProgress}%`, icon: CircleCheck, tone: "text-sky-500" },
  ];

  return (
    <main className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950 sm:p-5">
      {/* ① 统计卡片（zip StatsPanel 样式） */}
      <section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4" aria-label="任务统计">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-center gap-2">
              <card.icon className="size-4 text-slate-500 dark:text-slate-400" />
              <span className="text-xs text-slate-500 dark:text-slate-400">{card.label}</span>
            </div>
            <span className={cn("text-2xl font-bold", card.tone)}>{card.value}</span>
          </div>
        ))}
      </section>

      {/* ② 工具栏（zip Toolbar 样式） */}
      <section className="flex shrink-0 flex-wrap items-center gap-2" aria-label="任务操作">
        <Button
          size="sm"
          className="bg-sky-500 text-white shadow-xs hover:bg-sky-600"
          onClick={onAddTask}
        >
          <Plus className="size-3.5" />
          新增任务
        </Button>
        <Button variant="outline" size="sm" onClick={onExportImage}>
          <Download className="size-3.5" />
          导出图片
        </Button>

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={filters.keyword}
            onChange={(event) => setFilter("keyword", event.target.value)}
            placeholder="搜索任务名称、备注或进展"
            aria-label="搜索任务"
            className="h-8 pl-8 pr-7 text-xs"
          />
          {filters.keyword && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-600"
              onClick={() => setFilter("keyword", "")}
              aria-label="清除搜索"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </section>

      {/* ③ 筛选区（zip PeopleFilter 样式：成员胶囊 + 视图/状态分段） */}
      {isManager && (
        <StudentCards
          students={memberStudents}
          selfPerson={members.find((person) => person.id === currentUserId) ?? null}
          selectedStudentIds={selectedStudentIds}
          onSelectedStudentIdsChange={onSelectedStudentIdsChange}
          taskCounts={taskCounts}
        />
      )}

      <section className="flex shrink-0 flex-wrap items-center gap-2" aria-label="视图与状态筛选">
        <SegmentedControl
          aria-label="时间粒度"
          value={filters.viewMode}
          onChange={(mode) => setFilter("viewMode", mode)}
          options={[
            { value: "day", label: "日" },
            { value: "week", label: "周" },
            { value: "month", label: "月" },
          ]}
        />
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <SegmentedControl
          aria-label="任务状态"
          value={filters.statusFilter}
          onChange={(value) => setFilter("statusFilter", value)}
          options={[
            { value: "active", label: "进行中", activeClass: "bg-amber-500" },
            { value: "completed", label: "已完成", activeClass: "bg-emerald-500" },
            { value: "all", label: "全部" },
          ]}
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 text-xs text-slate-500"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                statusFilter: "all",
                keyword: "",
              }))
            }
          >
            <X className="size-3.5" />
            清除筛选
          </Button>
        )}
      </section>

      {/* ④ 甘特图卡片 */}
      <GanttWorkspace
        tasks={tasks}
        people={people}
        viewMode={filters.viewMode}
        holidays={holidays}
        onTaskClick={onTaskClick}
        onReorder={onReorder}
      />
    </main>
  );
}
