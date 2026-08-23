import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChartHorizontal,
  CalendarDays,
  Clock3,
  Filter,
  Table2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import AttachmentList from "@/components/AttachmentList";
import type { Person, ProgressRecord, Task } from "@/types";

export interface HistoryPageProps {
  tasks: Task[];
  people: Person[];
  isAdmin: boolean;
}

type ViewMode = "table" | "gantt";
type StatusFilter = "all" | "active" | "completed";
type SortField =
  | "date"
  | "author"
  | "taskName"
  | "currentProgress"
  | "mainProblems"
  | "solutions";
type SortDirection = "asc" | "desc";

interface FlatRecord extends ProgressRecord {
  taskId: string;
  taskName: string;
  assigneeId: string;
  color: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_WIDTH = 36;

function inputDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function displayDate(value: string) {
  try {
    return format(parseISO(value), "yyyy-MM-dd");
  } catch {
    return value;
  }
}

export default function HistoryPage({ tasks, people, isAdmin }: HistoryPageProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedPersonId, setSelectedPersonId] = useState("all");
  const [startDate, setStartDate] = useState(inputDate(subDays(new Date(), 30)));
  const [endDate, setEndDate] = useState(inputDate(new Date()));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const activeMembers = useMemo(
    () =>
      people
        .filter((person) => person.status !== "archived")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [people]
  );

  const filteredTasks = useMemo(() => {
    const start = startDate ? dateValue(startDate) : Number.NEGATIVE_INFINITY;
    const end = endDate ? dateValue(endDate) + DAY_MS - 1 : Number.POSITIVE_INFINITY;

    return tasks.filter((task) => {
      if (
        isAdmin &&
        selectedPersonId !== "all" &&
        task.assigneeId !== selectedPersonId
      ) {
        return false;
      }
      if (statusFilter === "active" && task.progress >= 100) return false;
      if (statusFilter === "completed" && task.progress < 100) return false;

      const taskStart = dateValue(task.startDate);
      const taskEnd = dateValue(task.endDate);
      return taskEnd >= start && taskStart <= end;
    });
  }, [endDate, isAdmin, selectedPersonId, startDate, statusFilter, tasks]);

  const flatRecords = useMemo<FlatRecord[]>(() => {
    const start = startDate ? dateValue(startDate) : Number.NEGATIVE_INFINITY;
    const end = endDate ? dateValue(endDate) + DAY_MS - 1 : Number.POSITIVE_INFINITY;
    return filteredTasks.flatMap((task) => {
      const person = people.find((candidate) => candidate.id === task.assigneeId);
      return (task.progressHistory ?? [])
        .filter((record) => {
          const recordDate = dateValue(record.date);
          return recordDate >= start && recordDate <= end;
        })
        .map((record) => ({
          ...record,
          taskId: task.id,
          taskName: task.name,
          assigneeId: task.assigneeId,
          color: person?.color || "#64748b",
        }));
    });
  }, [endDate, filteredTasks, people, startDate]);

