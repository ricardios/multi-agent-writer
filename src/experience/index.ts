/**
 * 经验库 v2.5 —— 运行数据沉淀 + 自我改进闭环
 *
 * 作用：
 * - 任务开始前（Research spawn 前）：编排器读取经验库，
 *   把"经验条目区"注入模型选择决策和子 Agent 任务 prompt
 * - 任务结束后（Output 环节）：编排器追加运行记录 + 本次新学到的教训
 * - 积累后：模型选择从"静态参考"变为"数据驱动"
 *
 * 经验库文件：SKILLs/multi-agent-writer/experience.md
 * 与 SKILL.md 同目录（技能私有持久数据，技能升级不丢失）。
 *
 * 体积控制（防失控，技能包限 100MB/500 文件）：
 * - 运行日志表只保留最近 20 条
 * - 经验库总大小超过 30KB 时，编排器整理：
 *   运行日志聚合为「模型×环节×成败」统计摘要，经验条目全部保留
 */

import { readFileSync, existsSync, appendFileSync, statSync, writeFileSync } from "fs";

export const EXPERIENCE_PATH =
  "<skillsDir>\\multi-agent-writer\\experience.md";

/** 超过此字节数需要整理（聚合日志、保留条目） */
export const EXPERIENCE_MAX_BYTES = 30 * 1024;

/** 运行日志表最多保留条数 */
export const RUN_LOG_KEEP = 20;

// ======================== 契约 ========================

export interface RunRecord {
  date: string;            // YYYY-MM-DD
  topic: string;
  stages: Array<{
    stage: "research" | "analysis" | "writing" | "polish" | "review" | "output";
    model: string;         // 实际使用的模型（含"编排器直写"降级）
    durationSec?: number;
    status: "ok" | "timeout" | "fail" | "skipped" | "degraded";
    note?: string;         // 降级原因 / 超时表现等
  }>;
  reviewChain?: string;    // 决策链，如 "revise→approve"
  finalScore?: number;
  reviewMode?: "standard" | "dual";  // v2.6：单审/双审
  dualReviewDelta?: number; // v2.6：双审模式下，读者视角比事实视角多发现的 issue 数（去重后增量，量化双审价值）
  newLessons?: string[];    // 本次新学到的教训（写入经验条目区）
}

// ======================== 读取 ========================

export function loadExperience(): string {
  if (!existsSync(EXPERIENCE_PATH)) return "";
  return readFileSync(EXPERIENCE_PATH, "utf-8");
}

export function experienceSizeBytes(): number {
  if (!existsSync(EXPERIENCE_PATH)) return 0;
  return statSync(EXPERIENCE_PATH).size;
}

// ======================== 注入：生成"经验简报" ========================

/**
 * 生成经验简报，注入子 Agent 任务 prompt（或编排器决策上下文）。
 * 只注入「## 经验条目」区块——运行日志表是给人看 + 定期聚合的，不注入，
 * 避免随条数增长把 prompt 撑大。
 *
 * @param role 子 Agent 角色（如 "writer"），附加一句定向提示；编排器自己用则不传
 */
export function buildExperienceBrief(role?: string): string {
  const raw = loadExperience();
  if (!raw) return "";

  // 提取「## 经验条目」区块：标题行之后到下一个二级标题或文件尾
  const marker = "## 经验条目";
  const idx = raw.indexOf(marker);
  if (idx < 0) return "";
  const rest = raw.slice(idx + marker.length);
  const nextH2 = rest.indexOf("\n## ");
  const entries = (nextH2 >= 0 ? rest.slice(0, nextH2) : rest).trim();
  if (!entries) return "";

  const roleHint = role ? `\n（优先参考与你角色【${role}】相关的条目）` : "";
  return `## 历史经验（以往运行沉淀，供决策参考）\n\n${entries}\n${roleHint}\n（以上仅供参考，结合当前任务语境判断是否适用，不要机械套用）`;
}

// ======================== 写入 ========================

/**
 * 任务结束时由编排器调用：追加运行记录；如有 newLessons，同时追加到经验条目区。
 * 幂等性由编排器保证（pipeline-state.json 标记 finished 后不再追加）。
 */
export function appendRunRecord(record: RunRecord): void {
  const line = formatRunRow(record);

  // 追加运行记录到「## 运行日志」表格末尾
  if (existsSync(EXPERIENCE_PATH)) {
    const raw = loadExperience();
    const tableMatch = raw.match(/^(\|[^|\r\n]+\|[^\n]*\n(?:\|[-| :]+\|[^\n]*\n)((?:\|.*\n)*))/m);
    if (tableMatch) {
      const insertAt = raw.indexOf(tableMatch[1]) + tableMatch[1].length;
      const updated = raw.slice(0, insertAt) + line + raw.slice(insertAt);
      // 简单起见重写全文（运行日志表截断到 RUN_LOG_KEEP 条由整理逻辑负责）
      writeFileSyncSafe(updated);
    } else {
      appendFileSync(EXPERIENCE_PATH, `\n## 运行日志\n\n${formatRunTableHeader()}${line}`);
    }
  } else {
    writeFileSyncSafe(`# multi-agent-writer 经验库\n\n## 运行日志\n\n${formatRunTableHeader()}${line}\n\n## 经验条目\n`);
  }

  // 新教训追加到经验条目区末尾
  if (record.newLessons?.length) {
    const stamps = record.newLessons.map((l) => `- 【${record.date}】${l}`).join("\n");
    appendFileSync(EXPERIENCE_PATH, `\n${stamps}\n`);
  }
}

/** 体积超限时编排器执行的整理：日志聚合为统计摘要，条目保留 */
export function needsCompaction(): boolean {
  return experienceSizeBytes() > EXPERIENCE_MAX_BYTES;
}

// ======================== 格式化 ========================

function formatRunTableHeader(): string {
  return "| 日期 | 主题 | 各环节（模型/耗时/状态） | 决策链 | 终分 |\n|---|---|---|---|---|\n";
}

function formatRunRow(r: RunRecord): string {
  const stages = r.stages
    .map((s) => `${s.stage}:${s.model}/${s.durationSec ?? "?"}s/${s.status}${s.note ? `(${s.note})` : ""}`)
    .join("；");
  return `| ${r.date} | ${r.topic} | ${stages} | ${r.reviewChain ?? "-"} | ${r.finalScore ?? "-"} |\n`;
}

function writeFileSyncSafe(content: string): void {
  writeFileSync(EXPERIENCE_PATH, content, "utf-8");
}
