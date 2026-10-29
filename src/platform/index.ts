/**
 * 平台清单（Platform Manifest）v3.0 —— 跨平台适配层
 *
 * 核心原则：manifest 只存「怎么找」，不存「有什么」。
 * - skillsDirs / modelDiscovery.method = 发现方法（稳定）
 * - models[] = 部署时快照，仅作探测失败时的兜底（易变，运行时优先探测刷新）
 * - 技能清单永远运行时扫描（v2.4 discoverSkills），模型清单每次任务开始按 method 探测
 *
 * 运行时模型候选策略（三层兜底）：
 * 1. 探测：按 modelDiscovery.method 尝试获取当前可用模型（session_status / 平台列表工具 / 问用户）
 * 2. 快照：探测失败 → 用 manifest.models 部署时快照
 * 3. 保底：都没有 → 仅用编排器默认模型（spawn 不指定 model）
 *
 * 无 platform.json 时（向后兼容）：所有函数返回空/false，
 * 编排器回落到 SKILL.md 的静态说明与默认路径——本平台现状不受影响。
 */

import { readFileSync, existsSync } from "fs";

/** manifest 与 SKILL.md 同目录（跟着技能走，部署时生成） */
export const PLATFORM_PATH =
  "<skillsDir>\\multi-agent-writer\\platform.json";

export interface ModelInfo {
  id: string;                        // 平台实际可用的模型标识（spawn 时用）
  tier: "flagship" | "fast" | "standard";
  modalities: string[];               // ["text"] 或 ["text", "image"]
  outputLimitTokens?: number | null;  // 输出上限（kimi 类小上限模型标注）
  note?: string;                      // 语义标注（如"中文写作见长"）
}

export interface PlatformManifest {
  platform: string;                   // 平台名
  skillsDirs: string[];                // 技能目录（扫描发现用）
  spawnMethod: "subagent" | "serial-roleplay" | "unknown";
  environment: {
    os: string;                       // windows / linux / macos
    encoding?: "utf8" | "gbk";        // GBK 终端适用性（Windows 坑开关）
    python3?: boolean;                // web-search 脚本依赖
    git?: boolean;                    // 技能安装依赖
  };
  modelDiscovery: {
    method: "runtime-tool" | "manual" | "none";
    note?: string;                    // 如"用 session_status 查询"或"请用户提供模型清单"
  };
  models: ModelInfo[];                // 部署时快照（探测失败的兜底）
  dependencies: {
    humanizerZh: { required: boolean; installed: boolean; install: string };
    webSearch: { required: boolean; fallback: string };  // 缺失时的降级说明
  };
  createdAt: string;
  updatedAt: string;
}

// ======================== 读取 ========================

export function loadPlatform(): PlatformManifest | null {
  if (!existsSync(PLATFORM_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PLATFORM_PATH, "utf-8")) as PlatformManifest;
  } catch {
    return null;
  }
}

// ======================== 技能目录 ========================

/** 获取技能扫描目录：manifest 优先，无 manifest 时用默认（向后兼容） */
export function getSkillsDirs(defaults: string[]): string[] {
  const m = loadPlatform();
  return m?.skillsDirs?.length ? m.skillsDirs : defaults;
}

// ======================== 模型候选（三层兜底）========================

export interface ModelCandidate extends ModelInfo {
  source: "probed" | "snapshot" | "none";  // 本清单来自哪层
  fresh: boolean;                          // 本次任务是否探测刷新过
}

/**
 * 获取当前任务可用模型候选。
 * @param probed 本次任务开始时探测到的模型清单（编排器用平台方式获取后传入；
 *               null=探测失败，走快照兜底）
 */
export function getModelCandidates(probed: ModelInfo[] | null): ModelCandidate[] {
  if (probed?.length) {
    return probed.map((m) => ({ ...m, source: "probed", fresh: true }));
  }
  const m = loadPlatform();
  if (m?.models?.length) {
    return m.models.map((x) => ({ ...x, source: "snapshot", fresh: false }));
  }
  return [];
}

/** 硬约束过滤（能力约束，与平台无关）：读图→需 image 模态；长输出→排除小输出上限 */
export function filterByConstraints(
  candidates: ModelCandidate[],
  needs: { image?: boolean; outputTokens?: number },
): ModelCandidate[] {
  return candidates.filter((c) => {
    if (needs.image && !c.modalities?.includes("image")) return false;
    if (needs.outputTokens && c.outputLimitTokens && c.outputLimitTokens < needs.outputTokens) return false;
    return true;
  });
}

// ======================== 失效容错 ========================

/**
 * spawn 失败后的重选：剔除失效模型，返回剩余候选；
 * 全部失效 → 返回空数组（编排器降级为直写）。
 * 失败表现（超时/不可用）由编排器记入经验库 M 条目，下次探测/快照参考。
 */
export function excludeFailed(candidates: ModelCandidate[], failedId: string): ModelCandidate[] {
  return candidates.filter((c) => c.id !== failedId);
}

// ======================== 环境开关 ========================

/** GBK 终端坑是否适用于当前平台（Windows 且 manifest 标注 gbk） */
export function gbkQuirkApplies(): boolean {
  const m = loadPlatform();
  if (!m) return true; // 无 manifest 默认按最保守处理（本平台已知适用）
  return m.environment.os === "windows" && (m.environment.encoding ?? "utf8") === "gbk";
}

/** spawn 方式：subagent=并行子会话；serial-roleplay=单会话串行扮演（降级模式） */
export function getSpawnMethod(): PlatformManifest["spawnMethod"] {
  return loadPlatform()?.spawnMethod ?? "subagent";
}
