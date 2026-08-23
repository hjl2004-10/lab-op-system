import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addDays,
  differenceInDays,
  format,
  getDay,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import { GripVertical, Lock } from "lucide-react";
import TaskBar from "@/components/TaskBar";
import { cn } from "@/lib/utils";
import { formatDateRange } from "@/utils";
import type { Person, Task } from "@/types";

interface GanttBoardProps {
  tasks: Task[];
  people: Person[];
  viewMode: "day" | "week" | "month";
  holidays: Record<string, string>;
  listWidth: number;
  showTaskColumn: boolean;
  showTimeline: boolean;
  onTaskClick: (task: Task) => void;
  onReorder: (taskIds: string[]) => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

export interface GanttBoardHandle {
  scrollToToday: () => void;
  scrollByPage: (direction: -1 | 1) => void;
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
}

const ROW_HEIGHT = 48;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function getDayWidth(viewMode: GanttBoardProps["viewMode"]): number {
  if (viewMode === "day") return 80;
  if (viewMode === "week") return 30;
  return 16;
}

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
    const dateKey = format(current, "yyyy-MM-dd");
    const weekday = getDay(current);
    cells.push({
      date: new Date(current),
      offset: cells.length * dayWidth,
      width: dayWidth,
      isWeekend: weekday === 0 || weekday === 6,
      isToday: isSameDay(current, today),
      isHoliday: dateKey in holidays,
      holidayName: holidays[dateKey],
    });
    current = addDays(current, 1);
  }

  return cells;
}

function generateColumns(
  dayCells: DayCell[],
  viewMode: GanttBoardProps["viewMode"]
): HeaderColumn[] {
  if (viewMode === "day") {
    return dayCells.map((cell) => ({
      date: cell.date,
      label: format(cell.date, "M/d"),
      subLabel: WEEKDAY_LABELS[getDay(cell.date)],
      width: cell.width,
      offset: cell.offset,
      isWeekend: cell.isWeekend,
      isToday: cell.isToday,
      isHoliday: cell.isHoliday,
      holidayName: cell.holidayName,
    }));
  }

  if (viewMode === "week") {
    const columns: HeaderColumn[] = [];
    for (let index = 0; index < dayCells.length; index += 7) {
      const group = dayCells.slice(index, index + 7);
      const first = group[0];
      const last = group[group.length - 1];
      columns.push({
        date: first.date,
        label: `${format(first.date, "M/d")}-${format(last.date, "M/d")}`,
        width: group.reduce((sum, cell) => sum + cell.width, 0),
        offset: first.offset,
        isWeekend: group.some((cell) => cell.isWeekend),
        isToday: group.some((cell) => cell.isToday),
        isHoliday: group.some((cell) => cell.isHoliday),
        holidayName: group.find((cell) => cell.isHoliday)?.holidayName,
      });
    }
    return columns;
  }

  const columns: HeaderColumn[] = [];
  let group: DayCell[] = [];
  for (const cell of dayCells) {
    if (
      group.length > 0 &&
      format(cell.date, "yyyy-MM") !== format(group[0].date, "yyyy-MM")
    ) {
      const first = group[0];
      columns.push({
        date: first.date,
        label: format(first.date, "yyyy年M月"),
        width: group.reduce((sum, item) => sum + item.width, 0),
        offset: first.offset,
        isWeekend: group.some((item) => item.isWeekend),
        isToday: group.some((item) => item.isToday),
        isHoliday: group.some((item) => item.isHoliday),
        holidayName: group.find((item) => item.isHoliday)?.holidayName,
      });
      group = [];
    }
    group.push(cell);
  }

  if (group.length > 0) {
    const first = group[0];
    columns.push({
      date: first.date,
      label: format(first.date, "yyyy年M月"),
      width: group.reduce((sum, item) => sum + item.width, 0),
      offset: first.offset,
      isWeekend: group.some((item) => item.isWeekend),
      isToday: group.some((item) => item.isToday),
      isHoliday: group.some((item) => item.isHoliday),
      holidayName: group.find((item) => item.isHoliday)?.holidayName,
    });
  }

  return columns;
}

