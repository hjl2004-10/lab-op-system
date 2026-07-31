import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  forwardRef,
} from "react";
import {
  differenceInDays,
  addDays,
  startOfDay,
  format,
  getDay,
  isSameDay,
  parseISO,
} from "date-fns";
import type { Task, Person } from "@/types";
import { cn } from "@/lib/utils";
import TaskBar from "./TaskBar";

// ============================================================
// Types
// ============================================================

interface TimelineProps {
  tasks: Task[];
  people: Person[];
  viewMode: "day" | "week" | "month";
  holidays: Record<string, string>;
  onTaskClick: (task: Task) => void;
  onVerticalScroll?: (scrollTop: number) => void;
}

export interface TimelineHandle {
  scrollToToday: () => void;
  scrollByPage: (direction: -1 | 1) => void;
  setScrollTop: (scrollTop: number) => void;
}

interface DayCell {
  date: Date;
  offset: number;
  width: number;
  isWeekend: boolean;
  isToday: boolean;
  isHoliday: boolean;
  holidayName?: string;
}

interface HeaderColumn {
  date: Date;
  label: string;
  subLabel?: string;
  width: number;
  offset: number;
  isWeekend: boolean;
  isToday: boolean;
  isHoliday: boolean;
  holidayName?: string;
  dayCells: DayCell[];
}

// ============================================================
// Zoom support
// ============================================================

function getDayWidth(viewMode: "day" | "week" | "month"): number {
  switch (viewMode) {
    case "day":
      return 80;
    case "week":
      return 30;
    case "month":
      return 16;
  }
}

// ============================================================
// Helper functions
// ============================================================

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function generateDayCells(
  rangeStart: Date,
  rangeEnd: Date,
  holidays: Record<string, string>,
  dayWidth: number
): DayCell[] {
  const cells: DayCell[] = [];
  const today = startOfDay(new Date());
  let current = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);

  while (current <= end) {
    const dateStr = format(current, "yyyy-MM-dd");
    const dayOfWeek = getDay(current);

    cells.push({
      date: new Date(current),
      offset: cells.length * dayWidth,
      width: dayWidth,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isToday: isSameDay(current, today),
      isHoliday: dateStr in holidays,
      holidayName: holidays[dateStr],
    });

    current = addDays(current, 1);
  }

  return cells;
}

function generateColumns(
  rangeStart: Date,
  rangeEnd: Date,
  viewMode: "day" | "week" | "month",
  holidays: Record<string, string>,
  dayWidth: number
): { dayCells: DayCell[]; columns: HeaderColumn[]; totalWidth: number } {
  const dayCells = generateDayCells(rangeStart, rangeEnd, holidays, dayWidth);

  if (viewMode === "day") {
    const columns: HeaderColumn[] = dayCells.map((cell) => ({
      date: cell.date,
      label: format(cell.date, "M/d"),
      subLabel: WEEKDAY_LABELS[getDay(cell.date)],
      width: dayWidth,
      offset: cell.offset,
      isWeekend: cell.isWeekend,
      isToday: cell.isToday,
      isHoliday: cell.isHoliday,
      holidayName: cell.holidayName,
      dayCells: [cell],
    }));
    return { dayCells, columns, totalWidth: dayCells.length * dayWidth };
  }

  if (viewMode === "week") {
    const columns: HeaderColumn[] = [];
    for (let i = 0; i < dayCells.length; i += 7) {
      const chunk = dayCells.slice(i, i + 7);
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      columns.push({
        date: first.date,
        label: `${format(first.date, "M/d")}-${format(last.date, "M/d")}`,
        width: chunk.length * dayWidth,
        offset: first.offset,
        isWeekend: chunk.some((d) => d.isWeekend),
        isToday: chunk.some((d) => d.isToday),
        isHoliday: chunk.some((d) => d.isHoliday),
        holidayName: chunk.find((d) => d.isHoliday)?.holidayName,
        dayCells: chunk,
      });
    }
    return { dayCells, columns, totalWidth: dayCells.length * dayWidth };
  }

  // Month view
  const columns: HeaderColumn[] = [];
  let currentChunk: DayCell[] = [];

  for (const cell of dayCells) {
    if (currentChunk.length === 0) {
      currentChunk.push(cell);
    } else {
      const firstOfMonth = currentChunk[0];
      if (format(cell.date, "yyyy-MM") === format(firstOfMonth.date, "yyyy-MM")) {
        currentChunk.push(cell);
      } else {
        columns.push({
          date: firstOfMonth.date,
          label: format(firstOfMonth.date, "yyyy年M月"),
          width: currentChunk.length * dayWidth,
          offset: firstOfMonth.offset,
          isWeekend: currentChunk.some((d) => d.isWeekend),
          isToday: currentChunk.some((d) => d.isToday),
          isHoliday: currentChunk.some((d) => d.isHoliday),
          holidayName: currentChunk.find((d) => d.isHoliday)?.holidayName,
          dayCells: currentChunk,
        });
        currentChunk = [cell];
      }
    }
  }

  if (currentChunk.length > 0) {
    const first = currentChunk[0];
    columns.push({
      date: first.date,
      label: format(first.date, "yyyy年M月"),
      width: currentChunk.length * dayWidth,
      offset: first.offset,
      isWeekend: currentChunk.some((d) => d.isWeekend),
      isToday: currentChunk.some((d) => d.isToday),
      isHoliday: currentChunk.some((d) => d.isHoliday),
      holidayName: currentChunk.find((d) => d.isHoliday)?.holidayName,
      dayCells: currentChunk,
    });
  }

  return { dayCells, columns, totalWidth: dayCells.length * dayWidth };
}

