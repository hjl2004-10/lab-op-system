import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getValueColor,
  isProtectedFieldKey,
  sortFieldsForDisplay,
} from "@/lib/profileFields";
import type { Person, ProfileFieldDef, StudentProfile } from "@/types";

interface ProfileTablePreviewProps {
  students: Person[];
  profiles: StudentProfile[];
  profileFieldDefs: ProfileFieldDef[];
  onSelectPerson: (personId: string) => void;
  onRemoveField: (key: string, label: string) => void;
}

/**
 * 学生信息表格预览：左列姓名（sticky），上排预设字段，单元格同值同色。
 */
export default function ProfileTablePreview({
  students,
  profiles,
  profileFieldDefs,
  onSelectPerson,
  onRemoveField,
}: ProfileTablePreviewProps) {
  const valueByPerson = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const profile of profiles) {
      map[profile.personId] = profile.data || {};
    }
    return map;
  }, [profiles]);

  // 展示列：受保护字段（学号）置顶，其余保持定义顺序
  const displayDefs = useMemo(
    () => sortFieldsForDisplay(profileFieldDefs),
    [profileFieldDefs]
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-40 bg-white dark:bg-slate-900">
              学生
            </TableHead>
            {displayDefs.map((field) => (
              <TableHead key={field.key} className="whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  {field.label}
                  {!isProtectedFieldKey(field.key) && (
                    <button
                      type="button"
                      className="text-slate-400 transition-colors hover:text-red-500"
                      title={`删除字段 ${field.label}`}
                      aria-label={`删除字段 ${field.label}`}
                      onClick={() => onRemoveField(field.key, field.label)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((person) => {
            const data = valueByPerson[person.id] ?? {};
            return (
              <TableRow key={person.id}>
                <TableCell className="sticky left-0 z-10 bg-white dark:bg-slate-900">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => onSelectPerson(person.id)}
                    title={`查看 ${person.name} 的档案`}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: person.color }}
                    />
                    <span className="font-medium">{person.name}</span>
                    {person.status === "archived" && (
                      <span className="shrink-0 text-sm text-slate-400">已归档</span>
                    )}
                  </button>
                </TableCell>
                {displayDefs.map((field) => {
                  const value = data[field.key] ?? "";
                  const color = getValueColor(field, value);
                  return (
                    <TableCell key={field.key} className="whitespace-nowrap">
                      {color ? (
                        <span
                          className="inline-block rounded px-2 py-0.5 text-xs font-medium text-white"
                          style={{ backgroundColor: color }}
                        >
                          {value}
                        </span>
                      ) : value ? (
                        value
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