function progressColor(progress: number): string {
  if (progress >= 100) return "text-blue-500";
  if (progress > 0) return "text-amber-500";
  return "text-slate-400";
}

const GanttBoard = forwardRef<GanttBoardHandle, GanttBoardProps>(function GanttBoard(
  {
    tasks,
    people,
    viewMode,
    holidays,
    listWidth,
    showTaskColumn,
    showTimeline,
    onTaskClick,
    onReorder,
    onResizeStart,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dayWidth = getDayWidth(viewMode);

  const timeline = useMemo(() => {
    if (tasks.length === 0) {
      return {
        rangeStart: startOfDay(new Date()),
        dayCells: [] as DayCell[],
        columns: [] as HeaderColumn[],
        totalWidth: 0,
        todayOffset: null as number | null,
      };
    }

    const starts = tasks.map((task) => startOfDay(parseISO(task.startDate)));
    const ends = tasks.map((task) => startOfDay(parseISO(task.endDate)));
    const rangeStart = addDays(
      new Date(Math.min(...starts.map((date) => date.getTime()))),
      -7
    );
    const rangeEnd = addDays(
      new Date(Math.max(...ends.map((date) => date.getTime()))),
      7
    );
    const dayCells = generateDayCells(rangeStart, rangeEnd, holidays, dayWidth);
    const today = startOfDay(new Date());
    const todayOffset =
      today >= rangeStart && today <= rangeEnd
        ? differenceInDays(today, rangeStart) * dayWidth
        : null;

    return {
      rangeStart,
      dayCells,
      columns: generateColumns(dayCells, viewMode),
      totalWidth: dayCells.length * dayWidth,
      todayOffset,
    };
  }, [dayWidth, holidays, tasks, viewMode]);

  const taskColumnWidth = showTaskColumn && showTimeline ? listWidth : 0;
  const contentWidth = showTimeline
    ? taskColumnWidth + timeline.totalWidth
    : undefined;

  useImperativeHandle(
    ref,
    () => ({
      scrollToToday: () => {
        const container = scrollRef.current;
        if (!container) return;
        const availableWidth = Math.max(0, container.clientWidth - taskColumnWidth);
        const target =
          timeline.todayOffset === null
            ? 0
            : taskColumnWidth + timeline.todayOffset - availableWidth / 2;
        container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
      },
      scrollByPage: (direction) => {
        const container = scrollRef.current;
        if (!container) return;
        const availableWidth = Math.max(0, container.clientWidth - taskColumnWidth);
        container.scrollBy({
          left: direction * availableWidth * 0.8,
          behavior: "smooth",
        });
      },
    }),
    [taskColumnWidth, timeline.todayOffset]
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !showTimeline || timeline.todayOffset === null) return;
    const availableWidth = Math.max(0, container.clientWidth - taskColumnWidth);
    container.scrollLeft = Math.max(
      0,
      taskColumnWidth + timeline.todayOffset - availableWidth / 2
    );
  }, [showTimeline, taskColumnWidth, timeline.todayOffset, viewMode]);

  const handleDrop = (targetTask: Task, dropIndex: number) => {
    if (!draggingId || draggingId === targetTask.id) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const ids = tasks.map((task) => task.id);
    const fromIndex = ids.indexOf(draggingId);
    if (fromIndex < 0) return;
    ids.splice(fromIndex, 1);
    ids.splice(fromIndex < dropIndex ? dropIndex - 1 : dropIndex, 0, draggingId);
    onReorder(ids);
    setDraggingId(null);
    setDragOverId(null);
  };

  const taskCellStyle = showTimeline
    ? { width: listWidth, minWidth: listWidth }
    : { width: "100%", minWidth: "100%" };

  return (
    <div ref={scrollRef} className="gantt-board-scroll" data-gantt-scroll-container>
      <div
        className="gantt-board-content"
        style={
          showTimeline
            ? { width: contentWidth, minWidth: contentWidth }
            : { width: "100%", minWidth: "100%" }
        }
      >
        <div className="gantt-board-header">
          {showTaskColumn && (
            <div className="gantt-board-task-header" style={taskCellStyle}>
              <span>任务</span>
              {showTimeline && onResizeStart && (
                <button
                  className="gantt-board-resize"
                  onPointerDown={onResizeStart}
                  aria-label="调整任务列表宽度"
                  title="拖动调整任务列表宽度"
                />
              )}
            </div>
          )}

          {showTimeline && (
            <div
              className="gantt-board-date-header"
              style={{ width: timeline.totalWidth, minWidth: timeline.totalWidth }}
            >
              {timeline.columns.map((column) => (
                <div
                  key={column.offset}
                  className={cn(
                    "gantt-board-date-cell",
                    column.isWeekend && "weekend",
                    column.isHoliday && "holiday",
                    column.isToday && "today"
                  )}
                  style={{ width: column.width, minWidth: column.width }}
                >
                  <span>{column.label}</span>
                  {column.holidayName && <em>{column.holidayName}</em>}
                </div>
              ))}
            </div>
          )}
        </div>

        {showTimeline && tasks.length > 0 && (
          <div
            className="gantt-board-background"
            style={{
              left: taskColumnWidth,
              top: ROW_HEIGHT,
              width: timeline.totalWidth,
              height: tasks.length * ROW_HEIGHT,
            }}
            aria-hidden="true"
          >
            {timeline.dayCells.map((day) => (
              <div
                key={day.offset}
                className={cn(
                  "gantt-board-day-background",
                  day.isWeekend && "weekend",
                  day.isHoliday && "holiday"
                )}
                style={{ left: day.offset, width: day.width }}
              />
            ))}
            {timeline.todayOffset !== null && (
              <div
                className="gantt-board-today-line"
                style={{ left: timeline.todayOffset }}
              >
                <span>今天</span>
              </div>
            )}
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="gantt-board-empty">暂无任务</div>
        ) : (
          tasks.map((task, index) => {
            const person = people.find((candidate) => candidate.id === task.assigneeId);
            const isCompleted = task.progress >= 100;
            const isDragOver = dragOverId === task.id;
            const taskStart = startOfDay(parseISO(task.startDate));
            const taskEnd = startOfDay(parseISO(task.endDate));
            const barLeft =
              differenceInDays(taskStart, timeline.rangeStart) * dayWidth;
            const barWidth =
              (differenceInDays(taskEnd, taskStart) + 1) * dayWidth;

            return (
              <div
                key={task.id}
                className={cn(
                  "gantt-board-row group",
                  draggingId === task.id && "dragging",
                  isDragOver && "drag-over",
                  isCompleted && "completed"
                )}
              >
                {showTaskColumn && (
                  <div
                    draggable
                    className="gantt-board-task-cell"
                    style={taskCellStyle}
                    onDragStart={(event) => {
                      setDraggingId(task.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverId(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggingId !== task.id) setDragOverId(task.id);
                    }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(task, index);
                    }}
                    onClick={() => onTaskClick(task)}
                  >
                    <GripVertical className="gantt-board-drag-handle" size={14} />
                    <span
                      className="gantt-board-person-dot"
                      style={{ backgroundColor: person?.color ?? "#94a3b8" }}
                    />
                    <div className="gantt-board-task-copy">
                      <strong title={task.name} className="flex items-center gap-1">
                        {task.isPrivate && (
                          <Lock className="size-3 shrink-0 text-slate-400" aria-label="仅自己可见" />
                        )}
                        {task.name}
                      </strong>
                      <span>
                        {formatDateRange(task.startDate, task.endDate)}
                        <em className={progressColor(task.progress)}>
                          {task.progress}%
                        </em>
                      </span>
                    </div>
                  </div>
                )}

                {showTimeline && (
                  <div
                    className="gantt-board-timeline-cell"
                    style={{ width: timeline.totalWidth, minWidth: timeline.totalWidth }}
                  >
                    <TaskBar
                      task={task}
                      person={person}
                      left={barLeft}
                      width={barWidth}
                      onClick={() => onTaskClick(task)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

GanttBoard.displayName = "GanttBoard";

export default GanttBoard;
