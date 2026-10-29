/**
 * 技能体系 v2.4 —— 动态发现 + Agent 自主调用
 *
 * 核心变化（vs v2.3）：
 * - v2.3: 静态 SKILL_REGISTRY，Agent 只能调用注册过的技能
 * - v2.4: 注册表只是常用项缓存；Agent 可运行时扫描全部已安装技能，
 *         读取任何 SKILL.md 了解能力，自主决定是否调用
 *
 * 发现机制：
 * 1. 扫描技能安装目录（SKILLs/ 和内置 resources/cfmind/skills/）
 * 2. 读取每个 SKILL.md 的 frontmatter（name + description）
 * 3. Agent 结合任务判断需要哪个，读全文按指引执行
 *
 * 这样新技能装好后无需改任何代码——
 * Agent 下次运行时扫描自动发现，自主决策是否使用。
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { getSkillsDirs } from "../platform/index.js";

// ======================== 技能目录（发现源）========================

/** 用户/自定义技能目录（约 70 个，持续增长）。v3.0：manifest 优先，无 manifest 用此默认（向后兼容） */
export const DEFAULT_USER_SKILLS_DIR = "<skillsDir>";

/** 内置技能目录。同上，manifest 优先 */
export const DEFAULT_BUILTIN_SKILLS_DIR =
  "<builtinSkillsDir>";

/** v3.0：实际生效的目录（manifest 驱动，部署到任何平台自动适配） */
export const USER_SKILLS_DIR = getSkillsDirs([DEFAULT_USER_SKILLS_DIR])[0];
export const BUILTIN_SKILLS_DIR =
  getSkillsDirs([DEFAULT_USER_SKILLS_DIR, DEFAULT_BUILTIN_SKILLS_DIR])[1] ?? DEFAULT_BUILTIN_SKILLS_DIR;

// ======================== 动态发现 ========================

export interface DiscoveredSkill {
  id: string;            // 目录名 / 技能名
  skillPath: string;     // SKILL.md 完整路径
  description: string;  // frontmatter 的 description（能力摘要）
  source: "user" | "builtin";
}

/**
 * 解析 SKILL.md 的 frontmatter，提取 name 和 description
 */
function parseSkillFrontmatter(skillMdPath: string): { name?: string; description?: string } {
  try {
    const content = readFileSync(skillMdPath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return {};

    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    // description 可能是多行（| 块）
    let description = "";
    const descMatch = fm.match(/^description:\s*(.*)$/m);
    if (descMatch) {
      if (descMatch[1].trim() === "|" || descMatch[1].trim() === ">") {
        // 多行 YAML：读取到下一个非缩进行
        const lines = fm.split("\n");
        const startIdx = lines.findIndex((l) => l.startsWith("description:"));
        const descLines: string[] = [];
        for (let i = startIdx + 1; i < lines.length; i++) {
          const l = lines[i];
          if (/^\S/.test(l) || l.trim() === "---") break;
          descLines.push(l.trim());
        }
        description = descLines.join(" ");
      } else {
        description = descMatch[1].trim();
      }
    }

    return {
      name: nameMatch?.[1]?.trim(),
      description: description.replace(/\s+/g, " ").slice(0, 200),
    };
  } catch {
    return {};
  }
}

/**
 * 扫描目录发现全部已安装技能
 * 这就是 Agent 的"技能雷达"——每次运行时调用，自动感知新装技能
 */
export function discoverSkills(): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = [];

  const scan = (dir: string, source: "user" | "builtin") => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillMd)) continue;

      const fm = parseSkillFrontmatter(skillMd);
      found.push({
        id: fm.name || entry.name,
        skillPath: skillMd,
        description: fm.description || "（读取 SKILL.md 了解详情）",
        source,
      });
    }
  };

  scan(USER_SKILLS_DIR, "user");
  scan(BUILTIN_SKILLS_DIR, "builtin");

  return found;
}

// ======================== 常用技能缓存（写作流程高频项）========================

/**
 * 写作流程的常用技能标注（仅提示性；通用技能名，内部部署可自行扩充）。
 * 注意：这只是"哪些技能跟写作流程相关"的提示，
 * Agent 可以（且应该）调用 discoverSkills() 看全量清单自主决策。
 */
export const WRITING_RELEVANT_SKILLS: Record<string, string[]> = {
  research: ["web-search"],
  analysis: ["data-analysis"],
  writing: ["diagram-maker"],
  polish: ["humanizer-zh"],
  review: [],
  output: ["markdown-converter", "docx", "pdf"],
  publish: [],
};

// ======================== Agent 自主技能指令（嵌入每个子 Agent）========================

/**
 * 生成"技能自主使用"指令，嵌入子 Agent 的任务 prompt
 *
 * 这段指令赋予每个子 Agent 完整的技能自主权：
 * - 知道技能目录在哪
 * - 可以扫描发现所有已安装技能
 * - 可以读取任何 SKILL.md 了解能力
 * - 任务需要时自主调用（按该技能的指引）
 *
 * 效果：即使编排器没想到的技能，子 Agent 也能自己发现并使用。
 * 例如 Reviewer 审核时发现文中有图表数据要验证，
 * 可以自主发现并调用 data-analysis 技能来核对。
 */
export function buildSkillAutonomyDirective(): string {
  return `## 技能自主使用权

你可以自主发现和使用已安装的技能：

1. 技能目录：
   - ${USER_SKILLS_DIR}
   - ${BUILTIN_SKILLS_DIR}

2. 使用方法：
   - 用 exec 列出目录内容，发现有哪些技能
   - 用 read 读取任何技能的 SKILL.md，了解其能力
   - 当任务需要时，按该技能 SKILL.md 的指引调用它
   - 技能可能是 prompt 指南型（按规则执行）、script 型（运行其脚本）或 tool 型（按其调用方式）

3. 决策原则：
   - 如果某个技能能提升你当前任务的质量或效率，就用它
   - 不需要等待编排器指示——你对自己的任务最了解
   - 用了什么技能、为什么用，在输出中简要说明`;
}

// ======================== 查询辅助 ========================

/** 查某个技能是否已安装 */
export function isSkillInstalled(skillId: string): boolean {
  return discoverSkills().some((s) => s.id === skillId);
}

/** 获取某技能的 SKILL.md 路径 */
export function getSkillPath(skillId: string): string | undefined {
  return discoverSkills().find((s) => s.id === skillId)?.skillPath;
}

/** 打印当前全部可用技能（调试/决策参考） */
export function listSkillsCompact(): string {
  const skills = discoverSkills();
  return skills
    .map((s) => `- ${s.id} [${s.source}]: ${s.description}`)
    .join("\n");
}
