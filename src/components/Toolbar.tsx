import { useRef } from "react";
import {
  Plus,
  RotateCcw,
  Users,
  Download,
  Upload,
  Camera,
  RefreshCw,
  History,
  BarChart3,
  GraduationCap,
  Moon,
  Sun,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface ToolbarProps {
  isAdmin: boolean;
  onAddTask: () => void;
  onReset: () => void;
  onExportJson: () => void;
  onImportJson: (json: string) => void;
  onExportImage: () => void;
  onToggleHistory: () => void;
  onToggleStats: () => void;
  onToggleProfiles: () => void;
  onManagePeople: () => void;
  onOpenSync: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  autoSave: boolean;
  onToggleAutoSave: () => void;
  keyword: string;
  onKeywordChange: (k: string) => void;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function Toolbar({
  isAdmin,
  onAddTask,
  onReset,
  onExportJson,
  onImportJson,
  onExportImage,
  onToggleHistory,
  onToggleStats,
  onToggleProfiles,
  onManagePeople,
  onOpenSync,
  darkMode,
  onToggleDarkMode,
  autoSave,
  onToggleAutoSave,
  keyword,
  onKeywordChange,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      onImportJson(text);
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-2 px-6 py-3 border-b border-slate-200 dark:border-slate-700">
      {/* ── Top row (admin only) ── */}
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <RotateCcw className="size-3.5" />
            重置
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onManagePeople}
            className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          >
            <Users className="size-3.5" />
            账户管理
          </Button>
        </div>
      )}

      {/* ── Second row (all users) ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Add task - all users */}
        <Button
          variant="outline"
          size="sm"
          onClick={onAddTask}
          className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        >
          <Plus className="size-3.5" />
          新增任务
        </Button>

        {/* Export JSON */}
        <Button
          variant="outline"
          size="sm"
          onClick={onExportJson}
          className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        >
          <Download className="size-3.5" />
          导出JSON
        </Button>

        {/* Import JSON — hidden file input */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleImportClick}
          className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        >
          <Upload className="size-3.5" />
          导入JSON
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileChange}
          />
        </Button>

        {/* Export Image */}
        <Button
          variant="outline"
          size="sm"
          onClick={onExportImage}
          className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        >
          <Camera className="size-3.5" />
          导出图片
        </Button>

        {/* Sync */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSync}
          className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        >
          <RefreshCw className="size-3.5" />
          同步
        </Button>

        {/* History */}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleHistory}
          className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        >
          <History className="size-3.5" />
          历史
        </Button>

        {/* Stats - admin only */}
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleStats}
            className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          >
            <BarChart3 className="size-3.5" />
            统计
          </Button>
        )}

        {/* Student Profiles - admin only */}
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleProfiles}
            className="text-xs gap-1.5 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          >
            <GraduationCap className="size-3.5" />
            学生档案
          </Button>
        )}

        {/* ── Toggles + Search ── */}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Auto-save toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <Switch
              checked={autoSave}
              onCheckedChange={onToggleAutoSave}
              className="scale-75 origin-left"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              自动保存
            </span>
          </label>

          {/* Dark mode toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleDarkMode}
            className="text-xs gap-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            title={darkMode ? "切换到亮色模式" : "切换到暗色模式"}
          >
            {darkMode ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
          </Button>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder="搜索任务..."
              value={keyword}
              onChange={(e) => onKeywordChange(e.target.value)}
              className={cn(
                "pl-7 pr-7 h-8 w-40 text-xs bg-white dark:bg-slate-800",
                "border-slate-200 dark:border-slate-700",
                "placeholder:text-slate-400 dark:placeholder:text-slate-500"
              )}
            />
            {keyword && (
              <button
                onClick={() => onKeywordChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
