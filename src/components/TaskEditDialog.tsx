import { useState, useMemo } from "react";
import {
  Star,
  Lock,
  Clock,
  Trash2,
  Save,
  X,
  CircleDot,
  MessageSquare,
  Send,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { Task, Person } from "@/types";

interface TaskEditDialogProps {
  open: boolean;
  task: Task | null;
  people: Person[];
  canAssignTasks: boolean;
  currentUserId: string | null;
  currentUserName: string;
  onOpenChange: (open: boolean) => void;
  onSave: (taskId: string, updates: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
  onAddProgressRecord: (
    taskId: string,
    record: {
      currentProgress: string;
      mainProblems: string;
      solutions: string;
      author: string;
      authorId: string;
    }
  ) => void;
  onAddProgressReply: (
    taskId: string,
    recordId: string,
    content: string,
    authorId: string,
    authorName: string
  ) => void;
  onSetRating: (taskId: string, rating: number) => void;
}

export default function TaskEditDialog({
  open,
  task,
  people,
  canAssignTasks,
  currentUserId,
  currentUserName,
  onOpenChange,
  onSave,
  onDelete,
  onAddProgressRecord,
  onAddProgressReply,
  onSetRating,
}: TaskEditDialogProps) {
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState<Partial<Task>>(() => task ? { ...task } : {});
  const [progressInput, setProgressInput] = useState<number[]>(() => [task?.progress ?? 0]);

  // Progress record form state
  const [newProgress, setNewProgress] = useState("");
  const [newProblems, setNewProblems] = useState("");
  const [newSolutions, setNewSolutions] = useState("");

  // Reply form state
  const [replyContents, setReplyContents] = useState<Record<string, string>>({});
  const [expandedReplyForms, setExpandedReplyForms] = useState<Record<string, boolean>>({});

  // Star rating state (local for visual feedback)
  const [hoveredStar, setHoveredStar] = useState(0);

  // 100% progress confirmation dialog
  const [showProgressConfirm, setShowProgressConfirm] = useState(false);
  const [pendingProgressValue, setPendingProgressValue] = useState<number | null>(null);

  const assignee = useMemo(
    () => people.find((p) => p.id === task?.assigneeId),
    [people, task?.assigneeId]
  );

  // Permission checks
  // Admin can edit all tasks; students can edit their own tasks
  const isOwner = currentUserId !== null && currentUserId === task?.assigneeId;
  const canEditBasic = canAssignTasks || isOwner;
  const canDelete = canAssignTasks || isOwner;

  const sortedHistory = useMemo(() => {
    if (!task) return [];
    return [...task.progressHistory].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [task]);

  const handleProgressChange = (value: number[]) => {
    const newProgress = value[0];
    if (newProgress === 100 && progressInput[0] < 100) {
      // Show confirmation when dragging to 100%
      setPendingProgressValue(100);
      setShowProgressConfirm(true);
    } else {
      setProgressInput(value);
    }
  };

  const confirmProgress100 = () => {
    if (pendingProgressValue !== null) {
      setProgressInput([pendingProgressValue]);
      setPendingProgressValue(null);
    }
    setShowProgressConfirm(false);
  };

  const cancelProgress100 = () => {
    setPendingProgressValue(null);
    setShowProgressConfirm(false);
  };

  const handleSave = () => {
    if (!task) return;
    const updates: Partial<Task> = {
      progress: progressInput[0],
    };
    if (canEditBasic) {
      updates.name = form.name;
      updates.startDate = form.startDate;
      updates.endDate = form.endDate;
      updates.description = form.description;
    }
    if (canAssignTasks) {
      updates.assigneeId = form.assigneeId;
    }
    onSave(task.id, updates);
    onOpenChange(false);
  };

  const handleAddRecord = () => {
    if (!task || !newProgress.trim()) return;
    onAddProgressRecord(task.id, {
      currentProgress: newProgress,
      mainProblems: newProblems,
      solutions: newSolutions,
      author: currentUserName,
      authorId: currentUserId || "",
    });
    setNewProgress("");
    setNewProblems("");
    setNewSolutions("");
  };

  const handleStarClick = (rating: number) => {
    if (!task) return;
    onSetRating(task.id, rating);
  };

  const handleDelete = () => {
    if (!task) return;
    onDelete(task.id);
    onOpenChange(false);
  };

  const toggleReplyForm = (recordId: string) => {
    setExpandedReplyForms((prev) => ({
      ...prev,
      [recordId]: !prev[recordId],
    }));
  };

  const handleReplyChange = (recordId: string, content: string) => {
    setReplyContents((prev) => ({ ...prev, [recordId]: content }));
  };

  const handleSendReply = (recordId: string) => {
    if (!task || !replyContents[recordId]?.trim() || !currentUserId) return;
    onAddProgressReply(
      task.id,
      recordId,
      replyContents[recordId].trim(),
      currentUserId,
      currentUserName
    );
    setReplyContents((prev) => ({ ...prev, [recordId]: "" }));
    setExpandedReplyForms((prev) => ({ ...prev, [recordId]: false }));
  };

  // Can current user reply to a record?
  const userCanReply = () => {
    if (canAssignTasks) return true;
    // Students can reply to records on their own tasks
    return currentUserId === task?.assigneeId;
  };

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-none gap-0 overflow-y-auto p-0 sm:w-[600px] sm:max-w-[calc(100vw-2rem)]"
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-slate-700">
          <SheetTitle className="flex items-center gap-2">
            <CircleDot
              className="w-4 h-4 shrink-0"
              style={{ color: assignee?.color ?? "#94a3b8" }}
            />
            <span className="truncate">{task.name}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            编辑任务基本信息、进展记录和评分
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="px-4 py-4 sm:px-5"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="progress">进展与问题</TabsTrigger>
            <TabsTrigger value="rating">评分</TabsTrigger>
          </TabsList>

          {/* Tab 1: Basic Info */}
          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-3">
              {/* Task name */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">任务名称</Label>
                {canEditBasic ? (
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p className="text-sm text-slate-900 dark:text-slate-100 py-1.5">
                    {task.name}
                  </p>
                )}
              </div>

              {/* Assignee */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">负责人</Label>
                {canAssignTasks ? (
                  <Select
                    value={form.assigneeId ?? task.assigneeId}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, assigneeId: value }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {people
                        .filter((p) => p.status !== "archived")
                        .map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            <span className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: person.color }}
                              />
                              {person.name}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-slate-900 dark:text-slate-100 py-1.5 flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: assignee?.color ?? "#94a3b8" }}
                    />
                    {assignee?.name ?? "未分配"}
                  </p>
                )}
              </div>

              {/* Start date */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">开始日期</Label>
                {canEditBasic ? (
                  <Input
                    type="date"
                    value={form.startDate ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        startDate: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p className="text-sm text-slate-900 dark:text-slate-100 py-1.5">
                    {task.startDate}
                  </p>
                )}
              </div>

              {/* End date */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">结束日期</Label>
                {canEditBasic ? (
                  <Input
                    type="date"
                    value={form.endDate ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        endDate: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p className="text-sm text-slate-900 dark:text-slate-100 py-1.5">
                    {task.endDate}
                  </p>
                )}
              </div>

              {/* Progress - ANY user can edit */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">
                  进度 ({progressInput[0]}%)
                </Label>
                <div className="flex items-center gap-3">
                  <Slider
                    value={progressInput}
                    onValueChange={handleProgressChange}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-10 text-right">
                    {progressInput[0]}%
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">备注</Label>
                {canEditBasic ? (
                  <Textarea
                    value={form.description ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    className="min-h-[80px]"
                  />
                ) : (
                  <p className="text-sm text-slate-900 dark:text-slate-100 py-1.5">
                    {task.description || "无备注"}
                  </p>
                )}
              </div>
            </div>

            {/* Bottom buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
              {canDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="w-4 h-4 mr-1" />
                      删除任务
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除</AlertDialogTitle>
                      <AlertDialogDescription>
                        确定要删除任务 &quot;{task.name}&quot;
                        吗？此操作无法撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-4 h-4 mr-1" />
                取消
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Save className="w-4 h-4 mr-1" />
                保存
              </Button>
            </div>
          </TabsContent>

          {/* Tab 2: Progress & Issues - Chat-like UI */}
          <TabsContent value="progress" className="space-y-4 mt-4">
            {/* History records - chat-like */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
              {sortedHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Clock className="w-8 h-8 mb-2" />
                  <p className="text-sm">暂无记录</p>
                </div>
              ) : (
                sortedHistory.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2"
                  >
                    {/* Message card header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              people.find((p) => p.id === record.authorId)
                                ?.color ?? "#94a3b8",
                          }}
                        />
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {record.author}
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {record.date}
                      </Badge>
                    </div>

                    {/* Content sections with colored labels */}
                    <div className="space-y-1.5 pl-4">
                      {record.currentProgress && (
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          <span className="text-sky-600 font-medium text-xs">
                            进展:
                          </span>{" "}
                          {record.currentProgress}
                        </p>
                      )}
                      {record.mainProblems && (
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          <span className="text-rose-500 font-medium text-xs">
                            问题:
                          </span>{" "}
                          {record.mainProblems}
                        </p>
                      )}
                      {record.solutions && (
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          <span className="text-blue-600 font-medium text-xs">
                            思路:
                          </span>{" "}
                          {record.solutions}
                        </p>
                      )}
                    </div>

                    {/* Replies */}
                    {record.replies && record.replies.length > 0 && (
                      <div className="ml-4 pl-3 border-l-2 border-slate-200 dark:border-slate-600 space-y-2">
                        {record.replies.map((reply) => (
                          <div
                            key={reply.id}
                            className="bg-sky-50 dark:bg-sky-900/20 rounded-md p-2.5 space-y-1"
                          >
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {reply.author}
                              </span>
                              <span>·</span>
                              <span>{reply.date}</span>
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              {reply.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reply button */}
                    {userCanReply() && (
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                          onClick={() => toggleReplyForm(record.id)}
                        >
                          <MessageSquare className="w-3.5 h-3.5 mr-1" />
                          回复
                        </Button>

                        {/* Inline reply form */}
                        {expandedReplyForms[record.id] && (
                          <div className="mt-2 flex gap-2 items-start">
                            <Textarea
                              value={replyContents[record.id] || ""}
                              onChange={(e) =>
                                handleReplyChange(record.id, e.target.value)
                              }
                              placeholder="输入回复内容..."
                              className="min-h-[60px] text-sm flex-1"
                            />
                            <div className="flex flex-col gap-1">
                              <Button
                                size="sm"
                                className="h-8 px-2"
                                disabled={!replyContents[record.id]?.trim()}
                                onClick={() => handleSendReply(record.id)}
                              >
                                <Send className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => toggleReplyForm(record.id)}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Add new record form */}
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <Label className="text-xs text-slate-500">当前进展</Label>
              <Textarea
                value={newProgress}
                onChange={(e) => setNewProgress(e.target.value)}
                placeholder="描述当前进展..."
                className="min-h-[60px] text-sm border-l-4 border-sky-400"
              />
              <Label className="text-xs text-slate-500">主要问题</Label>
              <Textarea
                value={newProblems}
                onChange={(e) => setNewProblems(e.target.value)}
                placeholder="描述主要问题..."
                className="min-h-[60px] text-sm border-l-4 border-rose-400"
              />
              <Label className="text-xs text-slate-500">解决思路</Label>
              <Textarea
                value={newSolutions}
                onChange={(e) => setNewSolutions(e.target.value)}
                placeholder="描述解决思路..."
                className="min-h-[60px] text-sm border-l-4 border-blue-400"
              />
              <Button
                size="sm"
                onClick={handleAddRecord}
                disabled={!newProgress.trim()}
                className="w-full"
              >
                提交记录
              </Button>
            </div>
          </TabsContent>

          {/* Tab 3: Rating */}
          <TabsContent value="rating" className="mt-4">
            {task.progress < 100 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Lock className="w-10 h-10 mb-3" />
                <p className="text-sm">任务完成后方可评分</p>
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  当前评分：
                  <span className="font-semibold ml-1">
                    {task.rating > 0 ? `${task.rating} 星` : "未评分"}
                  </span>
                </p>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => handleStarClick(star)}
                      onMouseEnter={() => setHoveredStar(star)}
                      onMouseLeave={() => setHoveredStar(0)}
                      className="p-0.5 transition-transform hover:scale-110"
                    >
                      <Star
                        className={cn(
                          "w-8 h-8 transition-colors",
                          star <= (hoveredStar || task.rating)
                            ? "fill-amber-400 text-amber-400"
                            : "fill-transparent text-slate-300 dark:text-slate-600"
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* 100% Progress Confirmation Dialog */}
        <AlertDialog
          open={showProgressConfirm}
          onOpenChange={setShowProgressConfirm}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认完成任务</AlertDialogTitle>
              <AlertDialogDescription>
                任务进度将设为100%，确定要完成此任务吗？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={cancelProgress100}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction onClick={confirmProgress100}>
                确定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
