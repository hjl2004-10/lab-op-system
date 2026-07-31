import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GraduationCap,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Person, ProfileFieldDef, StudentProfile } from "@/types";

export interface ProfilesPageProps {
  people: Person[];
  profiles: StudentProfile[];
  isAdmin: boolean;
  currentUserId: string | null;
  onUpdateProfile: (profile: StudentProfile) => void;
  onUpdateProfileAdminData: (
    personId: string,
    updates: {
      fields?: ProfileFieldDef[];
      values?: Record<string, string>;
      note?: string;
    }
  ) => void;
  onReorderProfileFields: (personId: string, fieldKeys: string[]) => void;
  onAddCategory: (category: string) => void;
  onRemoveField: (field: string) => void;
}

const EMPTY_ADMIN_DATA = {
  fields: [] as ProfileFieldDef[],
  values: {} as Record<string, string>,
  note: "",
};

export default function ProfilesPage(props: ProfilesPageProps) {
  const {
    people,
    profiles,
    isAdmin,
    currentUserId,
    onUpdateProfile,
    onUpdateProfileAdminData,
    onReorderProfileFields,
    onAddCategory,
    onRemoveField,
  } = props;

  const students = useMemo(
    () =>
      people
        .filter((person) => person.role === "member")
        .sort((a, b) => {
          if (a.status === "archived" && b.status !== "archived") return 1;
          if (a.status !== "archived" && b.status === "archived") return -1;
          return (a.order ?? 0) - (b.order ?? 0);
        }),
    [people]
  );

  const visibleStudents = useMemo(
    () =>
      isAdmin
        ? students
        : students.filter((person) => person.id === currentUserId),
    [currentUserId, isAdmin, students]
  );

  const [selectedPersonId, setSelectedPersonId] = useState(
    isAdmin ? students[0]?.id ?? "" : currentUserId ?? ""
  );
  const [editingPublic, setEditingPublic] = useState(false);
  const [publicDraft, setPublicDraft] = useState<Record<string, string>>({});
  const [newFieldName, setNewFieldName] = useState("");
  const [pendingDeleteField, setPendingDeleteField] = useState<string | null>(null);
  const [editingAdmin, setEditingAdmin] = useState(false);
  const [adminValuesDraft, setAdminValuesDraft] = useState<Record<string, string>>({});
  const [adminNoteDraft, setAdminNoteDraft] = useState("");

  const effectiveSelectedPersonId = visibleStudents.some(
    (person) => person.id === selectedPersonId
  )
    ? selectedPersonId
    : visibleStudents[0]?.id ?? "";

  const selectedPerson = useMemo(
    () =>
      visibleStudents.find(
        (person) => person.id === effectiveSelectedPersonId
      ) ?? null,
    [effectiveSelectedPersonId, visibleStudents]
  );
  const selectedProfile = useMemo(
    () =>
      profiles.find(
        (profile) => profile.personId === effectiveSelectedPersonId
      ) ?? null,
    [effectiveSelectedPersonId, profiles]
  );

  const publicFieldKeys = useMemo(() => {
    if (!isAdmin) return Object.keys(selectedProfile?.data ?? {});
    const keys = new Set<string>();
    for (const profile of profiles) {
      Object.keys(profile.data).forEach((key) => keys.add(key));
    }
    Object.keys(selectedProfile?.data ?? {}).forEach((key) => keys.add(key));
    return Array.from(keys);
  }, [isAdmin, profiles, selectedProfile]);

  const adminFields = useMemo<ProfileFieldDef[]>(() => {
    if (!isAdmin) return [];
    const definedFields = selectedProfile?.adminOnlyData?.fields ?? [];
    const knownKeys = new Set(definedFields.map((field) => field.key));
    const valueOnlyFields = Object.keys(
      selectedProfile?.adminOnlyData?.values ?? {}
    )
      .filter((key) => !knownKeys.has(key))
      .map<ProfileFieldDef>((key) => ({
        key,
        label: key,
        type: "text",
        category: "fillable",
      }));
    return [...definedFields, ...valueOnlyFields];
  }, [isAdmin, selectedProfile]);

  const selectPerson = (personId: string) => {
    setSelectedPersonId(personId);
    setEditingPublic(false);
    setEditingAdmin(false);
    setPendingDeleteField(null);
  };

  const startPublicEdit = () => {
    setPublicDraft({ ...(selectedProfile?.data ?? {}) });
    setPendingDeleteField(null);
    setEditingPublic(true);
  };

  const savePublicProfile = () => {
    if (!selectedPerson) return;
    onUpdateProfile({
      personId: selectedPerson.id,
      personName: selectedPerson.name,
      data: publicDraft,
      adminOnlyData: selectedProfile?.adminOnlyData ?? EMPTY_ADMIN_DATA,
    });
    setEditingPublic(false);
    setPendingDeleteField(null);
  };

  const addPublicField = () => {
    const field = newFieldName.trim();
    if (!field || publicFieldKeys.includes(field)) return;
    onAddCategory(field);
    setPublicDraft((current) => ({ ...current, [field]: "" }));
    setNewFieldName("");
  };

  const removePublicField = (field: string) => {
    onRemoveField(field);
    setPublicDraft((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setPendingDeleteField(null);
  };

  const startAdminEdit = () => {
    setAdminValuesDraft({ ...(selectedProfile?.adminOnlyData?.values ?? {}) });
    setAdminNoteDraft(selectedProfile?.adminOnlyData?.note ?? "");
    setEditingAdmin(true);
  };

  const saveAdminData = () => {
    if (!selectedPerson) return;
    onUpdateProfileAdminData(selectedPerson.id, {
      values: adminValuesDraft,
      note: adminNoteDraft,
    });
    setEditingAdmin(false);
  };

  const moveAdminField = (fieldKey: string, direction: -1 | 1) => {
    if (!selectedPerson) return;
    const keys = adminFields.map((field) => field.key);
    const index = keys.indexOf(fieldKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    onReorderProfileFields(selectedPerson.id, keys);
  };

  const allPublicKeys = editingPublic
    ? Array.from(new Set([...publicFieldKeys, ...Object.keys(publicDraft)]))
    : publicFieldKeys;

  return (
    <main className="min-w-0 space-y-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <header className="border-b border-emerald-900/15 pb-4 dark:border-emerald-300/15">
        <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
          <GraduationCap className="size-5" />
          <h1 className="text-lg font-semibold">学生档案</h1>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {isAdmin ? "查看学生公开资料与教师备注" : "维护我的公开档案"}
        </p>
      </header>

      {visibleStudents.length ? (
        <div className={cn("grid gap-4", isAdmin && "lg:grid-cols-[224px_minmax(0,1fr)]")}>
          {isAdmin && (
            <aside className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 px-2 py-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                成员 ({visibleStudents.length})
              </div>
              <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1" aria-label="学生列表">
                {visibleStudents.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => selectPerson(person.id)}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      effectiveSelectedPersonId === person.id
                        ? "bg-emerald-800 font-medium text-white"
                        : "text-slate-700 hover:bg-emerald-50 dark:text-slate-200 dark:hover:bg-emerald-950"
                    )}
                  >
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800"
                      style={{ color: person.color }}
                    >
                      <UserRound className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{person.name}</span>
                    {person.status === "archived" && (
                      <span className="shrink-0 text-[10px] opacity-70">已归档</span>
                    )}
                  </button>
                ))}
              </nav>
            </aside>
          )}

          <section className="min-w-0 space-y-4">
            {selectedPerson && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950"
                    style={{ color: selectedPerson.color }}
                  >
                    <UserRound className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">{selectedPerson.name}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedPerson.status === "archived" ? "已毕业" : "在读"}
                    </p>
                  </div>
                </div>
                {!editingPublic ? (
                  <Button variant="outline" size="sm" onClick={startPublicEdit}>
                    <Pencil className="size-4" />编辑公开档案
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingPublic(false);
                        setPendingDeleteField(null);
                      }}
                    >
                      <X className="size-4" />取消
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-800 hover:bg-emerald-700"
                      onClick={savePublicProfile}
                    >
                      <Save className="size-4" />保存
                    </Button>
                  </div>
                )}
              </div>
            )}

            <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">公开档案</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  学生本人和管理员可见
                </p>
              </div>

              {allPublicKeys.length ? (
                <div className="grid gap-x-6 md:grid-cols-2">
                  {allPublicKeys.map((field) => (
                    <div
                      key={field}
                      className="grid min-h-11 grid-cols-[minmax(88px,120px)_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 py-2 dark:border-slate-800"
                    >
                      <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                        {field}
                      </span>
                      {editingPublic ? (
                        <Input
                          value={publicDraft[field] ?? ""}
                          onChange={(event) =>
                            setPublicDraft((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          className="h-8 rounded-md text-sm"
                        />
                      ) : (
                        <span className="min-w-0 break-words text-sm">
                          {selectedProfile?.data[field] || (
                            <span className="text-slate-400">-</span>
                          )}
                        </span>
                      )}
                      {isAdmin && editingPublic && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-red-600"
                          title={`删除字段 ${field}`}
                          aria-label={`删除字段 ${field}`}
                          onClick={() => setPendingDeleteField(field)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400">
                  暂无公开档案字段
                </div>
              )}

              {isAdmin && editingPublic && (
                <div className="mt-4 rounded-lg border border-dashed border-emerald-300 p-3 dark:border-emerald-800">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={newFieldName}
                      onChange={(event) => setNewFieldName(event.target.value)}
                      className="h-9 rounded-md"
                      placeholder="新公开字段名称"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0"
                      onClick={addPublicField}
                      disabled={!newFieldName.trim()}
                    >
                      <Plus className="size-4" />添加字段
                    </Button>
                  </div>
                </div>
              )}

              {pendingDeleteField && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
                  <span>删除公开字段“{pendingDeleteField}”将影响全部档案。</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingDeleteField(null)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removePublicField(pendingDeleteField)}
                    >
                      确认删除
                    </Button>
                  </div>
                </div>
              )}
            </article>

            {isAdmin && selectedPerson && (
              <article className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <LockKeyhole className="size-4 text-amber-700 dark:text-amber-300" />
                      <h3 className="text-sm font-semibold">教师备注</h3>
                      <Badge className="rounded-md bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100">
                        仅管理员可见
                      </Badge>
                    </div>
                  </div>
                  {!editingAdmin ? (
                    <Button variant="outline" size="sm" onClick={startAdminEdit}>
                      <Pencil className="size-4" />编辑备注
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingAdmin(false)}
                      >
                        <X className="size-4" />取消
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-800 hover:bg-emerald-700"
                        onClick={saveAdminData}
                      >
                        <Save className="size-4" />保存
                      </Button>
                    </div>
                  )}
                </div>

                {adminFields.length > 0 && (
                  <div className="mb-4 grid gap-x-6 md:grid-cols-2">
                    {adminFields.map((field, index) => {
                      const value = editingAdmin
                        ? adminValuesDraft[field.key] ?? ""
                        : selectedProfile?.adminOnlyData?.values?.[field.key] ?? "";
                      return (
                        <div
                          key={field.key}
                          className="grid min-h-11 grid-cols-[minmax(88px,120px)_minmax(0,1fr)_auto] items-center gap-2 border-b border-amber-200/70 py-2 dark:border-amber-900/60"
                        >
                          <span className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                            {field.label}
                          </span>
                          {editingAdmin ? (
                            field.type === "select" && field.options?.length ? (
                              <Select
                                value={value}
                                onValueChange={(nextValue) =>
                                  setAdminValuesDraft((current) => ({
                                    ...current,
                                    [field.key]: nextValue,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 rounded-md bg-white dark:bg-slate-900">
                                  <SelectValue placeholder="请选择" />
                                </SelectTrigger>
                                <SelectContent>
                                  {field.options.map((option) => (
                                    <SelectItem key={option} value={option}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                type={field.type === "number" ? "number" : "text"}
                                value={value}
                                onChange={(event) =>
                                  setAdminValuesDraft((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                  }))
                                }
                                className="h-8 rounded-md bg-white dark:bg-slate-900"
                              />
                            )
                          ) : (
                            <span className="break-words text-sm">{value || "-"}</span>
                          )}
                          {editingAdmin && adminFields.length > 1 ? (
                            <div className="flex">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                title="上移字段"
                                aria-label={`上移 ${field.label}`}
                                disabled={index === 0}
                                onClick={() => moveAdminField(field.key, -1)}
                              >
                                <ChevronUp className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                title="下移字段"
                                aria-label={`下移 ${field.label}`}
                                disabled={index === adminFields.length - 1}
                                onClick={() => moveAdminField(field.key, 1)}
                              >
                                <ChevronDown className="size-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    文字备注
                  </span>
                  {editingAdmin ? (
                    <Textarea
                      value={adminNoteDraft}
                      onChange={(event) => setAdminNoteDraft(event.target.value)}
                      className="min-h-28 rounded-lg bg-white dark:bg-slate-900"
                      placeholder="填写教师备注"
                    />
                  ) : (
                    <div className="min-h-20 whitespace-pre-wrap rounded-lg border border-amber-200 bg-white p-3 text-sm dark:border-amber-900 dark:bg-slate-900">
                      {selectedProfile?.adminOnlyData?.note || (
                        <span className="text-slate-400">暂无教师备注</span>
                      )}
                    </div>
                  )}
                </label>
              </article>
            )}
          </section>
        </div>
      ) : (
        <section className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          <GraduationCap className="size-8" />
          {isAdmin ? "暂无学生账户" : "未找到当前用户档案"}
        </section>
      )}
    </main>
  );
}
