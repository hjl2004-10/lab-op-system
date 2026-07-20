import { format, parseISO, isValid } from "date-fns";
import type { Person, Task, StudentProfile, SyncDataV3, ProgressRecord } from "./types";

// ============================================================
// Date formatting
// ============================================================

/**
 * Format a date string or Date to localized display like "6月14日"
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return String(date);
  return format(d, "M月d日");
}

/**
 * Format a date range like "6月14日 - 7月9日"
 */
export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

// ============================================================
// Sync code encode / decode (v3 with compression)
// ============================================================

/**
 * Simple base64 encoding for sync data (v2 format, PDF spec compatible)
 */
export function encodeSyncData(data: SyncDataV3): string {
  const jsonStr = JSON.stringify(data);
  return btoa(encodeURIComponent(jsonStr));
}

/**
 * Decode a sync code string to SyncDataV3.
 * Supports v2 (simple base64, PDF spec) and v3 (legacy compressed) formats.
 */
export function decodeSyncData(code: string): SyncDataV3 | null {
  // Remove all whitespace
  const cleanCode = code.replace(/\s/g, "");
  // Auto-fix missing base64 padding
  let padded = cleanCode;
  while (padded.length % 4 !== 0) {
    padded += "=";
  }
  try {
    // Try simple base64 first (v2 PDF spec)
    const jsonStr = decodeURIComponent(atob(padded));
    const data = JSON.parse(jsonStr);
    if (data.v === 3) return data as SyncDataV3;
    if (data.v === 2) {
      return {
        v: 3,
        fromRole: data.fromRole,
        fromPersonId: data.fromPersonId,
        timestamp: Date.now(),
        people: data.people || [],
        tasks: (data.tasks || []).map((t: Task) => ({
          ...t,
          progressHistory: (t.progressHistory || []).map((ph: ProgressRecord) => ({
            ...ph,
            authorId: ph.authorId || data.fromPersonId,
            replies: ph.replies || [],
          })),
          archivedAt: t.archivedAt || (t.progress >= 100 ? new Date().toISOString().split("T")[0] : undefined),
        })),
        studentProfiles: data.studentProfiles || [],
      };
    }
    return null;
  } catch {
    // Try legacy compressed format (v3)
    try {
      const decoded = decodeURIComponent(atob(padded));
      const data = JSON.parse(decoded);
      if (data.v === 3) return data as SyncDataV3;
      return null;
    } catch {
      return null;
    }
  }
}

// ============================================================
// Export sync data for a member
// ============================================================

/**
 * Export data for a member — only their own person record + tasks + profile
 */
export function exportMemberData(
  personId: string,
  people: Person[],
  tasks: Task[],
  profiles?: StudentProfile[]
): SyncDataV3 {
  const person = people.find((p) => p.id === personId);
  const memberPeople = person ? [person] : [];
  const memberTasks = tasks.filter((t) => t.assigneeId === personId);
  const memberProfiles = profiles
    ? profiles.filter((sp) => sp.personId === personId)
    : [];

  return {
    v: 3,
    fromRole: "member",
    fromPersonId: personId,
    timestamp: Date.now(),
    people: memberPeople,
    tasks: memberTasks,
    studentProfiles: memberProfiles,
  };
}

// ============================================================
// Export sync data for an admin
// ============================================================

/**
 * Export data for an admin.
 * If targetPersonId is "all", export everything.
 * Otherwise export only data for the specified person.
 */
export function exportAdminData(
  targetPersonId: string | "all",
  people: Person[],
  tasks: Task[],
  profiles?: StudentProfile[]
): SyncDataV3 {
  const adminPerson = people.find((p) => p.role === "admin");
  const fromPersonId = adminPerson?.id ?? "p1";

  if (targetPersonId === "all") {
    return {
      v: 3,
      fromRole: "admin",
      fromPersonId,
      timestamp: Date.now(),
      people: [...people],
      tasks: [...tasks],
      studentProfiles: profiles ? [...profiles] : [],
    };
  }

  // Export for a specific student
  const targetPerson = people.find((p) => p.id === targetPersonId);
  const targetPeople = targetPerson ? [targetPerson] : [];
  const targetTasks = tasks.filter((t) => t.assigneeId === targetPersonId);
  const targetProfiles = profiles
    ? profiles.filter((sp) => sp.personId === targetPersonId)
    : [];

  return {
    v: 3,
    fromRole: "admin",
    fromPersonId,
    timestamp: Date.now(),
    people: targetPeople,
    tasks: targetTasks,
    studentProfiles: targetProfiles,
  };
}

// ============================================================
// Import sync data — merge strategy (v3)
// ============================================================

/**
 * Import sync data with merge strategy.
 * Admin imports only affect the sender's data.
 * Member imports only affect their own data.
 */
