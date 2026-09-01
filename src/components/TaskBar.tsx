import { useState } from "react";
import type { Task, Person } from "@/types";
import { formatDateRange } from "@/utils";
// cn available if needed for class merging

interface TaskBarProps {
  task: Task;
  person: Person | undefined;
  left: number;
  width: number;
  onClick: () => void;
}

export default function TaskBar({ task, person, left, width, onClick }: TaskBarProps) {
  const [isHovered, setIsHovered] = useState(false);

  const barWidth = Math.max(width, 4);
  const showLabel = barWidth > 40;
  const bgColor = person?.color ?? "#94a3b8";

  return (
    <div
      className="absolute top-1 h-[42px] rounded-md shadow-sm cursor-pointer overflow-hidden"
      style={{ left: `${left}px`, width: `${barWidth}px` }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Base background layer */}
      <div
        className="absolute inset-0 opacity-30 dark:opacity-20"
        style={{ backgroundColor: bgColor }}
      />

      {/* Progress fill layer */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: `${task.progress}%`,
          backgroundColor: bgColor,
          opacity: 0.85,
        }}
      />

      {/* Content layer */}
      <div className="absolute inset-0 flex items-center px-1.5">
        <span className="text-[18px] text-white font-medium truncate drop-shadow-sm whitespace-nowrap">
          {showLabel ? `${task.name} ${task.progress}%` : `${task.progress}%`}
        </span>
      </div>

      {/* Tooltip */}
      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 pointer-events-none">
          <div className="bg-slate-900 dark:bg-slate-700 text-white rounded-lg shadow-lg px-3 py-2 whitespace-nowrap">
            <div className="text-xs font-semibold">{task.name}</div>
            <div className="text-[18px] text-slate-300 mt-0.5">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1"
                style={{ backgroundColor: bgColor }}
              />
              {person?.name ?? "未分配"}
            </div>
            <div className="text-[18px] text-slate-400 mt-0.5">
              {formatDateRange(task.startDate, task.endDate)}
            </div>
            <div className="text-[18px] text-slate-400">
              进度: {task.progress}%
            </div>
          </div>
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="w-2 h-2 bg-slate-900 dark:bg-slate-700 rotate-45" />
          </div>
        </div>
      )}
    </div>
  );
}
