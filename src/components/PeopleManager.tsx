import { useState, useMemo, useCallback } from "react";
import {
  Users,
  GripVertical,
  User,
  Shield,
  Trash2,
  GraduationCap,
  ArchiveRestore,
  Archive,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { Person } from "@/types";

interface PeopleManagerProps {
  open: boolean;
  people: Person[];
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string) => void;
  onDelete: (id: string) => void;
  onSetPassword: (personId: string, password: string) => void;
  onReorder: (personIds: string[]) => void;
  onArchive: (id: string, status: "active" | "archived") => void;
  onGenerateSyncCode?: (personId: string) => string;
}

export default function PeopleManager({
  open,
  people,
  onOpenChange,
  onAdd,
  onDelete,
  onSetPassword,
  onReorder,
  onArchive,
  onGenerateSyncCode,
}: PeopleManagerProps) {
  const [newName, setNewName] = useState("");
  const [passwordInputs, setPasswordInputs] = useState<Record<string, string>>(
    {}
  );
  const [activeTab, setActiveTab] = useState("active");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [syncCodes, setSyncCodes] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activePeople = useMemo(
    () =>
      people
        .filter((p) => p.status !== "archived")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [people]
  );

  const archivedPeople = useMemo(
    () => people.filter((p) => p.status === "archived"),
    [people]
  );

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onAdd(name);
    setNewName("");
  };

  const handleSetPassword = (personId: string) => {
    const pwd = passwordInputs[personId]?.trim();
    if (!pwd) return;
    onSetPassword(personId, pwd);
    setPasswordInputs((prev) => ({ ...prev, [personId]: "" }));
  };

  const handleGenerateSyncCode = (personId: string) => {
    if (!onGenerateSyncCode) return;
    const code = onGenerateSyncCode(personId);
    setSyncCodes((prev) => ({ ...prev, [personId]: code }));
    setCopiedId(null);
  };

  const handleCopySyncCode = async (personId: string) => {
    const code = syncCodes[personId];
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(personId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: do nothing
    }
  };

  const handlePasswordChange = (personId: string, value: string) => {
    setPasswordInputs((prev) => ({ ...prev, [personId]: value }));
  };

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, personId: string) => {
      if (people.find((p) => p.id === personId)?.role === "admin") {
        e.preventDefault();
        return;
      }
      setDraggedId(personId);
      e.dataTransfer.effectAllowed = "move";
    },
    [people]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) {
        setDraggedId(null);
        return;
      }

      const targetPerson = people.find((p) => p.id === targetId);
      if (targetPerson?.role === "admin") {
        setDraggedId(null);
        return;
      }

      const reorderedIds = activePeople
        .filter((p) => p.role !== "admin")
        .map((p) => p.id);

      const draggedIdx = reorderedIds.indexOf(draggedId);
      const targetIdx = reorderedIds.indexOf(targetId);

      if (draggedIdx === -1 || targetIdx === -1) {
        setDraggedId(null);
        return;
      }

      reorderedIds.splice(draggedIdx, 1);
      reorderedIds.splice(targetIdx, 0, draggedId);

      onReorder(reorderedIds);
      setDraggedId(null);
    },
    [draggedId, activePeople, people, onReorder]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
  }, []);

  const renderMemberRow = (person: Person, isDraggable: boolean) => (
    <div
      key={person.id}
      draggable={isDraggable}
      onDragStart={(e) => handleDragStart(e, person.id)}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e, person.id)}
      onDragEnd={handleDragEnd}
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700",
        "hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
        isDraggable && "cursor-move",
        !isDraggable && "cursor-default",
        draggedId === person.id && "opacity-50 border-dashed"
      )}
    >
      {/* Drag handle */}
      {person.role !== "admin" ? (
        <GripVertical className="w-4 h-4 text-slate-400 shrink-0" />
      ) : (
        <div className="w-4 h-4 shrink-0" />
      )}

      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: person.color }}
      >
        {person.role === "admin" ? (
          <Shield className="w-4 h-4 text-white" />
        ) : (
          <User className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Name and badges */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {person.name}
          </span>
          {person.role === "admin" ? (
            <Badge
              variant="secondary"
              className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            >
              管理员
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="text-xs bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            >
              成员
            </Badge>
          )}
          {person.status === "archived" && (
            <Badge
              variant="outline"
              className="text-xs text-slate-400 border-slate-300 dark:border-slate-600"
            >
              已毕业
            </Badge>
          )}
        </div>
      </div>

      {/* Password setting (non-admin only) */}
      {person.role !== "admin" && (
        <div className="flex items-center gap-1">
          <Input
            type="password"
            placeholder="设置密码"
            value={passwordInputs[person.id] ?? ""}
            onChange={(e) =>
              handlePasswordChange(person.id, e.target.value)
            }
            className="h-8 w-24 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => handleSetPassword(person.id)}
          >
            设置
          </Button>
        </div>
      )}

      {/* Generate sync code (non-admin only) */}
      {person.role !== "admin" && onGenerateSyncCode && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs gap-1"
          onClick={() => handleGenerateSyncCode(person.id)}
          title="生成该同学的独立同步码"
        >
          <RefreshCw className="w-3 h-3" />
          同步码
        </Button>
      )}

      {/* Archive / Unarchive */}
      {person.role !== "admin" && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8"
          onClick={() =>
            onArchive(
              person.id,
              person.status === "archived" ? "active" : "archived"
            )
          }
          title={person.status === "archived" ? "恢复在读" : "标记已毕业"}
        >
          {person.status === "archived" ? (
            <ArchiveRestore className="w-4 h-4 text-slate-500" />
          ) : (
            <Archive className="w-4 h-4 text-slate-500" />
          )}
        </Button>
      )}

      {/* Delete button (non-admin only) */}
      {person.role !== "admin" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除 {person.name} 吗？其任务也会被删除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(person.id)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Show generated sync code */}
      {person.role !== "admin" && syncCodes[person.id] && (
        <div className="col-span-full mt-1 flex items-center gap-1">
          <input
            type="text"
            readOnly
            value={syncCodes[person.id]}
            className="flex-1 h-7 px-2 text-[10px] rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-500 font-mono truncate"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            onClick={() => handleCopySyncCode(person.id)}
            title="复制同步码"
          >
            {copiedId === person.id ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <Copy className="w-3 h-3 text-slate-400" />
            )}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Users className="w-5 h-5 text-slate-500" />
            管理成员
          </DialogTitle>
        </DialogHeader>

        {/* Add new member */}
        <div className="flex items-center gap-2 mt-2">
          <Input
            placeholder="输入新成员姓名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            className="h-9 flex-1"
          />
          <Button size="sm" className="h-9 px-4" onClick={handleAdd}>
            添加
          </Button>
        </div>

        {/* Member list tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="mt-2"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">
              <GraduationCap className="w-4 h-4 mr-1" />
              在读 ({activePeople.length})
            </TabsTrigger>
            <TabsTrigger value="archived">
              <Archive className="w-4 h-4 mr-1" />
              已毕业 ({archivedPeople.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-3 space-y-2">
            {activePeople.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">
                没有在读成员
              </p>
            ) : (
              activePeople.map((person) =>
                renderMemberRow(person, person.role !== "admin")
              )
            )}
          </TabsContent>

          <TabsContent value="archived" className="mt-3 space-y-2">
            {archivedPeople.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">
                没有已毕业成员
              </p>
            ) : (
              archivedPeople.map((person) =>
                renderMemberRow(person, false)
              )
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
