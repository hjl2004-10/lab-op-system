export interface Person {
  id: string;
  name: string;
  color: string;
  lightColor: string;
  borderColor: string;
  textColor: string;
  role: "admin" | "member";
  order?: number;
  status?: "active" | "archived";
  passwordHash?: string; // Password stored in person record for cross-device sync
}

// Reply to a progress record (teacher can reply to student updates)
export interface ProgressReply {
  id: string;
  date: string;
  author: string;      // "杨老师" or student name
  authorId: string;    // person id
  content: string;
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
}

export interface FilterState {
  assigneeFilter: "all" | string;
  statusFilter: "all" | "active" | "completed";
  viewMode: "day" | "week" | "month";
  keyword: string;
  statsView?: "cards" | "charts";
}

// Incremental sync data format (v3 with compression)
export interface SyncDataV3 {
  v: 3;
  fromRole: "admin" | "member";
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
  fromRole: "admin" | "member";
  fromPersonId: string;
  people: Person[];
  tasks: Task[];
  studentProfiles?: StudentProfile[];
}