export function importSyncData(
  code: string,
  currentPeople: Person[],
  currentTasks: Task[],
  currentProfiles: StudentProfile[] = [],
  _currentUserId?: string | null
): { people: Person[]; tasks: Task[]; profiles: StudentProfile[] } {
  const syncData = decodeSyncData(code);
  if (!syncData) {
    return { people: currentPeople, tasks: currentTasks, profiles: currentProfiles };
  }

  // For incremental sync: only merge changed tasks
  const incomingTasks = syncData.tasks ?? [];
  const incomingPeople = syncData.people ?? [];
  const incomingProfiles = syncData.studentProfiles ?? [];

  // Merge people: update/add only relevant people
  let mergedPeople = [...currentPeople];
  for (const incoming of incomingPeople) {
    const idx = mergedPeople.findIndex(p => p.id === incoming.id);
    if (idx >= 0) {
      mergedPeople[idx] = { ...mergedPeople[idx], ...incoming };
    } else {
      mergedPeople.push(incoming);
    }
  }

  // Merge tasks with incremental logic
  let mergedTasks = [...currentTasks];
  for (const incoming of incomingTasks) {
    const idx = mergedTasks.findIndex(t => t.id === incoming.id);
    if (idx >= 0) {
      // Merge progress history (keep both, deduplicate by id)
      const existingHistory = mergedTasks[idx].progressHistory;
      const incomingHistory = incoming.progressHistory || [];
      const historyMap = new Map<string, ProgressRecord>();
      for (const h of existingHistory) historyMap.set(h.id, h);
      for (const h of incomingHistory) {
        const existing = historyMap.get(h.id);
        if (existing) {
          // Merge replies
          const existingReplies = existing.replies || [];
          const incomingReplies = h.replies || [];
          const replyMap = new Map(existingReplies.map(r => [r.id, r]));
          for (const ir of incomingReplies) {
            if (!replyMap.has(ir.id)) replyMap.set(ir.id, ir);
          }
          historyMap.set(h.id, { ...h, replies: Array.from(replyMap.values()) });
        } else {
          historyMap.set(h.id, { ...h, replies: h.replies || [] });
        }
      }

      mergedTasks[idx] = {
        ...mergedTasks[idx],
        ...incoming,
        progressHistory: Array.from(historyMap.values()),
      };
    } else {
      mergedTasks.push({
        ...incoming,
        progressHistory: (incoming.progressHistory || []).map(h => ({
          ...h,
          replies: h.replies || [],
        })),
      });
    }
  }

  // Merge profiles
  let mergedProfiles: StudentProfile[] = currentProfiles.length > 0
    ? currentProfiles.map(p => ({ ...p }))
    : mergedPeople.filter(p => p.role === "member").map(p => ({
        personId: p.id,
        personName: p.name,
        data: {},
        adminOnlyData: { fields: [], values: {}, note: "" },
      }));

  for (const incoming of incomingProfiles) {
    const idx = mergedProfiles.findIndex(p => p.personId === incoming.personId);
    if (idx >= 0) {
      mergedProfiles[idx] = {
        ...mergedProfiles[idx],
        ...incoming,
        data: { ...mergedProfiles[idx].data, ...incoming.data },
        adminOnlyData: {
          fields: incoming.adminOnlyData?.fields || mergedProfiles[idx].adminOnlyData?.fields || [],
          values: { ...mergedProfiles[idx].adminOnlyData?.values, ...incoming.adminOnlyData?.values },
          note: incoming.adminOnlyData?.note || mergedProfiles[idx].adminOnlyData?.note || "",
        },
      };
    } else {
      mergedProfiles.push({
        ...incoming,
        adminOnlyData: incoming.adminOnlyData || { fields: [], values: {}, note: "" },
      });
    }
  }

  return { people: mergedPeople, tasks: mergedTasks, profiles: mergedProfiles };
}

// ============================================================
// Statistics
// ============================================================

export interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
  overallProgress: number;
  totalStars: number;
  ratedCount: number;
  avgStars: string;
}

/**
 * Calculate all statistics from tasks array
 */
export function getStats(tasks: Task[]): TaskStats {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.progress >= 100).length;
  const inProgress = tasks.filter((t) => t.progress > 0 && t.progress < 100).length;
  const overallProgress =
    total > 0 ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / total) : 0;
  const totalStars = tasks
    .filter((t) => t.rating > 0)
    .reduce((sum, t) => sum + t.rating, 0);
  const ratedCount = tasks.filter((t) => t.rating > 0).length;
  const avgStars = ratedCount > 0 ? (totalStars / ratedCount).toFixed(1) : "0";

  return { total, completed, inProgress, overallProgress, totalStars, ratedCount, avgStars };
}

// ============================================================
// Simple password hashing (for localStorage only)
// ============================================================

/**
 * Simple hash function for passwords stored in localStorage.
 * NOT cryptographically secure — only for basic UI gating.
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return String(hash);
}

/**
 * Store password hash in localStorage for a person
 */
export function storePasswordHash(personId: string, password: string): void {
  localStorage.setItem(`gantt-pwd-${personId}`, simpleHash(password));
}

/**
 * Check if a password matches the stored hash.
 * Priority: 1) Person.passwordHash (syncable across devices)
 *           2) localStorage fallback (backward compatible)
 */
export function verifyPassword(
  personId: string,
  password: string,
  people?: Person[]
): boolean {
  const person = people?.find((p) => p.id === personId);
  // Priority 1: Check Person.passwordHash (syncable)
  if (person?.passwordHash) {
    return person.passwordHash === simpleHash(password);
  }
  // Priority 2: Fallback to localStorage (backward compatible)
  const stored = localStorage.getItem(`gantt-pwd-${personId}`);
  if (stored === null) return false; // No password set = cannot login
  return stored === simpleHash(password);
}

/**
 * Check if a person has a password set.
 * Priority: 1) Person.passwordHash (syncable across devices)
 *           2) localStorage fallback (backward compatible)
 */
export function hasPasswordSet(personId: string, people?: Person[]): boolean {
  const person = people?.find((p) => p.id === personId);
  if (person?.passwordHash) return true;
  return localStorage.getItem(`gantt-pwd-${personId}`) !== null;
}

/**
 * Remove a person's password from localStorage only.
 * Note: To fully clear password, also update person.passwordHash via updatePerson.
 */
export function removePassword(personId: string): void {
  localStorage.removeItem(`gantt-pwd-${personId}`);
}
