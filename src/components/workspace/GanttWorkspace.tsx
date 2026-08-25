import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, List, PanelRight, RotateCcw } from "lucide-react";
import GanttBoard, { type GanttBoardHandle } from "@/components/workspace/GanttBoard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Person, Task } from "@/types";

interface GanttWorkspaceProps {
  tasks: Task[];
  people: Person[];
  viewMode: "day" | "week" | "month";
  holidays: Record<string, string>;
  onTaskClick: (task: Task) => void;
  onReorder: (taskIds: string[]) => void;
}

export default function GanttWorkspace({
  tasks,
  people,
  viewMode,
  holidays,
  onTaskClick,
  onReorder,
}: GanttWorkspaceProps) {
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"tasks" | "timeline">("tasks");
  const [listWidth, setListWidth] = useState(300);
  const boardRef = useRef<GanttBoardHandle>(null);

  const dateRange = useMemo(() => {
    if (tasks.length === 0) return "暂无排期";
    const starts = tasks.map((task) => task.startDate).sort();
    const ends = tasks.map((task) => task.endDate).sort();
    return `${starts[0]} 至 ${ends[ends.length - 1]}`;
  }, [tasks]);

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidth;
    const move = (moveEvent: PointerEvent) => {
      setListWidth(
        Math.min(440, Math.max(240, startWidth + moveEvent.clientX - startX))
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <section className="gantt-workspace" aria-label="任务甘特图工作区">
      <div className="gantt-toolbar">
        <div className="gantt-navigation">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => boardRef.current?.scrollByPage(-1)}
            title="上一时间段"
            aria-label="上一时间段"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => boardRef.current?.scrollToToday()}
          >
            今天
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => boardRef.current?.scrollByPage(1)}
            title="下一时间段"
            aria-label="下一时间段"
          >
            <ChevronRight />
          </Button>
          <span className="gantt-date-range">{dateRange}</span>
        </div>

        <div className="gantt-toolbar-actions">
          {isMobile && (
            <div className="gantt-mobile-switch" aria-label="移动端视图">
              <button
                className={cn(mobileView === "tasks" && "active")}
                onClick={() => setMobileView("tasks")}
              >
                <List size={14} />任务
              </button>
              <button
                className={cn(mobileView === "timeline" && "active")}
                onClick={() => setMobileView("timeline")}
              >
                <PanelRight size={14} />时间线
              </button>
            </div>
          )}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setListWidth(300)}
              title="恢复任务栏宽度"
              aria-label="恢复任务栏宽度"
            >
              <RotateCcw />
            </Button>
          )}
        </div>
      </div>

      <div id="gantt-chart" className="gantt-viewport">
        <GanttBoard
          ref={boardRef}
          tasks={tasks}
          people={people}
          viewMode={viewMode}
          holidays={holidays}
          listWidth={listWidth}
          showTaskColumn={!isMobile || mobileView === "tasks"}
          showTimeline={!isMobile || mobileView === "timeline"}
          onTaskClick={onTaskClick}
          onReorder={onReorder}
          onResizeStart={!isMobile ? startResize : undefined}
        />
      </div>
    </section>
  );
}
