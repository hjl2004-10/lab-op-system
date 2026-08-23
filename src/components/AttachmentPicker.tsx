import { useRef } from "react";
import { FilePlus2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/** 待上传附件选择器：纯本地 File 列表，实际上传发生在提交记录时 */
export default function AttachmentPicker({
  files,
  onChange,
  disabled,
}: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (selected: FileList | null) => {
    if (!selected?.length) return;
    onChange([...files, ...Array.from(selected)]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => handleSelect(event.target.files)}
        disabled={disabled}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 border-dashed px-2 text-xs text-slate-500 dark:text-slate-400"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <FilePlus2 className="size-3.5" />
        添加附件
      </Button>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800/60"
            >
              <span className="truncate" title={file.name}>
                {file.name}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
                {formatFileSize(file.size)}
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                  onClick={() => onChange(files.filter((_, i) => i !== index))}
                  disabled={disabled}
                  aria-label={`移除附件 ${file.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
