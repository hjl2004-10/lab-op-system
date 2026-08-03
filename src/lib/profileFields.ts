import type { ProfileFieldDef } from "@/types";

// 受保护字段：不可删除（学号对应登录账号体系，姓名是学生基本标识）
export const PROTECTED_PROFILE_FIELD_KEYS: ReadonlySet<string> = new Set([
  "studentId", // 学号
]);

export function isProtectedFieldKey(key: string): boolean {
  return PROTECTED_PROFILE_FIELD_KEYS.has(key);
}

/**
 * 显示排序：受保护字段（学号）始终置顶，其余保持原有顺序。
 * 用于表格/卡片等展示层，保证学号永远排在普通字段之前。
 */
export function sortFieldsForDisplay(defs: ProfileFieldDef[]): ProfileFieldDef[] {
  return [
    ...defs.filter((field) => isProtectedFieldKey(field.key)),
    ...defs.filter((field) => !isProtectedFieldKey(field.key)),
  ];
}

// 选项色板（16 色）。索引 0=蓝、1=粉，保证默认性别选项 ["男","女"] 中
// "男"恒蓝、"女"恒粉（颜色由 options 顺序 + 色板索引共同决定，勿调性别选项顺序）。
export const FIELD_OPTION_PALETTE = [
  "#3B82F6", // 0 蓝（男）
  "#EC4899", // 1 粉（女）
  "#22C55E",
  "#F59E0B",
  "#8B5CF6",
  "#14B8A6",
  "#EF4444",
  "#F97316",
  "#06B6D4",
  "#84CC16",
  "#A855F7",
  "#0EA5E9",
  "#F43F5E",
  "#10B981",
  "#EAB308",
  "#6366F1",
];

/**
 * 取 select 字段某个选项的颜色；非 select / 选项不在列表 / 空值返回 undefined。
 * 用于表格与公开档案的"同值同色"：同一选项恒同色。
 */
export function getValueColor(
  field: ProfileFieldDef | undefined,
  value: string
): string | undefined {
  if (!field || field.type !== "select" || !field.options?.length || !value) {
    return undefined;
  }
  const idx = field.options.indexOf(value);
  return idx >= 0 ? FIELD_OPTION_PALETTE[idx % FIELD_OPTION_PALETTE.length] : undefined;
}
