import { useMemo, useState, type FormEvent } from "react";
import { Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { Person, Task } from "@/types";

type NewTask = Omit<
  Task,
  "id" | "order" | "progressHistory" | "isMilestone" | "archivedAt"
>;

interface AddTaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: Person[];
  canAssignTasks: boolean;
  currentUserId: string | null;
  onAdd: (task: NewTask) => void;
}

interface TaskForm {
  name: string;
  assigneeId: string;
  startDate: string;
  endDate: string;
  progress: number;
  description: string;
  isPrivate: boolean;
}

interface FormErrors {
  name?: string;
  assigneeId?: string;
  startDate?: string;
  endDate?: string;
}

const today = () => new Date().toISOString().split("T")[0];

function createInitialForm(
  people: Person[],
  canAssignTasks: boolean,
  currentUserId: string | null
): TaskForm {
  const initialAssigneeId = canAssignTasks
    ? people.find((person) => person.status === "active")?.id ?? ""
    : currentUserId ?? "";
  const currentDate = today();

  return {
    name: "",
    assigneeId: initialAssigneeId,
    startDate: currentDate,
    endDate: currentDate,
    progress: 0,
    description: "",
    isPrivate: false,
  };
}

export default function AddTaskSheet({
  open,
  onOpenChange,
  people,
  canAssignTasks,
  currentUserId,
  onAdd,
}: AddTaskSheetProps) {
  const availableAssignees = useMemo(
    () =>
      canAssignTasks
        ? people.filter((person) => person.status === "active")
        : people.filter((person) => person.id === currentUserId),
    [currentUserId, canAssignTasks, people]
  );
  const [form, setForm] = useState<TaskForm>(() =>
    createInitialForm(people, canAssignTasks, currentUserId)
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const effectiveAssigneeId = canAssignTasks
    ? availableAssignees.some((person) => person.id === form.assigneeId)
      ? form.assigneeId
      : availableAssignees[0]?.id ?? ""
    : currentUserId ?? "";

  const resetForm = () => {
    setForm(createInitialForm(people, canAssignTasks, currentUserId));
    setErrors({});
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const validate = () => {
    const nextErrors: FormErrors = {};
    const assigneeId = effectiveAssigneeId;

    if (!form.name.trim()) nextErrors.name = "请输入任务名称";
    if (!assigneeId || !availableAssignees.some((person) => person.id === assigneeId)) {
      nextErrors.assigneeId = "请选择有效的负责人";
    }
    if (!form.startDate) nextErrors.startDate = "请选择开始日期";
    if (!form.endDate) nextErrors.endDate = "请选择结束日期";
    if (form.startDate && form.endDate && form.startDate > form.endDate) {
      nextErrors.endDate = "结束日期不能早于开始日期";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    onAdd({
      name: form.name.trim(),
      assigneeId: effectiveAssigneeId,
      startDate: form.startDate,
      endDate: form.endDate,
      progress: form.progress,
      description: form.description,
      // 仅学生自建任务支持私有（canAssignTasks=false 时负责人锁定为自己）
      isPrivate: !canAssignTasks ? form.isPrivate : undefined,
      detail: {
        currentProgress: "",
        mainProblems: "",
        solutions: "",
      },
      rating: 0,
    });
    resetForm();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-none gap-0 p-0 sm:w-[600px] sm:max-w-[calc(100vw-2rem)]"
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-slate-700">
          <SheetTitle>新增任务</SheetTitle>
          <SheetDescription className="sr-only">
            填写任务名称、负责人、日期、进度和备注
          </SheetDescription>
        </SheetHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
            <div className="space-y-1.5">
              <Label htmlFor="add-task-name">任务名称</Label>
              <Input
                id="add-task-name"
                value={form.name}
                onChange={(event) => {
                  setForm((previous) => ({ ...previous, name: event.target.value }));
                  setErrors((previous) => ({ ...previous, name: undefined }));
                }}
                placeholder="输入任务名称"
                aria-invalid={Boolean(errors.name)}
                autoFocus
              />
              {errors.name && (
                <p className="text-xs text-destructive" role="alert">
                  {errors.name}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-task-assignee">负责人</Label>
              <Select
                value={effectiveAssigneeId}
                onValueChange={(value) => {
                  setForm((previous) => ({ ...previous, assigneeId: value }));
                  setErrors((previous) => ({ ...previous, assigneeId: undefined }));
                }}
                disabled={!canAssignTasks}
              >
                <SelectTrigger
                  id="add-task-assignee"
                  className="w-full"
                  aria-invalid={Boolean(errors.assigneeId)}
                >
                  <SelectValue placeholder="选择负责人" />
                </SelectTrigger>
                <SelectContent>
                  {availableAssignees.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: person.color }}
                        />
                        {person.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.assigneeId && (
                <p className="text-xs text-destructive" role="alert">
                  {errors.assigneeId}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-task-start-date">开始日期</Label>
                <Input
                  id="add-task-start-date"
                  type="date"
                  value={form.startDate}
                  onChange={(event) => {
                    setForm((previous) => ({
                      ...previous,
                      startDate: event.target.value,
                    }));
                    setErrors((previous) => ({
                      ...previous,
                      startDate: undefined,
                      endDate: undefined,
                    }));
                  }}
                  aria-invalid={Boolean(errors.startDate)}
                />
                {errors.startDate && (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.startDate}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-task-end-date">结束日期</Label>
                <Input
                  id="add-task-end-date"
                  type="date"
                  value={form.endDate}
                  onChange={(event) => {
                    setForm((previous) => ({
                      ...previous,
                      endDate: event.target.value,
                    }));
                    setErrors((previous) => ({ ...previous, endDate: undefined }));
                  }}
                  aria-invalid={Boolean(errors.endDate)}
                />
                {errors.endDate && (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.endDate}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="add-task-progress">进度</Label>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {form.progress}%
                </span>
              </div>
              <Slider
                id="add-task-progress"
                value={[form.progress]}
                onValueChange={(value) =>
                  setForm((previous) => ({
                    ...previous,
                    progress: value[0] ?? 0,
                  }))
                }
                min={0}
                max={100}
                step={1}
                aria-label="任务进度"
                className="[&_[data-slot=slider-range]]:bg-slate-700 [&_[data-slot=slider-thumb]]:border-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-task-description">备注</Label>
              <Textarea
                id="add-task-description"
                value={form.description}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
                placeholder="输入备注..."
                className="min-h-24 resize-y"
              />
            </div>

            {!canAssignTasks && (
              <div className="space-y-1.5 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                <Label htmlFor="add-task-private" className="flex items-center gap-1.5">
                  <Lock className="size-3.5 text-slate-400" />
                  仅自己可见
                </Label>
                <div className="flex items-center gap-2">
                  <Switch
                    id="add-task-private"
                    checked={form.isPrivate}
                    onCheckedChange={(checked) =>
                      setForm((previous) => ({ ...previous, isPrivate: checked }))
                    }
                  />
                  <span className="text-xs text-slate-400">
                    开启后该任务对教师不可见，仅自己可见
                  </span>
                </div>
              </div>
            )}
          </div>

          <SheetFooter className="flex-row border-t border-slate-200 px-4 py-4 dark:border-slate-700 sm:justify-end sm:px-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              <X className="size-4" />
              取消
            </Button>
            <Button
              type="submit"
              className="bg-sky-500 text-white shadow-xs hover:bg-sky-600"
            >
              <Plus className="size-4" />
              创建任务
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
