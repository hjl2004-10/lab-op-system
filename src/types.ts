export type Role = "admin" | "teacher" | "student";

export interface Person {
  id: string;
  username?: string;
  name: string;
  color: string;
  lightColor: string;
  borderColor: string;
  textColor: string;
  role: Role;
  order?: number;
  status?: "active" | "archived";
  /** 学生所属班级（可多班级或空） */
  classIds?: string[];
  /** 创建者 personId（老师"仅自己创建"可管理的依据） */
  createdBy?: string;
}

/** 班级实体（teacherId = 创建老师） */
export interface Class {
  id: string;
  name: string;
  teacherId: string;
}

// Reply to a progress record (teacher can reply to student updates)
export interface ProgressReply {
  id: string;
  date: string;
  author: string;      // "杨老师" or student name
  authorId: string;    // person id
  content: string;
  attachments?: AttachmentMeta[];
}

/** 附件元数据：文件本体存服务端 data/attachments/，仅此元数据随 state 持久化 */
export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface ProgressRecord {
  id: string;
  date: string;
  author: string;
  authorId: string;
  currentProgress: string;
  mainProblems: string;
  solutions: string;
  replies: ProgressReply[];  // NEW: teacher/student can reply
  attachments?: AttachmentMeta[];
}

export interface Task {
  id: string;
  name: string;
  assigneeId: string;
  startDate: string;
  endDate: string;
  progress: number;
  description: string;
  detail: {
    currentProgress: string;
    mainProblems: string;
    solutions: string;
  };
  rating: number;
  order: number;
  isMilestone: boolean;
  /** 仅自己可见：学生私有任务，教师端不可见（服务端过滤） */
  isPrivate?: boolean;
  progressHistory: ProgressRecord[];
  archivedAt?: string;  // NEW: auto-archive timestamp when progress reaches 100
}

// Student profile field with type and options
export interface ProfileFieldDef {
  key: string;
  label: string;
  type: "select" | "text" | "number";
  options?: string[];
  category: "selectable" | "fillable";  // selectable = choice fields, fillable = text/number fields
}

export interface StudentProfile {
  personId: string;
  personName: string;
  data: Record<string, string>;
  // Admin-only panel data (only visible to teacher)
  adminOnlyData: {
    fields: ProfileFieldDef[];   // Field definitions with order
    values: Record<string, string>;
    note: string;                // Free-form text at bottom
  };
}

export interface AppState {
  people: Person[];
  tasks: Task[];
  currentUserId: string | null;
  darkMode: boolean;
  studentProfiles?: StudentProfile[];
  profileFieldDefs?: ProfileFieldDef[];
  classes?: Class[];
}

export interface FilterState {
  statusFilter: "all" | "active" | "completed";
  viewMode: "day" | "week" | "month";
  keyword: string;
  statsView?: "cards" | "charts";
}

// Incremental sync data format (v3 with compression)
export interface SyncDataV3 {
  v: 3;
  fromRole: Role;
  fromPersonId: string;
  timestamp: number;
  people: Person[];
  tasks: Task[];
  studentProfiles?: StudentProfile[];
  // For incremental sync: only changed items since lastTimestamp
  lastTimestamp?: number;
  changedTaskIds?: string[];
  changedProfileIds?: string[];
}

// Legacy v2 format for backward compatibility
export interface SyncDataV2 {
  v: 2;
  fromRole: Role;
  fromPersonId: string;
  people: Person[];
  tasks: Task[];
  studentProfiles?: StudentProfile[];
}
