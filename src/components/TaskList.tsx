import { useState, useRef, useCallback, forwardRef } from "react";
import { GripVertical } from "lucide-react";
import type { Task, Person } from "@/types";
import { formatDateRange } from "@/utils";
import { cn } from "@/lib/utils";

interface TaskListProps {
  tasks: Task[];
  people: Person[];
  onTaskClick: (task: Task) => void;
  onReorder: (taskIds: string[]) => void;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
}

const TaskList = forwardRef<HTMLDivElement, TaskListProps>(function TaskList({
  tasks,
  people,
  onTaskClick,
  onReorder,
  onScroll,
}, ref) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragOverIndexRef = useRef<number>(-1);

  const getPerson = useCallback(
    (assigneeId: string) => people.find((p) => p.id === assigneeId),
    [people]
  );

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, task: Task) => {
    setDraggingId(task.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
    // Delay opacity change so the drag image is fully opaque
    requestAnimationFrame(() => {
      const el = e.target as HTMLElement;
      el.classList.add("opacity-50");
    });
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    el.classList.remove("opacity-50");
    setDraggingId(null);
    setDragOverId(null);
    dragOverIndexRef.current = -1;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, task: Task, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (task.id !== draggingId) {
      setDragOverId(task.id);
      dragOverIndexRef.current = index;
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, _task: Task, dropIndex: number) => {
    e.preventDefault();
    const draggedTaskId = e.dataTransfer.getData("text/plain");
    if (!draggedTaskId || draggedTaskId === _task.id) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const currentIds = tasks.map((t) => t.id);
    const fromIndex = currentIds.indexOf(draggedTaskId);
    if (fromIndex === -1) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    // Reorder: remove from old position, insert at new position
    const newIds = [...currentIds];
    newIds.splice(fromIndex, 1);
    // Adjust drop index if removing from before
    const adjustedDropIndex = fromIndex < dropIndex ? dropIndex - 1 : dropIndex;
    newIds.splice(adjustedDropIndex, 0, draggedTaskId);

    onReorder(newIds);
    setDraggingId(null);
    setDragOverId(null);
    dragOverIndexRef.current = -1;
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 100) return "text-emerald-500";
    if (progress > 0) return "text-amber-500";
    return "text-slate-400";
  };

  return (
    <div className="h-full min-w-0 bg-white dark:bg-slate-800 flex flex-col">
      {/* Header */}
      <div className="h-[48px] px-4 flex items-center border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          任务
        </span>
        <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          ({tasks.length})
        </span>
      </div>

      {/* Task rows */}
      <div ref={ref} className="flex-1 overflow-y-auto" onScroll={onScroll}>
        {tasks.map((task, index) => {
          const person = getPerson(task.assigneeId);
          const isDragging = draggingId === task.id;
          const isDragOver = dragOverId === task.id;
            const isCompleted = task.progress >= 100;

          return (
            <div
              key={task.id}
              draggable
              onDragStart={(e) => handleDragStart(e, task)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, task, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, task, index)}
              onClick={() => onTaskClick(task)}
              className={cn(
                "h-[48px] border-b border-slate-100 dark:border-slate-800/50",
                "flex items-center gap-2 px-3 cursor-pointer select-none",
                "transition-colors duration-150 group",
                "hover:bg-slate-50 dark:hover:bg-slate-700/50",
                isDragging && "opacity-50",
                isDragOver && "bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800",
                isCompleted && "opacity-60"
              )}
            >
              {/* Drag handle */}
              <div
                className={cn(
                  "shrink-0 text-slate-300 dark:text-slate-600",
                  "opacity-0 group-hover:opacity-100",
                  "hover:text-slate-400 dark:hover:text-slate-500",
                  "cursor-grab active:cursor-grabbing"
                )}
                onClick={(e) => e.stopPropagation()}
                role="button"
                tabIndex={-1}
              >
                <GripVertical size={14} />
              </div>

              {/* Colored dot */}
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: person?.color ?? "#94a3b8" }}
              />

              {/* Task info */}
              <div className="flex-1 min-w-0">
                <div className={cn(
                  "text-xs font-medium text-slate-900 dark:text-slate-100 truncate",
                  isCompleted && "line-through"
                )}>
                  {task.name}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {formatDateRange(task.startDate, task.endDate)}
                  </span>
                  <span className={cn("text-[10px] font-medium", getProgressColor(task.progress))}>
                    {task.progress}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

TaskList.displayName = "TaskList";

export default TaskList;
