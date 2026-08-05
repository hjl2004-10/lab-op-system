import { useState } from "react";
import { Plus, Settings2, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isProtectedFieldKey } from "@/lib/profileFields";
import type { ProfileFieldDef } from "@/types";

interface ProfileFieldDefsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defs: ProfileFieldDef[];
  onAddDef: (def: ProfileFieldDef) => void;
  onRemoveDef: (key: string) => void;
  onAddOption: (fieldKey: string, option: string) => void;
  onRemoveOption: (fieldKey: string, option: string) => void;
}

const TYPE_LABEL: Record<ProfileFieldDef["type"], string> = {
  text: "文本",
  select: "选择",
  number: "数字",
};

/**
 * 教师端管理全局预设档案字段：增删字段、增删字段的可选项。
 * 所有改动即时生效（依赖 useAppState 的 650ms 防抖自动保存）。
 */
export default function ProfileFieldDefsDialog({
  open,
  onOpenChange,
  defs,
  onAddDef,
  onRemoveDef,
  onAddOption,
  onRemoveOption,
}: ProfileFieldDefsDialogProps) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ProfileFieldDef["type"]>("text");
  const [newOptions, setNewOptions] = useState("");
  const [newOptionByField, setNewOptionByField] = useState<Record<string, string>>({});

  const handleAddDef = () => {
    const label = newName.trim();
    if (!label) return;
    onAddDef({
      key: label,
      label,
      type: newType,
      // select 类型始终给数组（可为空），保证之后能继续添加选项
      options:
        newType === "select"
          ? newOptions
              .split(",")
              .map((option) => option.trim())
              .filter(Boolean)
          : undefined,
      category: newType === "select" ? "selectable" : "fillable",
    });
    setNewName("");
    setNewType("text");
    setNewOptions("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-5 text-blue-700 dark:text-blue-300" />
            预设档案字段
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            字段与可选项会应用到全部学生档案。每行右侧「删除」可删字段，选项上的 × 可删可选项。
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-3">
          <div className="space-y-3">
            {defs.map((field) => (
              <div
                key={field.key}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {field.label}
                    </span>
                    <Badge
                      variant="secondary"
                      className="rounded-md px-1.5 text-sm font-normal"
                    >
                      {TYPE_LABEL[field.type]}
                    </Badge>
                  </div>
                  {isProtectedFieldKey(field.key) ? (
                    <Badge
                      variant="secondary"
                      className="rounded-md px-1.5 text-sm font-normal text-slate-400"
                    >
                      不可删除
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 border-red-200 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 dark:border-red-900 dark:hover:bg-red-900/20"
                      title={`删除字段 ${field.label}`}
                      aria-label={`删除字段 ${field.label}`}
                      onClick={() => onRemoveDef(field.key)}
                    >
                      <Trash2 className="size-3.5" />
                      删除
                    </Button>
                  )}
                </div>

                {field.type === "select" && (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(field.options ?? []).map((option) => (
                        <span
                          key={option}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {option}
                          <button
                            type="button"
                            className="text-slate-400 hover:text-red-500"
                            onClick={() => onRemoveOption(field.key, option)}
                            aria-label={`删除选项 ${option}`}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Input
                        value={newOptionByField[field.key] ?? ""}
                        onChange={(event) =>
                          setNewOptionByField((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))
                        }
                        placeholder="新增选项"
                        className="h-7 rounded-md text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        disabled={!(newOptionByField[field.key] ?? "").trim()}
                        onClick={() => {
                          onAddOption(field.key, newOptionByField[field.key] ?? "");
                          setNewOptionByField((current) => ({
                            ...current,
                            [field.key]: "",
                          }));
                        }}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {defs.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">
                暂无预设字段
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                字段名称
              </label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="输入字段名称..."
                className="h-8 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                类型
              </label>
              <Select
                value={newType}
                onValueChange={(value) => {
                  if (value === "text" || value === "select" || value === "number") {
                    setNewType(value);
                  }
                }}
              >
                <SelectTrigger className="h-8 w-28 rounded-md text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">文本</SelectItem>
                  <SelectItem value="select">选择</SelectItem>
                  <SelectItem value="number">数字</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newType === "select" && (
              <div className="flex-[2]">
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  选项（逗号分隔）
                </label>
                <Input
                  value={newOptions}
                  onChange={(event) => setNewOptions(event.target.value)}
                  placeholder="选项1,选项2,选项3..."
                  className="h-8 rounded-md text-sm"
                />
              </div>
            )}
            <Button size="sm" onClick={handleAddDef} disabled={!newName.trim()}>
              <Plus className="size-4" />
              添加
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
