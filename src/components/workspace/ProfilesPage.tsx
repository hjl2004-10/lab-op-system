import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GraduationCap,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  Settings2,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileTablePreview from "@/components/workspace/ProfileTablePreview";
import ProfileFieldDefsDialog from "@/components/workspace/ProfileFieldDefsDialog";
import StudentCards from "@/components/workspace/StudentCards";
import {
  getValueColor,
  isProtectedFieldKey,
  sortFieldsForDisplay,
} from "@/lib/profileFields";
import { cn } from "@/lib/utils";
import type { Person, ProfileFieldDef, StudentProfile } from "@/types";

export interface ProfilesPageProps {
  people: Person[];
  profiles: StudentProfile[];
  isAdmin: boolean;
  isManager: boolean;
  currentUserId: string | null;
  selectedStudentIds: string[];
  onSelectedStudentIdsChange: (ids: string[]) => void;
  profileFieldDefs: ProfileFieldDef[];
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
  addProfileFieldDef: (def: ProfileFieldDef) => void;
  removeProfileFieldDef: (key: string) => void;
  addProfileFieldOption: (fieldKey: string, option: string) => void;
  removeProfileFieldOption: (fieldKey: string, option: string) => void;
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
    isManager,
    currentUserId,
    selectedStudentIds,
    onSelectedStudentIdsChange,
    profileFieldDefs,
    onUpdateProfile,
    onUpdateProfileAdminData,
    onReorderProfileFields,
    onAddCategory,
    onRemoveField,
    addProfileFieldDef,
    removeProfileFieldDef,
    addProfileFieldOption,
    removeProfileFieldOption,
  } = props;

  const students = useMemo(
    () =>
      people
        .filter((person) => person.role === "student")
        .sort((a, b) => {
          if (a.status === "archived" && b.status !== "archived") return 1;
          if (a.status !== "archived" && b.status === "archived") return -1;
          return (a.order ?? 0) - (b.order ?? 0);
        }),
    [people]
  );

  const visibleStudents = useMemo(
    () =>
      isManager
        ? students
        : students.filter((person) => person.id === currentUserId),
    [currentUserId, isManager, students]
  );

  const [selectedPersonId, setSelectedPersonId] = useState(
    isManager ? students[0]?.id ?? "" : currentUserId ?? ""
  );
  const [editingPublic, setEditingPublic] = useState(false);
  const [publicDraft, setPublicDraft] = useState<Record<string, string>>({});
  const [newFieldName, setNewFieldName] = useState("");
  const [editingAdmin, setEditingAdmin] = useState(false);
  const [adminValuesDraft, setAdminValuesDraft] = useState<Record<string, string>>({});
  const [adminNoteDraft, setAdminNoteDraft] = useState("");
  // 教师备注区动态字段的添加/删除
  const [adminNewFieldName, setAdminNewFieldName] = useState("");
  const [adminNewFieldType, setAdminNewFieldType] = useState<"text" | "select" | "number">("text");
  const [adminNewFieldOptions, setAdminNewFieldOptions] = useState("");
  // 档案页视图切换 + 预设字段管理弹窗
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [showDefsDialog, setShowDefsDialog] = useState(false);

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

  // 预设字段定义索引（key → def），供公开档案渲染类型/选项
  const defByKey = useMemo(
    () => new Map(profileFieldDefs.map((field) => [field.key, field])),
    [profileFieldDefs]
  );

  // 自定义字段 = 档案里存在但不在预设定义中的 key（兼容旧数据）
  const customPublicKeys = useMemo(() => {
    const defKeys = new Set(profileFieldDefs.map((field) => field.key));
    const keys = new Set<string>();
    for (const profile of profiles) {
      Object.keys(profile.data).forEach((key) => {
        if (!defKeys.has(key)) keys.add(key);
      });
    }
    if (selectedProfile) {
      Object.keys(selectedProfile.data).forEach((key) => {
        if (!defKeys.has(key)) keys.add(key);
      });
    }
    return Array.from(keys);
  }, [profiles, selectedProfile, profileFieldDefs]);

  // 公开档案字段 = 预设字段（学号等受保护字段置顶）在前 + 自定义字段追加
  const publicFieldKeys = useMemo(
    () => [
      ...sortFieldsForDisplay(profileFieldDefs).map((field) => field.key),
      ...customPublicKeys,
    ],
    [profileFieldDefs, customPublicKeys]
  );

  // 全局预设字段的 key 集合（教师备注区区分预设字段与自定义字段）
  const presetKeys = useMemo(
    () => new Set(profileFieldDefs.map((field) => field.key)),
    [profileFieldDefs]
  );

  // 教师备注区字段 = 全局预设字段（教师填写，存 adminOnlyData.values）+
  // 每学生自定义字段（adminOnlyData.fields，预设 key 去重）
  const adminFields = useMemo<ProfileFieldDef[]>(() => {
    if (!isManager) return [];
    const definedFields = (selectedProfile?.adminOnlyData?.fields ?? []).filter(
      (field) => !presetKeys.has(field.key)
    );
    const knownKeys = new Set(definedFields.map((field) => field.key));
    const valueOnlyFields = Object.keys(
      selectedProfile?.adminOnlyData?.values ?? {}
    )
      .filter((key) => !knownKeys.has(key) && !presetKeys.has(key))
      .map<ProfileFieldDef>((key) => ({
        key,
        label: key,
        type: "text",
        category: "fillable",
      }));
    return [
      ...sortFieldsForDisplay(profileFieldDefs),
      ...definedFields,
      ...valueOnlyFields,
    ];
  }, [isManager, profileFieldDefs, presetKeys, selectedProfile]);

  // 教师备注区里非预设的自定义字段（可移动/删除）
  const customAdminFields = useMemo(
    () => adminFields.filter((field) => !presetKeys.has(field.key)),
    [adminFields, presetKeys]
  );

  const selectPerson = (personId: string) => {
    setSelectedPersonId(personId);
    setEditingPublic(false);
    setEditingAdmin(false);
  };

  const startPublicEdit = () => {
    setPublicDraft({ ...(selectedProfile?.data ?? {}) });
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

  // 教师备注区：添加动态字段（名称 + 类型 + 选择类型的预设选项）
  const addAdminField = () => {
    if (!selectedPerson) return;
    const label = adminNewFieldName.trim();
    if (!label) return;
    const existing = selectedProfile?.adminOnlyData?.fields ?? [];
    if (existing.some((field) => field.key === label)) return;
    const field: ProfileFieldDef = {
      key: label,
      label,
      type: adminNewFieldType,
      options:
        adminNewFieldType === "select" && adminNewFieldOptions.trim()
          ? adminNewFieldOptions
              .split(",")
              .map((option) => option.trim())
              .filter(Boolean)
          : undefined,
      category: adminNewFieldType === "select" ? "selectable" : "fillable",
    };
    onUpdateProfileAdminData(selectedPerson.id, {
      fields: [...existing, field],
    });
    setAdminNewFieldName("");
    setAdminNewFieldOptions("");
  };

  // 教师备注区：删除动态字段（同时清理已填的值）
  const removeAdminField = (fieldKey: string) => {
    if (!selectedPerson) return;
    const fields = (selectedProfile?.adminOnlyData?.fields ?? []).filter(
      (field) => field.key !== fieldKey
    );
    const values = { ...(selectedProfile?.adminOnlyData?.values ?? {}) };
    delete values[fieldKey];
    onUpdateProfileAdminData(selectedPerson.id, { fields, values });
  };

  const allPublicKeys = editingPublic
    ? Array.from(new Set([...publicFieldKeys, ...Object.keys(publicDraft)]))
    : publicFieldKeys;

  return (
    <main className="min-w-0 space-y-4 bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <GraduationCap className="size-5" />
            <h1 className="text-lg font-semibold">学生档案</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {isManager ? "查看学生公开资料与教师备注" : "维护我的公开档案"}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDefsDialog(true)}
            >
              <Settings2 className="size-4" />
              预设字段
            </Button>
            <Tabs
              value={viewMode}
              onValueChange={(value) =>
                setViewMode(value === "table" ? "table" : "card")
              }
            >
              <TabsList>
                <TabsTrigger value="card">卡片</TabsTrigger>
                <TabsTrigger value="table">表格</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </header>

      {visibleStudents.length ? (
        viewMode === "table" && isManager ? (
          <div className="space-y-4">
            <StudentCards
              students={students}
              selectedStudentIds={selectedStudentIds}
              onSelectedStudentIdsChange={onSelectedStudentIdsChange}
            />
            <ProfileTablePreview
              students={students.filter((person) =>
                selectedStudentIds.includes(person.id)
              )}
              profiles={profiles}
              profileFieldDefs={profileFieldDefs}
              onSelectPerson={(personId) => {
                setSelectedPersonId(personId);
                setViewMode("card");
              }}
              onRemoveField={(key) => removeProfileFieldDef(key)}
            />
          </div>
        ) : (
        <div className={cn("grid gap-4", isManager && "lg:grid-cols-[224px_minmax(0,1fr)]")}>
          {isManager && (
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
                        ? "bg-slate-800 font-medium text-white"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
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
                      <span className="shrink-0 text-sm opacity-70">已归档</span>
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
                    className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800"
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
                      onClick={() => setEditingPublic(false)}
                    >
                      <X className="size-4" />取消
                    </Button>
                    <Button
                      size="sm"
                      className="bg-sky-500 hover:bg-sky-600"
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
                  {allPublicKeys.map((fieldKey) => {
                    const def = defByKey.get(fieldKey);
                    const value = editingPublic
                      ? publicDraft[fieldKey] ?? ""
                      : selectedProfile?.data[fieldKey] || "";
                    const color = getValueColor(def, value);
                    return (
                    <div
                      key={fieldKey}
                      className="grid min-h-11 grid-cols-[minmax(88px,120px)_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 py-2 dark:border-slate-800"
                    >
                      <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                        {def?.label ?? fieldKey}
                      </span>
                      {editingPublic ? (
                        def?.type === "select" && (def.options ?? []).length > 0 ? (
                          <Select
                            value={value}
                            onValueChange={(next) =>
                              setPublicDraft((current) => ({
                                ...current,
                                [fieldKey]: next,
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 rounded-md bg-white text-sm dark:bg-slate-900">
                              <SelectValue placeholder="请选择" />
                            </SelectTrigger>
                            <SelectContent>
                              {(def.options ?? []).map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={def?.type === "number" ? "number" : "text"}
                            value={value}
                            onChange={(event) =>
                              setPublicDraft((current) => ({
                                ...current,
                                [fieldKey]: event.target.value,
                              }))
                            }
                            className="h-8 rounded-md text-sm"
                          />
                        )
                      ) : color ? (
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="min-w-0 break-words text-sm">{value}</span>
                        </span>
                      ) : (
                        <span className="min-w-0 break-words text-sm">
                          {value || (
                            <span className="text-slate-400">-</span>
                          )}
                        </span>
                      )}
                      {isManager && editingPublic && !isProtectedFieldKey(fieldKey) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-red-600"
                          title={`删除字段 ${fieldKey}`}
                          aria-label={`删除字段 ${fieldKey}`}
                          onClick={() => {
                            if (presetKeys.has(fieldKey)) {
                              removeProfileFieldDef(fieldKey);
                            } else {
                              removePublicField(fieldKey);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400">
                  暂无公开档案字段
                </div>
              )}

              {isManager && editingPublic && (
                <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
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

            </article>

            {isManager && selectedPerson && (
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
                        className="bg-sky-500 hover:bg-sky-600"
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
                          {editingAdmin &&
                          !presetKeys.has(field.key) &&
                          adminFields.length > 1 ? (
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
                          ) : editingAdmin &&
                            presetKeys.has(field.key) &&
                            !isProtectedFieldKey(field.key) ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-red-500"
                              title={`删除字段 ${field.label}（应用于全部学生）`}
                              aria-label={`删除字段 ${field.label}`}
                              onClick={() => removeProfileFieldDef(field.key)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : (
                            <span />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {editingAdmin && (
                  <>
                    <div className="mt-4 rounded-lg border border-dashed border-amber-300 p-3 dark:border-amber-800">
                      <h4 className="mb-3 flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
                        <Plus className="size-4" />
                        添加自定义字段
                      </h4>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                            字段名称
                          </label>
                          <Input
                            value={adminNewFieldName}
                            onChange={(event) =>
                              setAdminNewFieldName(event.target.value)
                            }
                            placeholder="输入字段名称..."
                            className="h-8 rounded-md bg-white text-sm dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                            类型
                          </label>
                          <Select
                            value={adminNewFieldType}
                            onValueChange={(value) => {
                              if (
                                value === "text" ||
                                value === "select" ||
                                value === "number"
                              ) {
                                setAdminNewFieldType(value);
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 w-28 rounded-md bg-white text-sm dark:bg-slate-900">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">文本</SelectItem>
                              <SelectItem value="select">选择</SelectItem>
                              <SelectItem value="number">数字</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {adminNewFieldType === "select" && (
                          <div className="flex-[2]">
                            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                              选项（逗号分隔）
                            </label>
                            <Input
                              value={adminNewFieldOptions}
                              onChange={(event) =>
                                setAdminNewFieldOptions(event.target.value)
                              }
                              placeholder="选项1,选项2,选项3..."
                              className="h-8 rounded-md bg-white text-sm dark:bg-slate-900"
                            />
                          </div>
                        )}
                        <Button
                          size="sm"
                          onClick={addAdminField}
                          disabled={!adminNewFieldName.trim()}
                        >
                          添加
                        </Button>
                      </div>
                    </div>

                    {customAdminFields.length > 0 && (
                      <div className="mt-3 rounded-lg border border-dashed border-red-200 p-3 dark:border-red-900">
                        <h4 className="mb-2 flex items-center gap-1 text-sm font-semibold text-red-600 dark:text-red-400">
                          <Trash2 className="size-4" />
                          删除自定义字段
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {customAdminFields.map((field) => (
                            <Button
                              key={field.key}
                              size="sm"
                              variant="outline"
                              className="text-red-500 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                              onClick={() => removeAdminField(field.key)}
                            >
                              <Trash2 className="size-3" />
                              {field.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
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
        )
      ) : (
        <section className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          <GraduationCap className="size-8" />
          {isManager ? "暂无学生账户" : "未找到当前用户档案"}
        </section>
      )}

      <ProfileFieldDefsDialog
        open={showDefsDialog}
        onOpenChange={setShowDefsDialog}
        defs={profileFieldDefs}
        onAddDef={addProfileFieldDef}
        onRemoveDef={removeProfileFieldDef}
        onAddOption={addProfileFieldOption}
        onRemoveOption={removeProfileFieldOption}
      />
    </main>
  );
}
