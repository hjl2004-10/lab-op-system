import { Paperclip } from "lucide-react";
import { attachmentUrl } from "@/lib/api";
import type { AttachmentMeta } from "@/types";
import { formatFileSize } from "@/components/AttachmentPicker";

interface AttachmentListProps {
  attachments?: AttachmentMeta[];
}

/** 已保存附件的展示列表，点击通过 cookie 会话直接下载 */
export default function AttachmentList({ attachments }: AttachmentListProps) {
  if (!attachments?.length) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={attachmentUrl(attachment.id)}
            title={attachment.name}
            className="inline-flex max-w-64 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 transition-colors hover:border-[#2f6db3] hover:text-[#2f6db3] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-blue-400 dark:hover:text-blue-400"
          >
            <Paperclip className="size-3 shrink-0" />
            <span className="truncate">{attachment.name}</span>
            <span className="shrink-0 text-slate-400">
              {formatFileSize(attachment.size)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
