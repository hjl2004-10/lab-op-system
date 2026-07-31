import { useMemo } from "react";
import { Plus, Search, X } from "lucide-react";
import GanttWorkspace from "@/components/workspace/GanttWorkspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getStats } from "@/utils";
import type { FilterState, Person, Task } from "@/types";

interface SchedulePageProps {
  tasks: Task[];
  allTasks: Task[];
  people: Person[];
  filters: FilterState;
  isAdmin: boolean;
  holidays: Record<string, string>;
  onFiltersChange: (updater: (current: FilterState) => FilterState) => void;
  onAddTask: () => void;
  onTaskClick: (task: Task) => void;
  onReorder: (taskIds: string[]) => void;
  onExportImage: () => void;
}

export default function SchedulePage({
  tasks,
  allTasks,
  people,
  filters,
  isAdmin,
  holidays,
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
  const hasFilters =
    filters.assigneeFilter !== "all" ||
    filters.statusFilter !== "all" ||
    filters.keyword.trim() !== "";

  const setFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    onFiltersChange((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="schedule-page">
      <section className="schedule-heading">
        <div>
          <h2>任务排期</h2>
          <p>
            <strong>{stats.total}</strong> 个任务
            <span>·</span>
            <strong>{stats.inProgress}</strong> 个进行中
            <span>·</span>
            整体进度 <strong>{stats.overallProgress}%</strong>
            {tasks.length !== allTasks.length && <small>（当前筛选）</small>}
          </p>
        </div>
        <Button className="workspace-primary-action" onClick={onAddTask}>
          <Plus />新增任务
        </Button>
      </section>

      <section className="schedule-filters" aria-label="任务筛选">
        <div className="schedule-search">
          <Search size={16} />
          <Input
            value={filters.keyword}
            onChange={(event) => setFilter("keyword", event.target.value)}
            placeholder="搜索任务名称、备注或进展"
            aria-label="搜索任务"
          />
          {filters.keyword && (
            <button
              type="button"
              onClick={() => setFilter("keyword", "")}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {isAdmin && (
          <label className="schedule-filter-field">
            <span>成员</span>
            <Select
              value={filters.assigneeFilter}
              onValueChange={(value) => setFilter("assigneeFilter", value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部成员</SelectItem>
                {members.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        <label className="schedule-filter-field">
          <span>状态</span>
          <Select
            value={filters.statusFilter}
            onValueChange={(value: FilterState["statusFilter"]) =>
              setFilter("statusFilter", value)
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">进行中</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
            </SelectContent>
          </Select>
        </label>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="schedule-clear-filters"
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                assigneeFilter: "all",
                statusFilter: "all",
                keyword: "",
              }))
            }
          >
            <X />清除筛选
          </Button>
        )}
      </section>

      <GanttWorkspace
        tasks={tasks}
        people={people}
        viewMode={filters.viewMode}
        holidays={holidays}
        onViewModeChange={(mode) => setFilter("viewMode", mode)}
        onTaskClick={onTaskClick}
        onReorder={onReorder}
        onExportImage={onExportImage}
      />
    </div>
  );
}