function getTaskOffset(
  taskDate: Date,
  rangeStart: Date,
  _viewMode: string,
  _columns: HeaderColumn[],
  dayWidth: number
): number {
  // Always calculate based on day difference * dayWidth — columns are for display only
  return differenceInDays(startOfDay(taskDate), startOfDay(rangeStart)) * dayWidth;
}

// ============================================================
// Component
// ============================================================

const Timeline = forwardRef<TimelineHandle, TimelineProps>(
  ({ tasks, people, viewMode, holidays, onTaskClick, onVerticalScroll }, ref) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const dayWidth = getDayWidth(viewMode);

    const { rangeStart, dayCells, columns, todayOffset, totalWidth } = useMemo(() => {
      if (tasks.length === 0) {
        const today = startOfDay(new Date());
        return {
          rangeStart: today,
          dayCells: [],
          columns: [],
          todayOffset: null,
          totalWidth: 0,
        };
      }

      // Find date range with padding
      const startDates = tasks.map((t) => startOfDay(parseISO(t.startDate)));
      const endDates = tasks.map((t) => startOfDay(parseISO(t.endDate)));
      const minStart = new Date(Math.min(...startDates.map((d) => d.getTime())));
      const maxEnd = new Date(Math.max(...endDates.map((d) => d.getTime())));

      const paddedStart = addDays(minStart, -7);
      const paddedEnd = addDays(maxEnd, 7);

      const { dayCells, columns, totalWidth } = generateColumns(
        paddedStart,
        paddedEnd,
        viewMode,
        holidays,
        dayWidth
      );

      const today = startOfDay(new Date());
      let tOffset: number | null = null;
      if (today >= paddedStart && today <= paddedEnd) {
        tOffset = differenceInDays(today, paddedStart) * dayWidth;
      }

      return {
        rangeStart: paddedStart,
        dayCells,
        columns,
        todayOffset: tOffset,
        totalWidth,
      };
    }, [tasks, viewMode, holidays, dayWidth]);

    useImperativeHandle(ref, () => ({
      scrollToToday: () => {
        const container = scrollRef.current;
        if (!container) return;
        const target = todayOffset === null ? 0 : Math.max(0, todayOffset - container.clientWidth / 2);
        container.scrollTo({ left: target, behavior: "smooth" });
      },
      scrollByPage: (direction) => {
        const container = scrollRef.current;
        if (!container) return;
        container.scrollBy({ left: direction * container.clientWidth * 0.8, behavior: "smooth" });
      },
      setScrollTop: (scrollTop) => {
        const container = scrollRef.current;
        if (container && container.scrollTop !== scrollTop) {
          container.scrollTop = scrollTop;
        }
      },
    }), [todayOffset]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container || todayOffset === null) return;
      const target = Math.max(0, todayOffset - container.clientWidth / 2);
      container.scrollLeft = target;
    }, [todayOffset, viewMode]);

    if (tasks.length === 0) {
      return (
        <div ref={scrollRef} className="h-full flex-1 relative overflow-auto min-h-[320px] flex items-center justify-center bg-white dark:bg-slate-800">
          <span className="text-sm text-slate-400 dark:text-slate-500">
            暂无任务
          </span>
        </div>
      );
    }

    return (
      <div
        ref={scrollRef}
        className="h-full flex-1 relative overflow-auto bg-white dark:bg-slate-800"
        onScroll={(event) => onVerticalScroll?.(event.currentTarget.scrollTop)}
      >
        <div style={{ minWidth: totalWidth }}>
          {/* ---- Header ---- */}
          <div className="sticky top-0 z-20 flex h-[48px] shrink-0">
            {columns.map((col) => (
              <div
                key={col.offset}
                className={cn(
                  "flex flex-col items-center justify-center border-r border-b",
                  "border-slate-200 dark:border-slate-700",
                  "bg-slate-50 dark:bg-slate-900 text-[10px] select-none",
                  col.isWeekend && "bg-slate-50/80 dark:bg-slate-800/30",
                  col.isHoliday && "bg-red-50/40 dark:bg-red-900/15"
                )}
                style={{ width: col.width, minWidth: col.width }}
              >
                <span
                  className={cn(
                    "font-medium leading-tight",
                    col.isToday
                      ? "text-red-500 font-bold"
                      : "text-slate-600 dark:text-slate-300"
                  )}
                >
                  {col.label}
                </span>
                {col.subLabel && (
                  <span
                    className={cn(
                      "text-[9px] leading-tight mt-px",
                      col.subLabel === "日" || col.subLabel === "六"
                        ? "text-slate-400 dark:text-slate-500"
                        : "text-slate-500 dark:text-slate-400"
                    )}
                  >
                    {col.subLabel}
                  </span>
                )}
                {col.holidayName && (
                  <span className="text-[8px] text-red-400/70 leading-tight">
                    {col.holidayName}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* ---- Body ---- */}
          <div className="relative" style={{ height: tasks.length * 48 }}>
            {/* Weekend / holiday background tints */}
            {dayCells.map((day) => (
              <div
                key={`bg-${day.offset}`}
                className={cn(
                  "absolute top-0 bottom-0",
                  day.isWeekend && "bg-slate-50/50 dark:bg-slate-800/20",
                  day.isHoliday && "bg-red-50/30 dark:bg-red-900/10"
                )}
                style={{ left: day.offset, width: day.width }}
              />
            ))}

            {/* Vertical grid lines */}
            {dayCells.map((day) => (
              <div
                key={`line-${day.offset}`}
                className="absolute top-0 bottom-0 w-px bg-slate-100 dark:bg-slate-800/50"
                style={{ left: day.offset }}
              />
            ))}
            {/* Right edge line */}
            <div
              className="absolute top-0 bottom-0 w-px bg-slate-100 dark:bg-slate-800/50"
              style={{ left: totalWidth }}
            />

            {/* Today line */}
            {todayOffset !== null && (
              <>
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
                  style={{ left: todayOffset, backgroundColor: "#ef4444" }}
                />
                <div
                  className="absolute z-10 bg-red-500 text-white text-[8px] px-1 py-0.5 rounded pointer-events-none"
                  style={{ left: todayOffset + 4, top: 4, backgroundColor: "#ef4444" }}
                >
                  今天
                </div>
              </>
            )}

            {/* Task rows + bars */}
            {tasks.map((task, index) => {
              const person = people.find((p) => p.id === task.assigneeId);
              const taskStart = parseISO(task.startDate);
              const taskEnd = parseISO(task.endDate);

              const left = getTaskOffset(taskStart, rangeStart, viewMode, columns, dayWidth);
              const durationDays =
                differenceInDays(startOfDay(taskEnd), startOfDay(taskStart)) + 1;
              const width = durationDays * dayWidth;

              // Skip if completely outside visible range
              if (left + width < 0 || left > totalWidth) return null;

              return (
                <div
                  key={task.id}
                  className="absolute left-0 border-b border-slate-100 dark:border-slate-800/50"
                  style={{
                    top: index * 48,
                    height: 48,
                    width: totalWidth,
                  }}
                >
                  <TaskBar
                    task={task}
                    person={person}
                    left={left}
                    width={width}
                    onClick={() => onTaskClick(task)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

Timeline.displayName = "Timeline";

export default Timeline;
