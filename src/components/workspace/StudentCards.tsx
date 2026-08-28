import { cn } from "@/lib/utils";
import type { Person } from "@/types";

interface StudentCardsProps {
  students: Person[];
  selectedStudentIds: string[];
  onSelectedStudentIdsChange: (ids: string[]) => void;
  /** 可选：每人的任务数（主页展示，档案页可不传） */
  taskCounts?: Record<string, number>;
  /** 管理者视角：把自己也作为一等选择项（"我的任务"胶囊，排在最前） */
  selfPerson?: Person | null;
}

/**
 * 成员筛选胶囊（zip PeopleFilter 样式）：每个成员一个胶囊，默认全选。
 * 管理者传入 selfPerson 时，"我的任务"与学生任务对称可选。
 * 勾选状态由父级共享（跨任务视图与档案表格）。
 */
export default function StudentCards({
  students,
  selectedStudentIds,
  onSelectedStudentIdsChange,
  taskCounts,
  selfPerson,
}: StudentCardsProps) {
  const selectable = selfPerson ? [selfPerson, ...students] : students;
  const selectedCount = selectable.filter((person) =>
    selectedStudentIds.includes(person.id)
  ).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  const toggleStudent = (personId: string) => {
    const next = selectedStudentIds.includes(personId)
      ? selectedStudentIds.filter((id) => id !== personId)
      : [...selectedStudentIds, personId];
    onSelectedStudentIdsChange(next);
  };
  const selectAll = () => {
    onSelectedStudentIdsChange(selectable.map((person) => person.id));
  };
  const clearAll = () => {
    onSelectedStudentIdsChange([]);
  };

  const pillBase =
    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";

  const renderPill = (person: Person, label?: string) => {
    const checked = selectedStudentIds.includes(person.id);
    return (
      <button
        key={person.id}
        type="button"
        className={cn(
          pillBase,
          checked
            ? "border-transparent text-white"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        )}
        style={checked ? { backgroundColor: person.color, borderColor: person.color } : undefined}
        onClick={() => toggleStudent(person.id)}
        aria-pressed={checked}
        aria-label={`${checked ? "取消" : "勾选"}${label ?? person.name}`}
      >
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: checked ? "rgba(255,255,255,.85)" : person.color }}
        />
        {label ?? person.name}
        {taskCounts && (
          <span
            className={cn(
              "flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-medium",
              checked
                ? "bg-white/25 text-white"
                : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
            )}
          >
            {taskCounts[person.id] ?? 0}
          </span>
        )}
      </button>
    );
  };

  return (
    <section
      className="flex shrink-0 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      aria-label="成员筛选"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {selfPerson ? "成员（含我自己）" : "学生"}
          </span>
          <span className="text-[10px] text-slate-400">
            已选 {selectedCount}/{selectable.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700"
            onClick={selectAll}
            disabled={allSelected}
          >
            全选
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950"
            onClick={clearAll}
            disabled={selectedCount === 0}
          >
            一键清空
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* “全部”胶囊：选中 = 深灰底白字（zip 选中态） */}
        <button
          type="button"
          className={cn(
            pillBase,
            allSelected
              ? "border-transparent bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          )}
          onClick={allSelected ? clearAll : selectAll}
          aria-pressed={allSelected}
        >
          全部
        </button>

        {selfPerson && renderPill(selfPerson, `我 · ${selfPerson.name}`)}
        {students.map((person) => renderPill(person))}
      </div>
    </section>
  );
}
