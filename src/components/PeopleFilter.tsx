import { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Person, Task, FilterState } from "@/types";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface PeopleFilterProps {
  people: Person[];
  tasks: Task[];
  currentFilter: "all" | string;
  onFilterChange: (filter: "all" | string) => void;
  viewMode: "day" | "week" | "month";
  onViewModeChange: (mode: "day" | "week" | "month") => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  statusFilter: "all" | "active" | "completed";
  onStatusFilterChange: (filter: "all" | "active" | "completed") => void;
  // Optional: legacy props for backward compatibility
  filters?: FilterState;
  onChange?: (f: Partial<FilterState>) => void;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function PeopleFilter({
  people,
  tasks,
  currentFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  showArchived,
  onToggleArchived,
  statusFilter,
  onStatusFilterChange,
  filters,
  onChange,
}: PeopleFilterProps) {
  // ── Normalize: derive values from either new props or legacy filters ──
  const activeFilter = filters?.assigneeFilter ?? currentFilter;
  const activeViewMode = filters?.viewMode ?? viewMode;
  const activeStatusFilter = filters?.statusFilter ?? statusFilter;

  const handleFilterChange = (filter: "all" | string) => {
    if (onChange) {
      onChange({ assigneeFilter: filter });
    }
    onFilterChange(filter);
  };

  const handleViewModeChange = (mode: "day" | "week" | "month") => {
    if (onChange) {
      onChange({ viewMode: mode });
    }
    onViewModeChange(mode);
  };

  const handleStatusFilterChange = (filter: "all" | "active" | "completed") => {
    if (onChange) {
      onChange({ statusFilter: filter });
    }
    onStatusFilterChange(filter);
  };

  // ── Compute task counts per person ──
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    people.forEach((p) => {
      counts[p.id] = tasks.filter((t) => t.assigneeId === p.id).length;
    });
    return counts;
  }, [people, tasks]);

  // ── Compute completed tasks hidden count ──
  const completedHiddenCount = useMemo(() => {
    if (activeStatusFilter !== "active") return 0;
    return tasks.filter((t) => t.progress === 100).length;
  }, [tasks, activeStatusFilter]);

  // ── Filter and sort people: active first, then archived if shown ──
  const activePeople = useMemo(
    () => people.filter((p) => p.status !== "archived"),
    [people]
  );
  const archivedPeople = useMemo(
    () => people.filter((p) => p.status === "archived"),
    [people]
  );
  const hasArchived = archivedPeople.length > 0;

  const displayedPeople = useMemo(() => {
    const result = [...activePeople];
    if (showArchived) {
      result.push(...archivedPeople);
    }
    return result;
  }, [activePeople, archivedPeople, showArchived]);

  // ── View mode labels ──
  const viewModeLabels: Record<string, string> = {
    day: "日",
    week: "周",
    month: "月",
  };

  return (
    <div className="flex flex-col gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-700">
      {/* Main filter row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {/* "All" button */}
        <Button
          variant={activeFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("all")}
          className={cn(
            "shrink-0 text-xs gap-1.5 rounded-full transition-colors",
            activeFilter === "all"
              ? "bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700"
          )}
        >
          <LayoutGrid className="size-3.5" />
          全部
        </Button>

        {/* Person buttons */}
        {displayedPeople.map((person) => {
          const isActive = activeFilter === person.id;
          const isArchivedPerson = person.status === "archived";
          return (
            <Button
              key={person.id}
              variant="outline"
              size="sm"
              onClick={() => handleFilterChange(person.id)}
              className={cn(
                "shrink-0 text-xs gap-1.5 rounded-full transition-colors relative",
                isActive
                  ? "text-white border-transparent hover:opacity-90"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700"
              )}
              style={
                isActive
                  ? {
                      backgroundColor: person.color,
                      borderColor: person.color,
                    }
                  : undefined
              }
            >
              {/* Colored dot */}
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: isActive ? "#ffffff" : person.color,
                }}
              />
              <span>{person.name}</span>
              {/* Task count badge */}
              <span
                className={cn(
                  "min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-medium px-1",
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                )}
              >
                {taskCounts[person.id] ?? 0}
              </span>
              {/* Archived label */}
              {isArchivedPerson && (
                <span
                  className={cn(
                    "text-[10px] ml-0.5",
                    isActive ? "text-white/80" : "text-slate-400"
                  )}
                >
                  毕业
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Second row: view mode + status filter */}
      <div className="flex items-center gap-3">
        {/* View mode segmented control */}
        <div className="flex items-center rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
          {(["day", "week", "month"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleViewModeChange(mode)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                activeViewMode === mode
                  ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
              )}
            >
              {viewModeLabels[mode]}
            </button>
          ))}
        </div>

        {/* Vertical divider */}
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />

        {/* Status filter buttons */}
        <div className="flex items-center rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            onClick={() => handleStatusFilterChange("active")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              activeStatusFilter === "active"
                ? "bg-amber-500 text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
          >
            进行中
          </button>
          <button
            onClick={() => handleStatusFilterChange("completed")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              activeStatusFilter === "completed"
                ? "bg-emerald-500 text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
          >
            已完成
          </button>
          <button
            onClick={() => handleStatusFilterChange("all")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              activeStatusFilter === "all"
                ? "bg-slate-800 text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
          >
            全部
          </button>
        </div>

        {/* Archived toggle */}
        {hasArchived && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleArchived}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ml-auto"
          >
            {showArchived ? "隐藏毕业" : "显示毕业"}
          </Button>
        )}
      </div>

      {/* Hint message when completed tasks are hidden */}
      {completedHiddenCount > 0 && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-md">
          已隐藏 {completedHiddenCount} 个已完成的任务，点击「已完成」或「全部」查看
        </div>
      )}
    </div>
  );
}
