/**
 * 用户写作偏好档案 v2.8 —— style-profile.md 读写 + 风格指令生成
 *
 * 定位：经验库（experience.md）记录【系统】怎么跑得更好；
 *      偏好档案（style-profile.md）记录【用户】要什么——风格、受众、禁用表达。
 *
 * 生命周期：
 * - 任务配置收集时：编排器读取档案 → 已设字段作为默认值带出，用户确认或临时覆盖
 * - 用户说"这次……"→ 仅当次生效，不写档案
 * - 用户说"以后都……"→ 编排器更新档案对应字段
 * - Writing / Polish 环节：buildStyleDirective() 生成指令段注入子 Agent prompt
 *   （Polish 特别遵循"禁用表达"清单）
 */

import { readFileSync, existsSync } from "fs";

export const STYLE_PROFILE_PATH =
  "<skillsDir>\\multi-agent-writer\\style-profile.md";

// ======================== 读取 ========================

export function loadStyleProfile(): string {
  if (!existsSync(STYLE_PROFILE_PATH)) return "";
  return readFileSync(STYLE_PROFILE_PATH, "utf-8");
}

/** 档案中是否至少有一个已设置字段 */
export function hasStylePreferences(): boolean {
  return extractProfileLines().length > 0;
}

/** 提取「## 档案内容」区块中已设置的字段行（过滤注释行与未设置项） */
function extractProfileLines(): string[] {
  const raw = loadStyleProfile();
  if (!raw) return [];

  // 字符串定位区块（避免 lookahead 正则的空匹配坑，v2.5 同款经验）
  const marker = "## 档案内容";
  const idx = raw.indexOf(marker);
  if (idx < 0) return [];
  const rest = raw.slice(idx + marker.length);
  const nextH2 = rest.indexOf("\n## ");
  const block = (nextH2 >= 0 ? rest.slice(0, nextH2) : rest).trim();
  if (!block) return [];

  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) =>
      l.startsWith("- ") &&
      !l.startsWith("- <!--") &&
      !l.includes("未设置"),
    )
    .map((l) => {
      const value = l.slice(2).replace(/^[\w\u4e00-\u9fa5]+[：:]\s*/, "");
      return value.length > 0 ? l : null;
    })
    .filter((l): l is string => l !== null);
}

// ======================== 注入：生成风格指令段 ========================

/**
 * 生成"用户风格要求"指令段，注入 Writer / ChapterWriter / Revise / Polish 的任务 prompt。
 * - 档案无已设置字段时返回空串（不注入，走通用默认）
 * - 当次覆盖项（如"这次口语化一点"）由编排器作为 overrides 拼接在末尾，优先级最高
 */
export function buildStyleDirective(overrides?: string): string {
  if (!hasStylePreferences() && !overrides) return "";

  const parts: string[] = [];
  const lines = extractProfileLines();
  if (lines.length) parts.push(lines.join("\n"));
  if (overrides) parts.push(`【当次覆盖，优先级最高】${overrides}`);

  if (!parts.length) return "";
  return `## 用户风格要求（长期偏好档案，写作/润色时必须遵循）\n\n${parts.join("\n\n")}`;
}