  const sortedRecords = useMemo(() => {
    const records = [...flatRecords];
    records.sort((left, right) => {
      const leftValue =
        sortField === "date" ? dateValue(left.date) : String(left[sortField] || "");
      const rightValue =
        sortField === "date"
          ? dateValue(right.date)
          : String(right[sortField] || "");
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return records;
  }, [flatRecords, sortDirection, sortField]);

  const dateColumns = useMemo(() => {
    const explicitStart = dateValue(startDate);
    const explicitEnd = dateValue(endDate);
    const taskStarts = filteredTasks.map((task) => dateValue(task.startDate)).filter(Boolean);
    const taskEnds = filteredTasks.map((task) => dateValue(task.endDate)).filter(Boolean);
    const start = explicitStart || Math.min(...taskStarts);
    const end = explicitEnd || Math.max(...taskEnds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

    const count = Math.min(730, Math.floor((end - start) / DAY_MS) + 1);
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start + index * DAY_MS);
      return {
        key: format(date, "yyyy-MM-dd"),
        label: format(date, "MM/dd"),
        timestamp: date.getTime(),
      };
    });
  }, [endDate, filteredTasks, startDate]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="size-3 opacity-40" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="size-3" />
    ) : (
      <ArrowDown className="size-3" />
    );
  };

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "active", label: "进行中" },
    { value: "completed", label: "已完成" },
  ];

  return (
    <main className="min-w-0 space-y-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-blue-900/15 pb-4 dark:border-blue-300/15">
        <div>
          <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
            <Clock3 className="size-5" />
            <h1 className="text-lg font-semibold">进展历史</h1>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{filteredTasks.length} 个任务</span>
            <span aria-hidden="true">·</span>
            <span>{flatRecords.length} 条记录</span>
          </div>
        </div>

        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
          <Button
            variant={viewMode === "table" ? "default" : "ghost"}
            size="sm"
            className={cn(
              "h-8 rounded-md text-xs",
              viewMode === "table" && "bg-blue-800 hover:bg-blue-700"
            )}
            onClick={() => setViewMode("table")}
          >
            <Table2 className="size-3.5" />
            表格
          </Button>
          <Button
            variant={viewMode === "gantt" ? "default" : "ghost"}
            size="sm"
            className={cn(
              "h-8 rounded-md text-xs",
              viewMode === "gantt" && "bg-blue-800 hover:bg-blue-700"
            )}
            onClick={() => setViewMode("gantt")}
          >
            <BarChartHorizontal className="size-3.5" />
            时间线
          </Button>
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && (
            <label className="min-w-40 flex-1 sm:max-w-52">
              <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <UserRound className="size-3.5" />成员
              </span>
              <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                <SelectTrigger className="h-9 rounded-md">
                  <SelectValue />
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
            </label>
          )}

          <label className="min-w-36 flex-1 sm:max-w-44">
            <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <CalendarDays className="size-3.5" />开始日期
            </span>
            <Input
              type="date"
              className="h-9 rounded-md"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>

          <label className="min-w-36 flex-1 sm:max-w-44">
            <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <CalendarDays className="size-3.5" />结束日期
            </span>
            <Input
              type="date"
              className="h-9 rounded-md"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>

          <div>
            <span className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Filter className="size-3.5" />状态
            </span>
            <div className="inline-flex h-9 rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "rounded px-2.5 text-xs transition-colors",
                    statusFilter === option.value
                      ? "bg-blue-800 font-medium text-white"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  )}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {viewMode === "table" ? (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-900">
                  {(
                    [
                      ["date", "日期"],
                      ["author", "作者"],
                      ["taskName", "任务"],
                    ] as Array<[SortField, string]>
                  ).map(([field, label]) => (
                    <TableHead key={field} className="whitespace-nowrap">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs"
                        onClick={() => handleSort(field)}
                      >
                        {label}
                        {sortIcon(field)}
                      </button>
                    </TableHead>
                  ))}
                  {isAdmin && <TableHead className="text-xs">负责人</TableHead>}
                  {(
                    [
                      ["currentProgress", "进展内容"],
                      ["mainProblems", "问题"],
                      ["solutions", "解决思路"],
                    ] as Array<[SortField, string]>
                  ).map(([field, label]) => (
                    <TableHead key={field}>
                      <button
                        type="button"
                        className="flex items-center gap-1 whitespace-nowrap text-xs"
                        onClick={() => handleSort(field)}
                      >
                        {label}
                        {sortIcon(field)}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRecords.length ? (
                  sortedRecords.map((record) => {
                    const assignee = people.find(
                      (person) => person.id === record.assigneeId
                    );
                    return (
                      <TableRow key={`${record.taskId}-${record.id}`}>
                        <TableCell className="whitespace-nowrap text-xs text-slate-500">
                          {displayDate(record.date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-medium">
                          {record.author}
                        </TableCell>
                        <TableCell className="max-w-48 text-xs">
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: record.color }}
                            />
                            <span className="truncate" title={record.taskName}>
                              {record.taskName}
                            </span>
                          </span>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="whitespace-nowrap text-xs">
                            {assignee?.name || "未知"}
                          </TableCell>
                        )}
                        {[record.currentProgress, record.mainProblems, record.solutions].map(
                          (value, index) => (
                            <TableCell
                              key={index}
                              className="max-w-56 text-xs text-slate-600 dark:text-slate-300"
                            >
                              <p className="line-clamp-2" title={value}>
                                {value || "-"}
                              </p>
                              {index === 0 && (
                                <AttachmentList attachments={record.attachments} />
                              )}
                            </TableCell>
                          )
                        )}
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={isAdmin ? 7 : 6}
                      className="h-32 text-center text-sm text-slate-400"
                    >
                      当前筛选范围暂无进展记录
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {filteredTasks.length && dateColumns.length ? (
            <div className="overflow-x-auto">
              <div
                style={{ minWidth: 176 + dateColumns.length * DAY_WIDTH }}
                className="text-xs"
              >
                <div className="sticky top-0 z-10 flex border-b bg-slate-50 dark:bg-slate-900">
                  <div className="w-44 shrink-0 border-r px-3 py-2 font-semibold">任务</div>
                  <div className="flex">
                    {dateColumns.map((column) => (
                      <div
                        key={column.key}
                        className={cn(
                          "shrink-0 border-r border-slate-200 py-2 text-center text-sm text-slate-500 dark:border-slate-800",
                          column.key === inputDate(new Date()) &&
                            "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        )}
                        style={{ width: DAY_WIDTH }}
                      >
                        {column.label}
                      </div>
                    ))}
                  </div>
                </div>

                {filteredTasks.map((task) => {
                  const person = people.find((candidate) => candidate.id === task.assigneeId);
                  const timelineStart = dateColumns[0].timestamp;
                  const taskStartIndex = (dateValue(task.startDate) - timelineStart) / DAY_MS;
                  const taskEndIndex = (dateValue(task.endDate) - timelineStart) / DAY_MS;
                  const left = Math.max(0, taskStartIndex * DAY_WIDTH);
                  const rightIndex = Math.min(dateColumns.length, taskEndIndex + 1);
                  const width = Math.max(4, rightIndex * DAY_WIDTH - left);

                  return (
                    <div key={task.id} className="flex border-b last:border-b-0 dark:border-slate-800">
                      <div className="flex w-44 shrink-0 items-center gap-2 border-r px-3 py-2 dark:border-slate-800">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: person?.color || "#64748b" }}
                        />
                        <span className="truncate font-medium" title={task.name}>
                          {task.name}
                        </span>
                      </div>
                      <div
                        className="relative h-10"
                        style={{ width: dateColumns.length * DAY_WIDTH }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 grid"
                          style={{
                            gridTemplateColumns: `repeat(${dateColumns.length}, ${DAY_WIDTH}px)`,
                          }}
                          aria-hidden="true"
                        >
                          {dateColumns.map((column) => (
                            <span key={column.key} className="border-r dark:border-slate-800" />
                          ))}
                        </div>
                        <div
                          className="absolute top-2.5 h-5 rounded bg-blue-700/75"
                          style={{
                            left,
                            width,
                            backgroundColor: person?.color || "#2563eb",
                          }}
                          title={`${task.name}: ${task.startDate} - ${task.endDate}`}
                        />
                        {(task.progressHistory ?? []).map((record) => {
                          const offset =
                            ((dateValue(record.date) - timelineStart) / DAY_MS) *
                            DAY_WIDTH;
                          if (offset < 0 || offset > dateColumns.length * DAY_WIDTH) return null;
                          return (
                            <span
                              key={record.id}
                              className="absolute top-3 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-blue-900 shadow-sm dark:border-slate-900"
                              style={{ left: offset + DAY_WIDTH / 2 }}
                              title={`${record.author} · ${displayDate(record.date)} · ${record.currentProgress}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <BarChartHorizontal className="size-6" />
              当前筛选范围暂无任务
            </div>
          )}
        </section>
      )}

      {dateColumns.length === 730 && (
        <Badge variant="outline" className="rounded-md text-xs">
          时间线最多展示 730 天，请缩小日期范围
        </Badge>
      )}
    </main>
  );
}
