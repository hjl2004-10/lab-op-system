import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Person } from "@/types";

interface StudentCardsProps {
  students: Person[];
  selectedStudentIds: string[];
  onSelectedStudentIdsChange: (ids: string[]) => void;
  /** 可选：每人的任务数（主页展示，档案页可不传） */
  taskCounts?: Record<string, number>;
}

/**
 * 学生专属卡片：每个学生一个卡片，默认全选，支持全选/一键清空。
 * 勾选状态由父级共享（跨任务视图与档案表格）。
 */
export default function StudentCards({
  students,
  selectedStudentIds,
  onSelectedStudentIdsChange,
  taskCounts,
}: StudentCardsProps) {
  const selectedCount = students.filter((person) =>
    selectedStudentIds.includes(person.id)
  ).length;
  const allSelected = students.length > 0 && selectedCount === students.length;

  const toggleStudent = (personId: string) => {
    const next = selectedStudentIds.includes(personId)
      ? selectedStudentIds.filter((id) => id !== personId)
      : [...selectedStudentIds, personId];
    onSelectedStudentIdsChange(next);
  };
  const selectAll = () => {
    onSelectedStudentIdsChange(students.map((person) => person.id));
  };
  const clearAll = () => {
    onSelectedStudentIdsChange([]);
  };

  return (
    <section className="student-cards" aria-label="学生筛选">
      <div className="student-cards-header">
        <div className="flex items-center gap-2">
          <span className="student-cards-title">学生</span>
          <span className="student-cards-count">
            已选 {selectedCount}/{students.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={selectAll}
            disabled={allSelected}
          >
            全选
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-red-500 hover:text-red-600"
            onClick={clearAll}
            disabled={selectedCount === 0}
          >
            一键清空
          </Button>
        </div>
      </div>
      <div className="student-cards-grid">
        {students.map((person) => {
          const checked = selectedStudentIds.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={cn("student-card", checked && "student-card-checked")}
              onClick={() => toggleStudent(person.id)}
              aria-pressed={checked}
              aria-label={`${checked ? "取消" : "勾选"}${person.name}`}
            >
              <span
                className="student-card-dot"
                style={{ backgroundColor: person.color }}
              />
              <span className="student-card-name">{person.name}</span>
              {taskCounts && (
                <span className="student-card-count">
                  {taskCounts[person.id] ?? 0}
                </span>
              )}
              {checked && (
                <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
