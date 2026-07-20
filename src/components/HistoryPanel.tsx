import { useState, useMemo } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  Clock,
  Table,
  BarChartHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Calendar,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task, Person, ProgressRecord } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ============================================================
// Types
// ============================================================

interface HistoryPanelProps {
  open: boolean;
  tasks: Task[];
  people: Person[];
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
}

type ViewMode = "table" | "gantt";
type SortField = "date" | "author" | "taskName" | "currentProgress" | "mainProblems" | "solutions";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "active" | "completed";

interface FlatRecord extends ProgressRecord {
  taskId: string;
  taskName: string;
  taskColor: string;
  taskAssigneeId: string;
}

// ============================================================
// Helpers
// ============================================================

function formatRecordDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "yyyy-MM-dd");
  } catch {
    return dateStr;
  }
}

function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function parseDate(dateStr: string): number {
  try {
    return parseISO(dateStr).getTime();
  } catch {
    return 0;
  }
}

function formatInputDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// ============================================================
// Component
// ============================================================

export default function HistoryPanel({
  open,
  tasks,
  people,
  isAdmin,
  onOpenChange,
}: HistoryPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Admin query state
  const [selectedPersonId, setSelectedPersonId] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>(formatInputDate(subDays(new Date(), 30)));
  const [endDate, setEndDate] = useState<string>(formatInputDate(new Date()));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Active members for person selector
  const activeMembers = useMemo(() => {
    return people.filter((p) => p.status === "active" || p.status === undefined);
  }, [people]);

  // Filtered tasks based on query criteria
  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    // Filter by selected person (admin only)
    if (isAdmin && selectedPersonId && selectedPersonId !== "all") {
      result = result.filter((t) => t.assigneeId === selectedPersonId);
    }

    // Filter by date range
    if (startDate) {
      result = result.filter(
        (t) => t.endDate >= startDate || t.startDate >= startDate
      );
    }
    if (endDate) {
      result = result.filter((t) => t.startDate <= endDate);
    }

    // Filter by status
    if (statusFilter === "active") {
      result = result.filter((t) => t.progress < 100);
    } else if (statusFilter === "completed") {
      result = result.filter((t) => t.progress >= 100);
    }

    return result;
  }, [tasks, selectedPersonId, startDate, endDate, statusFilter, isAdmin]);

  // Flatten all progress history records from filtered tasks
  const flatRecords = useMemo<FlatRecord[]>(() => {
    const records: FlatRecord[] = [];
    for (const task of filteredTasks) {
      const person = people.find((p) => p.id === task.assigneeId);
      for (const ph of task.progressHistory) {
        records.push({
          ...ph,
          taskId: task.id,
          taskName: task.name,
          taskColor: person?.color ?? "#94a3b8",
          taskAssigneeId: task.assigneeId,
        });
      }
    }
    return records;
  }, [filteredTasks, people]);

  // Sort records
  const sortedRecords = useMemo(() => {
    const sorted = [...flatRecords];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = parseDate(a.date) - parseDate(b.date);
          break;
        case "author":
          cmp = a.author.localeCompare(b.author);
          break;
        case "taskName":
          cmp = a.taskName.localeCompare(b.taskName);
          break;
        case "currentProgress":
          cmp = (a.currentProgress || "").localeCompare(b.currentProgress || "");
          break;
        case "mainProblems":
          cmp = (a.mainProblems || "").localeCompare(b.mainProblems || "");
          break;
        case "solutions":
          cmp = (a.solutions || "").localeCompare(b.solutions || "");
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [flatRecords, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3" />
    ) : (
      <ArrowDown className="w-3 h-3" />
    );
  };

  // Timeline date range (based on filtered tasks)
  const { timelineStart, dayCount, dateColumns } = useMemo(() => {
    if (filteredTasks.length === 0) {
      return { timelineStart: 0, dayCount: 0, dateColumns: [] as string[] };
    }
    const starts = filteredTasks.map((t) => parseDate(t.startDate)).filter((d) => d > 0);
    const ends = filteredTasks.map((t) => parseDate(t.endDate)).filter((d) => d > 0);
    const minDate = Math.min(...starts);
    const maxDate = Math.max(...ends);
    const padStart = minDate - 2 * 24 * 60 * 60 * 1000;
    const padEnd = maxDate + 2 * 24 * 60 * 60 * 1000;
    const totalDays = Math.ceil((padEnd - padStart) / (24 * 60 * 60 * 1000)) + 1;

    const columns: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(padStart + i * 24 * 60 * 60 * 1000);
      columns.push(format(d, "yyyy-MM-dd"));
    }

    return {
      timelineStart: padStart,
      dayCount: totalDays,
      dateColumns: columns,
    };
  }, [filteredTasks]);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  // Get person info for a task
  const getPerson = (assigneeId: string) => {
    return people.find((p) => p.id === assigneeId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] w-full sm:max-w-5xl max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="w-5 h-5 text-slate-500" />
            历史记录
            <Badge variant="secondary" className="ml-2 text-xs">
              共 {filteredTasks.length} 个任务，{flatRecords.length} 条记录
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Admin Query Panel */}
        {isAdmin && (
          <div className="mx-6 rounded-lg border bg-slate-50 dark:bg-slate-800 p-3 mb-1">
            <div className="flex flex-wrap items-center gap-3">
              {/* Person Selector */}
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs text-slate-500 dark:text-slate-400">成员</span>
                <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                  <SelectTrigger className="h-8 text-xs w-32">
                    <SelectValue placeholder="选择成员" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部成员</SelectItem>
                    {activeMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: member.color }}
                          />
                          {member.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range */}
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs text-slate-500 dark:text-slate-400">时间</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs w-36"
                />
                <span className="text-xs text-slate-400">~</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs w-36"
                />
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs text-slate-500 dark:text-slate-400">状态</span>
                <div className="flex rounded-md border overflow-hidden">
                  <button
                    onClick={() => setStatusFilter("active")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors",
                      statusFilter === "active"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    )}
                  >
                    进行中
                  </button>
                  <button
                    onClick={() => setStatusFilter("completed")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors border-l",
                      statusFilter === "completed"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    )}
                  >
                    已完成
                  </button>
                  <button
                    onClick={() => setStatusFilter("all")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors border-l",
                      statusFilter === "all"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    )}
                  >
                    全部
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Non-admin status filter */}
        {!isAdmin && (
          <div className="px-6 pb-2 flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-500 dark:text-slate-400">状态</span>
            <div className="flex rounded-md border overflow-hidden">
              <button
                onClick={() => setStatusFilter("active")}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors",
                  statusFilter === "active"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                )}
              >
                进行中
              </button>
              <button
                onClick={() => setStatusFilter("completed")}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors border-l",
                  statusFilter === "completed"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                )}
              >
                已完成
              </button>
              <button
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors border-l",
                  statusFilter === "all"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                )}
              >
                全部
              </button>
            </div>
          </div>
        )}

        {/* View toggle */}
        <div className="px-6 pb-2 flex items-center gap-2">
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("table")}
          >
            <Table className="w-4 h-4 mr-1" />
            表格
          </Button>
          <Button
            variant={viewMode === "gantt" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("gantt")}
          >
            <BarChartHorizontal className="w-4 h-4 mr-1" />
            甘特图
          </Button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 overflow-auto">
          {viewMode === "table" ? (
            <div className="rounded-lg border overflow-hidden">
              <UITable>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead
                      className="cursor-pointer text-xs whitespace-nowrap"
                      onClick={() => handleSort("date")}
                    >
                      <span className="flex items-center gap-1">
                        日期 <SortIcon field="date" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-xs whitespace-nowrap"
                      onClick={() => handleSort("author")}
                    >
                      <span className="flex items-center gap-1">
                        作者 <SortIcon field="author" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-xs whitespace-nowrap"
                      onClick={() => handleSort("taskName")}
                    >
                      <span className="flex items-center gap-1">
                        任务名 <SortIcon field="taskName" />
                      </span>
                    </TableHead>
                    {isAdmin && (
                      <TableHead className="text-xs whitespace-nowrap">
                        负责人
                      </TableHead>
                    )}
                    <TableHead
                      className="cursor-pointer text-xs max-w-[200px]"
                      onClick={() => handleSort("currentProgress")}
                    >
                      <span className="flex items-center gap-1">
                        进展内容 <SortIcon field="currentProgress" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-xs max-w-[160px]"
                      onClick={() => handleSort("mainProblems")}
                    >
                      <span className="flex items-center gap-1">
                        问题 <SortIcon field="mainProblems" />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-xs max-w-[160px]"
                      onClick={() => handleSort("solutions")}
                    >
                      <span className="flex items-center gap-1">
                        解决思路 <SortIcon field="solutions" />
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRecords.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 7 : 6}
                        className="text-center text-sm text-slate-400 py-8"
                      >
                        暂无历史记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedRecords.map((record, idx) => {
                      const assigneePerson = getPerson(record.taskAssigneeId);
                      return (
                        <TableRow
                          key={record.id}
                          className={cn(
                            idx % 2 === 0
                              ? "bg-white dark:bg-slate-900"
                              : "bg-slate-50 dark:bg-slate-800"
                          )}
                        >
                          <TableCell className="text-xs whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {formatRecordDate(record.date)}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                            {record.author}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: record.taskColor }}
                              />
                              <span className="text-slate-700 dark:text-slate-300">
                                {record.taskName}
                              </span>
                            </span>
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-xs whitespace-nowrap">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor: assigneePerson?.color ?? "#94a3b8",
                                  }}
                                />
                                <span className="text-slate-700 dark:text-slate-300">
                                  {assigneePerson?.name ?? "未知"}
                                </span>
                              </span>
                            </TableCell>
                          )}
                          <TableCell
                            className="text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate"
                            title={record.currentProgress}
                          >
                            {truncate(record.currentProgress, 40)}
                          </TableCell>
                          <TableCell
                            className="text-xs text-slate-600 dark:text-slate-400 max-w-[160px] truncate"
                            title={record.mainProblems}
                          >
                            {truncate(record.mainProblems, 30)}
                          </TableCell>
                          <TableCell
                            className="text-xs text-slate-600 dark:text-slate-400 max-w-[160px] truncate"
                            title={record.solutions}
                          >
                            {truncate(record.solutions, 30)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </UITable>
            </div>
          ) : (
            /* Gantt Timeline View */
            <div className="rounded-lg border overflow-auto">
              {filteredTasks.length === 0 ? (
                <div className="text-center text-sm text-slate-400 py-8">
                  暂无任务数据
                </div>
              ) : (
                <div className="min-w-[600px]">
                  {/* Timeline header */}
                  <div className="flex border-b bg-slate-50 dark:bg-slate-800 sticky top-0 z-10">
                    <div className="w-40 shrink-0 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 border-r">
                      任务
                    </div>
                    <div className="flex flex-1">
                      {dateColumns.map((dateStr) => {
                        const isToday = dateStr === today;
                        return (
                          <div
                            key={dateStr}
                            className={cn(
                              "flex-1 px-0.5 py-2 text-center text-[10px] border-r border-slate-100 dark:border-slate-700 min-w-[32px]",
                              isToday
                                ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold"
                                : "text-slate-500 dark:text-slate-400"
                            )}
                          >
                            <div>{format(parseISO(dateStr), "MM/dd")}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Today marker */}
                  {dayCount > 0 && (
                    <div className="relative">
                      {/* Task rows */}
                      {filteredTasks.map((task) => {
                        const person = people.find(
                          (p) => p.id === task.assigneeId
                        );
                        const taskStart = parseDate(task.startDate);
                        const taskEnd = parseDate(task.endDate);

                        const leftOffset =
                          ((taskStart - timelineStart) /
                            (24 * 60 * 60 * 1000)) *
                          (100 / dayCount);
                        const duration =
                          (taskEnd - taskStart) / (24 * 60 * 60 * 1000) + 1;
                        const widthPercent =
                          (duration / dayCount) * 100;

                        // Progress record positions
                        const recordPositions = task.progressHistory.map(
                          (ph) => {
                            const phDate = parseDate(ph.date);
                            const offset =
                              ((phDate - timelineStart) /
                                (24 * 60 * 60 * 1000)) *
                              (100 / dayCount);
                            return { ...ph, offset };
                          }
                        );

                        return (
                          <div
                            key={task.id}
                            className="flex border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            {/* Task label */}
                            <div className="w-40 shrink-0 px-3 py-2 border-r border-slate-200 dark:border-slate-700 flex items-center gap-1.5 overflow-hidden">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{
                                  backgroundColor: person?.color ?? "#94a3b8",
                                }}
                              />
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                                {task.name}
                              </span>
                            </div>

                            {/* Timeline bar area */}
                            <div className="flex-1 relative" style={{ minHeight: 36 }}>
                              {/* Task duration bar */}
                              <div
                                className="absolute top-1.5 h-5 rounded-md shadow-sm"
                                style={{
                                  left: `${leftOffset}%`,
                                  width: `${Math.max(widthPercent, 0.5)}%`,
                                  backgroundColor: person?.color ?? "#94a3b8",
                                  opacity: 0.7,
                                }}
                              />

                              {/* Progress record dots */}
                              {recordPositions.map((rp) => (
                                <div
                                  key={rp.id}
                                  className="absolute top-1 w-5 h-5 flex items-center justify-center z-10"
                                  style={{
                                    left: `calc(${rp.offset}% - 10px)`,
                                  }}
                                  title={`${rp.author} @ ${rp.date}: ${rp.currentProgress}`}
                                >
                                  <div
                                    className="w-3 h-3 rounded-full border-2 border-white dark:border-slate-700 shadow-sm"
                                    style={{
                                      backgroundColor:
                                        person?.color ?? "#94a3b8",
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {/* Today vertical line */}
                      {dateColumns.includes(today) && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
                          style={{
                            left: `calc(10rem + ${((dateColumns.indexOf(today)) / dayCount) * 100}%)`,
                          }}
                        >
                          <div className="absolute -top-1 -left-1.5 w-3 h-3 rounded-full bg-red-500" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
