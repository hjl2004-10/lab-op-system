import { useState, useMemo, useCallback, useEffect } from "react";
import {
  GraduationCap,
  Pencil,
  Save,
  X,
  Eye,
  GripVertical,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Person, StudentProfile, ProfileFieldDef } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================================
// Types
// ============================================================

interface StudentProfilePanelProps {
  open: boolean;
  people: Person[];
  profiles: StudentProfile[];
  isAdmin: boolean;
  currentUserId: string | null;
  onOpenChange: (open: boolean) => void;
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

interface FieldDefinition {
  key: string;
  label: string;
  type: "text" | "select";
  options?: string[];
}

// ============================================================
// Default Admin-Only Field Definitions
// ============================================================

const DEFAULT_SELECTABLE_FIELDS: ProfileFieldDef[] = [
  {
    key: "hometown",
    label: "家乡",
    type: "select",
    category: "selectable",
    options: [
      "北京",
      "上海",
      "广州",
      "深圳",
      "成都",
      "武汉",
      "西安",
      "杭州",
      "南京",
      "重庆",
      "天津",
      "其他城市",
    ],
  },
  {
    key: "mbti",
    label: "MBTI",
    type: "select",
    category: "selectable",
    options: [
      "ISTJ",
      "ISFJ",
      "INFJ",
      "INTJ",
      "ISTP",
      "ISFP",
      "INFP",
      "INTP",
      "ESTP",
      "ESFP",
      "ENFP",
      "ENTP",
      "ESTJ",
      "ESFJ",
      "ENFJ",
      "ENTJ",
    ],
  },
  {
    key: "major",
    label: "专业",
    type: "select",
    category: "selectable",
    options: [
      "计算机科学与技术",
      "软件工程",
      "电子信息",
      "通信工程",
      "自动化",
      "人工智能",
      "数据科学",
      "网络安全",
      "其他",
    ],
  },
  {
    key: "team",
    label: "中心团队",
    type: "select",
    category: "selectable",
    options: ["算法组", "工程组", "产品组", "设计组", "研究组", "实习组"],
  },
  {
    key: "entryYear",
    label: "入学年份",
    type: "select",
    category: "selectable",
    options: ["2024", "2025", "2026", "2027", "2028"],
  },
  {
    key: "program",
    label: "培养方式",
    type: "select",
    category: "selectable",
    options: ["学硕", "专硕", "直博", "普博", "本科毕设", "访问学生"],
  },
  {
    key: "gender",
    label: "性别",
    type: "select",
    category: "selectable",
    options: ["男", "女"],
  },
  {
    key: "advisorRole",
    label: "指导身份",
    type: "select",
    category: "selectable",
    options: ["第一导师", "联合导师", "副导师"],
  },
  {
    key: "ugSchool",
    label: "本科院校",
    type: "select",
    category: "selectable",
    options: [],
  },
  {
    key: "msSchool",
    label: "硕士院校",
    type: "select",
    category: "selectable",
    options: [],
  },
  {
    key: "careerPlan",
    label: "毕业意向",
    type: "select",
    category: "selectable",
    options: ["继续深造", "工业界", "学术界", "创业", "待定"],
  },
  {
    key: "grade",
    label: "评分",
    type: "select",
    category: "selectable",
    options: ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"],
  },
];

const DEFAULT_FILLABLE_FIELDS: ProfileFieldDef[] = [
  { key: "examScore", label: "考研成绩", type: "number", category: "fillable" },
  { key: "projectName", label: "课题名称", type: "text", category: "fillable" },
  { key: "notes", label: "备注", type: "text", category: "fillable" },
];

const ALL_DEFAULT_FIELDS: ProfileFieldDef[] = [
  ...DEFAULT_SELECTABLE_FIELDS,
  ...DEFAULT_FILLABLE_FIELDS,
];

// ============================================================
// Helpers
// ============================================================

function detectFieldType(key: string, values: string[]): "text" | "select" {
  const selectKeywords = [
    "方向",
    "专业",
    "学位",
    "年级",
    "性别",
    "学历",
    "类别",
    "状态",
    "角色",
  ];
  if (selectKeywords.some((kw) => key.includes(kw))) {
    const uniqueValues = [...new Set(values.filter((v) => v.trim()))];
    if (uniqueValues.length >= 2 && uniqueValues.length <= 20) {
      return "select";
    }
  }
  return "text";
}

function getFieldOptions(key: string, profiles: StudentProfile[]): string[] {
  const values = profiles
    .map((p) => p.data[key] ?? "")
    .filter((v) => v.trim());
  return [...new Set(values)];
}

// ============================================================
// Component
// ============================================================

export default function StudentProfilePanel({
  open,
  people,
  profiles,
  isAdmin,
  currentUserId,
  onOpenChange,
  onUpdateProfile,
  onUpdateProfileAdminData,
  onReorderProfileFields,
  onAddCategory,
  onRemoveField,
}: StudentProfilePanelProps) {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("active");

  // Admin panel edit state
  const [isAdminEditing, setIsAdminEditing] = useState(false);
  const [adminEditValues, setAdminEditValues] = useState<Record<string, string>>(
    {}
  );
  const [adminEditNote, setAdminEditNote] = useState("");

  // Drag state
  const [draggingFieldKey, setDraggingFieldKey] = useState<string | null>(null);
  const [dragOverFieldKey, setDragOverFieldKey] = useState<string | null>(null);

  // New field form state
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "select">("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");

  // Filter people by active/archived
  const activePeople = useMemo(
    () => people.filter((p) => p.status !== "archived"),
    [people]
  );
  const archivedPeople = useMemo(
    () => people.filter((p) => p.status === "archived"),
    [people]
  );

  // Selected person
  const selectedPerson = useMemo(
    () => people.find((p) => p.id === selectedPersonId) || null,
    [people, selectedPersonId]
  );

  // Selected person's profile
  const selectedProfile = useMemo(
    () => profiles.find((p) => p.personId === selectedPersonId) || null,
    [profiles, selectedPersonId]
  );

  // Check if current user can edit the main profile
  const canEditProfile = useMemo(() => {
    if (!selectedPerson) return false;
    if (isAdmin) return true;
    return selectedPerson.id === currentUserId;
  }, [isAdmin, selectedPerson, currentUserId]);

  // Admin-only fields (ordered)
  const adminFieldDefs = useMemo<ProfileFieldDef[]>(() => {
    if (!selectedProfile) return ALL_DEFAULT_FIELDS;
    const fields = selectedProfile.adminOnlyData?.fields;
    if (!fields || fields.length === 0) return ALL_DEFAULT_FIELDS;
    return fields;
  }, [selectedProfile]);

  // Split into selectable and fillable
  const selectableFields = useMemo(
    () => adminFieldDefs.filter((f) => f.category === "selectable"),
    [adminFieldDefs]
  );
  const fillableFields = useMemo(
    () => adminFieldDefs.filter((f) => f.category === "fillable"),
    [adminFieldDefs]
  );

  // Admin values
  const adminValues = useMemo<Record<string, string>>(() => {
    if (!selectedProfile) return {};
    return selectedProfile.adminOnlyData?.values || {};
  }, [selectedProfile]);

  const adminNote = useMemo<string>(() => {
    if (!selectedProfile) return "";
    return selectedProfile.adminOnlyData?.note || "";
  }, [selectedProfile]);

  // Auto-initialize adminOnlyData when profile is missing it
  useEffect(() => {
    if (selectedPerson && selectedProfile && (!selectedProfile.adminOnlyData || !selectedProfile.adminOnlyData.fields || selectedProfile.adminOnlyData.fields.length === 0)) {
      onUpdateProfileAdminData(selectedPerson.id, {
        fields: ALL_DEFAULT_FIELDS,
        values: selectedProfile.adminOnlyData?.values || {},
        note: selectedProfile.adminOnlyData?.note || "",
      });
    }
  }, [selectedPerson, selectedProfile, onUpdateProfileAdminData]);

  // All dynamic field keys from all profiles
  const dynamicFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const profile of profiles) {
      for (const key of Object.keys(profile.data)) {
        keys.add(key);
      }
    }
    return [...keys];
  }, [profiles]);

  // Build field definitions for dynamic fields
  const dynamicFieldDefs = useMemo<FieldDefinition[]>(() => {
    return dynamicFieldKeys.map((key) => {
      const values = getFieldOptions(key, profiles);
      const type = detectFieldType(key, values);
      return {
        key,
        label: key,
        type,
        options: type === "select" ? values : undefined,
      };
    });
  }, [dynamicFieldKeys, profiles]);

  // -- Profile editing (main) --

  const startEdit = useCallback(() => {
    if (!selectedPerson) return;
    // Use existing profile data, or build from dynamic fields if no profile
    if (selectedProfile) {
      setEditData({ ...selectedProfile.data });
    } else {
      // Build empty edit data from all dynamic field keys
      const emptyData: Record<string, string> = {};
      for (const field of dynamicFieldDefs) {
        emptyData[field.key] = "";
      }
      setEditData(emptyData);
    }
    setIsEditing(true);
  }, [selectedPerson, selectedProfile, dynamicFieldDefs]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditData({});
  }, []);

  const saveProfile = useCallback(() => {
    if (!selectedPerson) return;
    const updated: StudentProfile = {
      personId: selectedPerson.id,
      personName: selectedPerson.name,
      data: { ...editData },
      adminOnlyData: selectedProfile?.adminOnlyData || {
        fields: [],
        values: {},
        note: "",
      },
    };
    onUpdateProfile(updated);
    setIsEditing(false);
    setEditData({});
  }, [selectedPerson, editData, onUpdateProfile, selectedProfile]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setEditData((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-save immediately
      if (selectedPerson) {
        onUpdateProfile({
          personId: selectedPerson.id,
          personName: selectedPerson.name,
          data: { ...next },
          adminOnlyData: selectedProfile?.adminOnlyData || { fields: [], values: {}, note: "" },
        });
      }
      return next;
    });
  }, [selectedPerson, selectedProfile, onUpdateProfile]);

  // -- Admin panel editing --

  const startAdminEdit = useCallback(() => {
    setAdminEditValues({ ...adminValues });
    setAdminEditNote(adminNote);
    setIsAdminEditing(true);
  }, [adminValues, adminNote]);

  const cancelAdminEdit = useCallback(() => {
    setIsAdminEditing(false);
    setAdminEditValues({});
    setAdminEditNote("");
  }, []);

  const saveAdminEdit = useCallback(() => {
    if (!selectedPerson) return;
    onUpdateProfileAdminData(selectedPerson.id, {
      values: adminEditValues,
      note: adminEditNote,
    });
    setIsAdminEditing(false);
  }, [selectedPerson, adminEditValues, adminEditNote, onUpdateProfileAdminData]);

  const handleAdminValueChange = useCallback(
    (key: string, value: string) => {
      setAdminEditValues((prev) => {
        const next = { ...prev, [key]: value };
        // Auto-save immediately
        if (selectedPerson) {
          onUpdateProfileAdminData(selectedPerson.id, {
            values: { ...next },
          });
        }
        return next;
      });
    },
    [selectedPerson, onUpdateProfileAdminData]
  );

  // -- Drag and drop --

  const handleDragStart = useCallback(
    (e: React.DragEvent, fieldKey: string) => {
      if (!isAdminEditing) {
        e.preventDefault();
        return;
      }
      setDraggingFieldKey(fieldKey);
      e.dataTransfer.effectAllowed = "move";
      // Required for Firefox
      e.dataTransfer.setData("text/plain", fieldKey);
    },
    [isAdminEditing]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, fieldKey: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggingFieldKey && draggingFieldKey !== fieldKey) {
        setDragOverFieldKey(fieldKey);
      }
    },
    [draggingFieldKey]
  );

  const handleDragLeave = useCallback(() => {
    setDragOverFieldKey(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetFieldKey: string) => {
      e.preventDefault();
      if (!draggingFieldKey || !selectedPerson) {
        setDraggingFieldKey(null);
        setDragOverFieldKey(null);
        return;
      }
      if (draggingFieldKey === targetFieldKey) {
        setDraggingFieldKey(null);
        setDragOverFieldKey(null);
        return;
      }

      // Build new order: all field keys in current order
      const allFieldKeys = adminFieldDefs.map((f) => f.key);
      const fromIdx = allFieldKeys.indexOf(draggingFieldKey);
      const toIdx = allFieldKeys.indexOf(targetFieldKey);

      if (fromIdx >= 0 && toIdx >= 0) {
        const reordered = [...allFieldKeys];
        reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, draggingFieldKey);
        onReorderProfileFields(selectedPerson.id, reordered);
      }

      setDraggingFieldKey(null);
      setDragOverFieldKey(null);
    },
    [draggingFieldKey, selectedPerson, adminFieldDefs, onReorderProfileFields]
  );

  // -- Adding/removing fields --

  const handleAddField = useCallback(() => {
    const name = newFieldName.trim();
    if (!name) return;
    onAddCategory(name);
    setNewFieldName("");
    setNewFieldType("text");
    setNewFieldOptions("");
  }, [newFieldName, onAddCategory]);

  const handleRemoveField = useCallback(
    (field: string) => {
      if (
        window.confirm(`确定要删除字段"${field}"吗？此操作不可恢复。`)
      ) {
        onRemoveField(field);
      }
    },
    [onRemoveField]
  );

  // -- Dialog open/close --

  const handleOpenChange = useCallback(
    (o: boolean) => {
      onOpenChange(o);
      if (!o) {
        setSelectedPersonId(null);
        setIsEditing(false);
        setEditData({});
        setIsAdminEditing(false);
        setAdminEditValues({});
        setAdminEditNote("");
      } else if (!selectedPersonId && activePeople.length > 0) {
        setSelectedPersonId(activePeople[0].id);
      }
    },
    [onOpenChange, selectedPersonId, activePeople]
  );

  // -- Render helpers --

  const renderStaticFields = () => {
    if (!selectedPerson) return null;
    return (
      <>
        <div className="grid grid-cols-[120px_1fr] items-center border-b border-slate-100 dark:border-slate-700 py-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            姓名
          </span>
          <span className="text-sm text-slate-800 dark:text-slate-200">
            {selectedPerson.name}
          </span>
        </div>
        <div className="grid grid-cols-[120px_1fr] items-center border-b border-slate-100 dark:border-slate-700 py-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            身份
          </span>
          <span className="text-sm text-slate-800 dark:text-slate-200">
            {selectedPerson.role === "admin" ? "管理员" : "成员"}
          </span>
        </div>
        <div className="grid grid-cols-[120px_1fr] items-center border-b border-slate-100 dark:border-slate-700 py-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            状态
          </span>
          <span
            className={cn(
              "text-sm",
              selectedPerson.status === "archived"
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {selectedPerson.status === "archived" ? "已毕业" : "在读"}
          </span>
        </div>
      </>
    );
  };

  const renderDynamicFields = () => {
    if (dynamicFieldDefs.length === 0 && !isEditing) {
      return (
        <div className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
          暂无动态字段
        </div>
      );
    }

    if (isEditing) {
      return dynamicFieldDefs.map((field) => (
        <div
          key={field.key}
          className="grid grid-cols-[120px_1fr] items-center border-b border-slate-100 dark:border-slate-700 py-2 gap-2"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {field.label}
          </span>
          {field.type === "select" &&
          field.options &&
          field.options.length > 0 ? (
            <Select
              value={editData[field.key] ?? ""}
              onValueChange={(val) => handleFieldChange(field.key, val)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="请选择..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">（空）</SelectItem>
                {field.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={editData[field.key] ?? ""}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              className="h-8 text-sm"
              placeholder={`输入${field.label}...`}
            />
          )}
        </div>
      ));
    }

    // View mode
    if (!selectedProfile) {
      return dynamicFieldDefs.map((field) => (
        <div
          key={field.key}
          className="grid grid-cols-[120px_1fr] items-center border-b border-slate-100 dark:border-slate-700 py-2"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {field.label}
          </span>
          <span className="text-sm text-slate-400 dark:text-slate-500">
            —
          </span>
        </div>
      ));
    }

    return dynamicFieldDefs.map((field) => (
      <div
        key={field.key}
        className="grid grid-cols-[120px_1fr] items-center border-b border-slate-100 dark:border-slate-700 py-2"
      >
        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          {field.label}
        </span>
        <span className="text-sm text-slate-800 dark:text-slate-200">
          {selectedProfile.data[field.key] || (
            <span className="text-slate-400 dark:text-slate-500">—</span>
          )}
        </span>
      </div>
    ));
  };

  // Render list table showing all students' admin data
  const renderStudentListTable = () => {
    const allStudents = people.filter(p => p.role !== "admin");
    const ADMIN_FIELD_KEYS = [
      { key: "hometown", label: "家乡" },
      { key: "mbti", label: "MBTI" },
      { key: "major", label: "专业" },
      { key: "team", label: "中心团队" },
      { key: "entryYear", label: "入学年份" },
      { key: "program", label: "培养方式" },
      { key: "gender", label: "性别" },
      { key: "advisorRole", label: "指导身份" },
      { key: "ugSchool", label: "本科院校" },
      { key: "msSchool", label: "硕士院校" },
      { key: "careerPlan", label: "毕业意向" },
      { key: "grade", label: "评分" },
      { key: "examScore", label: "考研成绩" },
      { key: "projectName", label: "课题名称" },
      { key: "notes", label: "备注" },
    ];

    const getValue = (personId: string, key: string) => {
      const profile = profiles.find(p => p.personId === personId);
      const v = profile?.adminOnlyData?.values?.[key];
      return v || "—";
    };

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs sticky left-0 bg-white dark:bg-slate-800 z-10 min-w-[80px]">姓名</TableHead>
              {ADMIN_FIELD_KEYS.map(f => (
                <TableHead key={f.key} className="text-xs min-w-[60px]">{f.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allStudents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={ADMIN_FIELD_KEYS.length + 1} className="text-center text-sm text-slate-400 py-4">
                  暂无学生数据
                </TableCell>
              </TableRow>
            ) : (
              allStudents.map(person => (
                <TableRow key={person.id}>
                  <TableCell className="text-xs font-medium sticky left-0 bg-white dark:bg-slate-800 z-10">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: person.color }} />
                      {person.name}
                    </span>
                  </TableCell>
                  {ADMIN_FIELD_KEYS.map(f => (
                    <TableCell key={f.key} className="text-xs text-slate-600 dark:text-slate-400">
                      {getValue(person.id, f.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  // Render a single admin field (selectable or fillable)
  const renderAdminField = (field: ProfileFieldDef) => {
    const isDragging = draggingFieldKey === field.key;
    const isDragOver = dragOverFieldKey === field.key;
    const value = isAdminEditing
      ? adminEditValues[field.key] ?? ""
      : adminValues[field.key] ?? "";

    return (
      <div
        key={field.key}
        draggable={isAdminEditing}
        onDragStart={(e) => handleDragStart(e, field.key)}
        onDragOver={(e) => handleDragOver(e, field.key)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, field.key)}
        className={cn(
          "grid grid-cols-[24px_100px_1fr] items-center border-b border-amber-100 dark:border-amber-900/30 py-2 gap-1 transition-colors",
          isDragging && "opacity-50",
          isDragOver && "bg-amber-100 dark:bg-amber-900/30"
        )}
      >
        {/* Drag handle */}
        <div
          className={cn(
            "flex items-center justify-center",
            isAdminEditing
              ? "cursor-grab text-slate-300 hover:text-slate-500"
              : "cursor-default text-slate-200 dark:text-slate-700"
          )}
        >
          <GripVertical size={14} />
        </div>

        {/* Label */}
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
          {field.label}
        </span>

        {/* Value / Input */}
        <div className="min-w-0">
          {isAdminEditing ? (
            <Input
              type="text"
              value={value}
              onChange={(e) => handleAdminValueChange(field.key, e.target.value)}
              className="h-8 text-sm"
              placeholder={`输入${field.label}...`}
            />
          ) : (
            <span className="text-sm text-slate-800 dark:text-slate-200">
              {value || (
                <span className="text-slate-400 dark:text-slate-500">—</span>
              )}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="max-w-7xl p-0 flex flex-col overflow-hidden" 
        style={{ resize: 'both', width: '98vw', height: '95vh', minWidth: '700px', minHeight: '400px' }}
      >
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <GraduationCap className="w-5 h-5 text-blue-500" />
            学生档案
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Person list */}
          <div className="w-56 border-r border-slate-200 dark:border-slate-700 flex flex-col shrink-0">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex flex-col h-full"
            >
              <TabsList className="mx-2 mt-2 grid grid-cols-3">
                <TabsTrigger value="active">
                  在读 ({activePeople.length})
                </TabsTrigger>
                <TabsTrigger value="archived">
                  已毕业 ({archivedPeople.length})
                </TabsTrigger>
                <TabsTrigger value="list">
                  列表
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="active"
                className="flex-1 overflow-y-auto mt-0 px-2 py-2"
              >
                {activePeople.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      setSelectedPersonId(person.id);
                      setIsEditing(false);
                      setIsAdminEditing(false);
                      setEditData({});
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm mb-1 flex items-center gap-2 transition-colors",
                      selectedPersonId === person.id
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    )}
                  >
                    <User size={14} style={{ color: person.color }} />
                    {person.name}
                  </button>
                ))}
              </TabsContent>

              <TabsContent
                value="archived"
                className="flex-1 overflow-y-auto mt-0 px-2 py-2"
              >
                {archivedPeople.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      setSelectedPersonId(person.id);
                      setIsEditing(false);
                      setIsAdminEditing(false);
                      setEditData({});
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm mb-1 flex items-center gap-2 transition-colors",
                      selectedPersonId === person.id
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    )}
                  >
                    <User size={14} style={{ color: person.color }} />
                    {person.name}
                  </button>
                ))}
              </TabsContent>

              <TabsContent
                value="list"
                className="flex-1 overflow-y-auto mt-0 px-2 py-2"
              >
                {renderStudentListTable()}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: Profile detail */}
          <div className="flex-1 overflow-y-auto p-6">
            {selectedPerson ? (
              <div className="space-y-6">
                {/* Header with edit buttons */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                      {selectedPerson.name}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {selectedPerson.status === "archived" ? "已毕业" : "在读"}
                      {" · "}
                      {selectedPerson.role === "admin" ? "管理员" : "成员"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEdit}
                        >
                          <X className="w-4 h-4 mr-1" />
                          取消
                        </Button>
                        <Button size="sm" onClick={saveProfile}>
                          <Save className="w-4 h-4 mr-1" />
                          保存
                        </Button>
                      </>
                    ) : (
                      canEditProfile && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={startEdit}
                        >
                          <Pencil className="w-4 h-4 mr-1" />
                          编辑
                        </Button>
                      )
                    )}
                  </div>
                </div>

                {/* Static + Dynamic fields in a single card */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1 border-l-2 border-blue-400 pl-2">
                    基本信息
                  </h4>
                  {renderStaticFields()}

                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-4 mb-3 flex items-center gap-1 border-l-2 border-blue-400 pl-2">
                    动态字段
                  </h4>
                  {renderDynamicFields()}
                </div>

                {/* Add new field */}
                {isAdmin && isEditing && (
                  <div className="border border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1">
                      <Plus className="w-4 h-4" />
                      添加新字段
                    </h4>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                          字段名称
                        </label>
                        <Input
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          placeholder="输入字段名称..."
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                          类型
                        </label>
                        <Select
                          value={newFieldType}
                          onValueChange={(val: "text" | "select") =>
                            setNewFieldType(val)
                          }
                        >
                          <SelectTrigger className="h-8 text-sm w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">文本</SelectItem>
                            <SelectItem value="select">选择</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {newFieldType === "select" && (
                        <div className="flex-[2]">
                          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
                            选项（用逗号分隔）
                          </label>
                          <Input
                            value={newFieldOptions}
                            onChange={(e) => setNewFieldOptions(e.target.value)}
                            placeholder="选项1,选项2,选项3..."
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                      <Button size="sm" onClick={handleAddField}>
                        添加
                      </Button>
                    </div>
                  </div>
                )}

                {/* Remove field button (admin only) */}
                {isAdmin && isEditing && dynamicFieldDefs.length > 0 && (
                  <div className="border border-dashed border-red-200 dark:border-red-800 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-3 flex items-center gap-1">
                      <Trash2 className="w-4 h-4" />
                      删除字段
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {dynamicFieldDefs.map((field) => (
                        <Button
                          key={field.key}
                          size="sm"
                          variant="outline"
                          className="text-red-500 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                          onClick={() => handleRemoveField(field.key)}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          {field.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin-only panel */}
                {isAdmin && (
                  <div
                    className={cn(
                      "border rounded-lg p-4",
                      "bg-amber-50/50 dark:bg-amber-950/20",
                      "border-amber-200 dark:border-amber-800"
                    )}
                  >
                    {/* Admin panel header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                          杨老师备注
                        </h4>
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-700 text-xs"
                        >
                          仅管理员可见
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        {isAdminEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelAdminEdit}
                            >
                              <X className="w-4 h-4 mr-1" />
                              取消
                            </Button>
                            <Button size="sm" onClick={saveAdminEdit}>
                              <Save className="w-4 h-4 mr-1" />
                              保存
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={startAdminEdit}
                          >
                            <Pencil className="w-4 h-4 mr-1" />
                            编辑
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Section A: Selectable fields */}
                    {selectableFields.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center border-l-2 border-amber-400 pl-2">
                          选择项
                        </h5>
                        <div>
                          {selectableFields.map((field) =>
                            renderAdminField(field)
                          )}
                        </div>
                      </div>
                    )}

                    {/* Section B: Fillable fields */}
                    {fillableFields.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center border-l-2 border-emerald-400 pl-2">
                          可填项
                        </h5>
                        <div>
                          {fillableFields.map((field) =>
                            renderAdminField(field)
                          )}
                        </div>
                      </div>
                    )}

                    {/* Section C: Free-form note */}
                    <div>
                      <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center border-l-2 border-purple-400 pl-2">
                        文字备注
                      </h5>
                      {isAdminEditing ? (
                        <Textarea
                          value={adminEditNote}
                          onChange={(e) => setAdminEditNote(e.target.value)}
                          placeholder="输入任意备注信息..."
                          className="min-h-[120px] text-sm"
                        />
                      ) : (
                        <div className="min-h-[80px] p-3 bg-white/60 dark:bg-slate-900/40 rounded-md border border-amber-100 dark:border-amber-900/30">
                          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                            {adminNote || (
                              <span className="text-slate-400 dark:text-slate-500">
                                暂无备注...
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                <GraduationCap className="w-12 h-12 mb-3 opacity-40" />
                <p className="text-sm">请从左侧选择一个学生查看档案</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
