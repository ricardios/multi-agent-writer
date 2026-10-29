/**
 * Agent Prompt 模板 v2.5 —— 文件传递 + 来源抽查 + 经验注入
 *
 * v2.5 核心变化（vs v2.4）：
 * 1. 中间产物走文件不走 prompt：
 *    - 每个环节产物落盘到 interim/ 目录，下游 Agent 只收文件路径 + 导航摘要
 *    - Writer 直接把正文 write 到 draft 文件，JSON 只回元数据（contentPath）
 *    - 消除长文 JSON 转义/截断风险，revise 循环不再重复传全文
 * 2. Reviewer 增加来源真实性抽查：对核心 claim 用 web_fetch 核对来源
 * 3. 经验注入：各 Agent prompt 可选嵌入 buildExperienceBrief() 生成的历史经验
 *
 * v2.4 继承：全员技能自主权（buildSkillAutonomyDirective）
 */

import { buildSkillAutonomyDirective } from "../skill-registry/index.js";
import { buildExperienceBrief } from "../experience/index.js";

export interface AgentSpawnConfig {
  label: string;
  model: string;
  task: string;
  lightContext?: boolean;
}

/** 拼装任务 prompt：任务 + 可选经验简报 + 技能自主权指令 */
function withAutonomy(task: string, experienceBrief?: string): string {
  const exp = experienceBrief ? `${experienceBrief}\n\n` : "";
  return `${task}\n\n${exp}${buildSkillAutonomyDirective()}`;
}

/** 拼装风格指令段（v2.8：用户偏好档案，空串安全） */
function styleBlock(styleDirective?: string): string {
  return styleDirective ? `${styleDirective}\n\n` : "";
}

/** 输出说明：产物走文件 + 回元数据 JSON 的统一格式约束 */
const FILE_OUTPUT_RULE = `
产物规则：
- 大体积产物（正文/研究结果）不要放进 JSON，直接用 write 工具写入指定文件
- JSON 回复只含元数据（路径、摘要、编号），保证小而可解析
- 输出 JSON 时用纯 JSON，不要 markdown 代码块包裹`;

// ======================== Research Agent ========================

/**
 * @param searchResultsPath 原始搜索结果文件路径（interim/search-results.md）
 * @param searchDigest 一行导航摘要，如 "关键词4路 / 结果约40条"
 */
export function createResearchAgent(
  topic: string,
  searchResultsPath: string,
  researchPath: string,
  searchDigest: string,
  model: string,
  experienceBrief?: string,
): AgentSpawnConfig {
  return {
    label: "research-agent",
    model,
    lightContext: true,
    task: withAutonomy(`你是一个技术研究员。

任务：读取搜索结果文件，提取关键事实、来源和证据缺口。
（如判断需要补充检索内部知识库等，可自主调用相应技能）

主题：${topic}

搜索结果文件：${searchResultsPath}
导航摘要：${searchDigest}
（先 read 上述文件获取完整搜索结果）

${FILE_OUTPUT_RULE}

产物写入：${researchPath}
请把 ResearchResult JSON 用 write 写入上述路径，内容：
{
  "topic": "${topic}",
  "findings": [{ "claim": "具体事实", "sourceId": "S1", "confidence": "high|medium|low" }],
  "sources": [{ "id": "S1", "title": "标题", "url": "URL或null", "verified": true }],
  "gaps": ["尚未找到证据的问题"],
  "summary": "研究总结"
}

规则：sourceId 用 S1, S2... 编号；不要编造来源；区分事实和假设。
完成后回复一行 JSON：{"researchPath": "<上述路径>", "findings": <条数>, "sources": <个数>, "gaps": <条数>}`, experienceBrief),
  };
}

// ======================== Analysis Agent ========================

/**
 * @param researchPath ResearchResult 文件路径（interim/research.json）
 * @param researchDigest 一行导航摘要，如 "findings 12 条 / sources 9 个 / gaps 3 条"
 */
export function createAnalysisAgent(
  topic: string,
  researchPath: string,
  analysisPath: string,
  researchDigest: string,
  model: string,
  experienceBrief?: string,
): AgentSpawnConfig {
  return {
    label: "analysis-agent",
    model,
    lightContext: true,
    task: withAutonomy(`你是一个技术分析专家。读取研究结果，设计文章大纲。
（如需对数据做深入分析，可自主调用数据分析类技能）

主题：${topic}

研究结果文件：${researchPath}
导航摘要：${researchDigest}
（先 read 上述文件获取完整研究数据）

${FILE_OUTPUT_RULE}

产物写入：${analysisPath}
请把 AnalysisResult JSON 用 write 写入上述路径，内容：
{
  "topic": "主题",
  "keyPoints": [{ "point": "论点", "sourceIds": ["S1"], "importance": "high" }],
  "outline": [{ "heading": "标题", "description": "描述", "sourceIds": ["S1"] }],
  "risks": [{ "description": "风险", "sourceIds": ["S1"] }],
  "missingEvidence": ["缺失证据"],
  "needsMoreResearch": false,
  "summary": "总结"
}

规则：每个 keyPoint 关联 sourceId；不要写正文。
完成后回复一行 JSON：{"analysisPath": "<上述路径>", "chapters": <章节数>, "keyPoints": <条数>, "needsMoreResearch": true|false}`, experienceBrief),
  };
}

// ======================== Writer Agent ========================

/**
 * v2.5：正文直接写文件，JSON 只回元数据。
 * @param draftPath 草稿正文落盘路径（interim/draft-v{N}.md）
 * @param analysisDigest 大纲导航摘要（章节标题列表，一行一章）
 */
export function createWriterAgent(
  topic: string,
  researchPath: string,
  analysisPath: string,
  analysisDigest: string,
  draftPath: string,
  model: string,
  experienceBrief?: string,
  styleDirective?: string,
): AgentSpawnConfig {
  return {
    label: "writer-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是一个技术写作专家。根据研究结果和分析大纲，撰写完整的中文技术文章。
（如需生成架构图/流程图配图，可自主发现并调用图表类技能）

主题：${topic}

研究数据文件：${researchPath}
分析大纲文件：${analysisPath}
大纲摘要：
${analysisDigest}
（先 read 两个文件获取完整数据；若 token 紧张优先读大纲，研究数据按需查阅）

${styleBlock(styleDirective)}写作要求：
1. 每个章节 300-800 字，Markdown 格式
2. 引用来源用 [S1]、[S2] 格式
3. 只使用提供的证据，不要编造
4. 如需代码示例，写出完整的可运行代码
5. 语言专业但易懂，自然书写

${FILE_OUTPUT_RULE}

正文写入：用 write 把完整 Markdown 正文写入 ${draftPath}
然后回复元数据 JSON（纯 JSON，不含正文）：
{
  "title": "标题",
  "description": "描述",
  "tags": ["标签"],
  "categories": ["分类"],
  "contentPath": "${draftPath}",
  "usedSourceIds": ["S1"],
  "notes": ["编辑说明"]
}`, experienceBrief),
  };
}

// ======================== Revise Writer（revise 循环用）========================

/**
 * v2.5 新增：revise 时的定向修订指令——逐条处理 issue，而非重写全文。
 * @param draftPath 要修订的草稿文件路径（原地写回）
 * @param reviewPath 上次 ReviewResult 文件路径（含 issues）
 */
export function createReviseAgent(
  topic: string,
  draftPath: string,
  reviewPath: string,
  issuesDigest: string,
  model: string,
  experienceBrief?: string,
  styleDirective?: string,
): AgentSpawnConfig {
  return {
    label: "writer-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是一个技术写作专家，执行定向修订。

主题：${topic}
草稿文件：${draftPath}
上次审核结果文件：${reviewPath}
issue 摘要：
${issuesDigest}

${styleBlock(styleDirective)}步骤：
1. read 草稿文件和审核结果文件
2. 逐条处理每个 issue：按 suggestedFix 用现有证据修订对应段落
3. 只改有问题的部分，不要大幅重写未受影响的章节
4. 若某 issue 需要的确实证据不存在，在 notes 中说明，不要编造
5. 修订完成后用 write 把全文写回 ${draftPath}（原地更新）

然后回复元数据 JSON（纯 JSON）：
{
  "contentPath": "${draftPath}",
  "fixedIssues": <已修复数>,
  "notes": ["未修复的 issue 及原因"]
}`, experienceBrief),
  };
}

// ======================== Chapter Writer Agent（v2.7 分章并行，map）========================

/**
 * 单章写作：大纲章节 >10 时编排器并行 spawn 每章一个（同一模型，风格一致优先），
 * 产物 interim/chapters/chapter-{NN}.md，断点续跑按文件存在性补缺章。
 * 单章 300-800 字不超时，可用快速模型（直接绕开经验库 M1 的长文超时坑）。
 */
export function createChapterWriterAgent(
  topic: string,
  researchPath: string,
  analysisPath: string,
  chapterNum: number,
  totalChapters: number,
  heading: string,
  chapterDesc: string,
  prevHeading: string | null,
  nextHeading: string | null,
  chapterPath: string,
  model: string,
  experienceBrief?: string,
  styleDirective?: string,
): AgentSpawnConfig {
  return {
    label: `chapter-writer-${String(chapterNum).padStart(2, "0")}`,
    model,
    lightContext: true,
    task: withAutonomy(`你是技术写作专家，负责合写文章中的**第 ${chapterNum} 章（共 ${totalChapters} 章）**。
（如本章需图示配图，可自主发现并调用图表类技能）

主题：${topic}
研究数据文件：${researchPath}
完整大纲文件：${analysisPath}
（可 read 大纲了解全文结构；研究数据按需查阅，只取本章相关证据）

${styleBlock(styleDirective)}本章任务：
- 章节标题：${heading}
- 章节描述：${chapterDesc}
- 前一章：${prevHeading ?? "（本章开头，需要引入段）"}
- 后一章：${nextHeading ?? "（本章结尾，需要收束段承接结论）"}

写作要求：
1. 只写本章，300-800 字，Markdown，一级标题用 "## ${heading}"（不要更高层级）
2. 引用来源用 [S1]、[S2] 格式，只用提供的证据
3. 若需代码，写完整可运行代码
4. 风格要求：专业但易懂；不要重复前后章内容，开头衔接前章结尾、结尾为后章留口
5. 不要写全文其他章节，不要总结全文

产物：用 write 把本章写入 ${chapterPath}
然后回复元数据 JSON：
{
  "chapterPath": "${chapterPath}",
  "heading": "${heading}",
  "usedSourceIds": ["S1"],
  "wordCount": <字数>
}`, experienceBrief),
  };
}

// ======================== Stitcher Agent（v2.7 统稿，reduce）========================

/**
 * 统稿：合并各章 → 风格/术语/人称统一、过渡衔接、去章间重复；
 * 缺章（写作失败的章节）由它基于大纲补写；输出 draft-v{N}.md + 汇总元数据。
 * 用旗舰模型（质量兑底关键环节）。
 */
export function createStitcherAgent(
  topic: string,
  researchPath: string,
  analysisPath: string,
  chapterPaths: string[],
  missingChapters: string[],
  draftPath: string,
  model: string,
  experienceBrief?: string,
): AgentSpawnConfig {
  const chapterList = chapterPaths.map((p) => `- ${p}`).join("\n");
  const missingList = missingChapters.length
    ? `以下章节写作失败，需你基于大纲和研究数据补写（放在正确位置）：\n${missingChapters.map((c) => `- ${c}`).join("\n")}`
    : "无缺章";
  return {
    label: "stitcher-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是统稿编辑。多位作者并行写了同一篇文章的不同章节，你来合成最终稿。

主题：${topic}
研究数据文件：${researchPath}
完整大纲文件：${analysisPath}

已完成的章节文件：
${chapterList}

${missingList}

统稿职责（按序执行）：
1. read 全部章节文件和大纲，核对章序与大纲一致
2. 补写缺失章节（如有）
3. 全文通读修改：统一风格、人称、术语；删除章间重复内容；修补过渡衔接；确保术语与结论前后一致
4. 引用格式统一为 [S1]、[S2]；不新增无证据内容
5. 保持各章实质内容与引用，不要大幅重写

产物：用 write 把完整全文写入 ${draftPath}
然后回复元数据 JSON：
{
  "title": "标题",
  "description": "描述",
  "tags": ["标签"],
  "categories": ["分类"],
  "contentPath": "${draftPath}",
  "usedSourceIds": ["全部章节去重后的来源ID"],
  "notes": ["统稿主要改动说明", "如补写了章节，说明补写情况"]
}`, experienceBrief),
  };
}

// ======================== User Revision Agent（v2.10 修改模式）========================

/**
 * 用户修改指令驱动的修订：修改意见是用户直接要求，权威性高于 Reviewer issue。
 * 输入：当前终稿工作副本 + 经用户确认的结构化修改指令清单 + 上一版维度基线（可选）。
 * 输出：修订后写回同一 draft 文件 + 处理报告 JSON。
 */
export function createUserRevisionAgent(
  topic: string,
  draftPath: string,
  prevReviewPath: string | null,
  changeRequests: string,
  model: string,
  experienceBrief?: string,
  styleDirective?: string,
): AgentSpawnConfig {
  const baseline = prevReviewPath
    ? `上一版审核基线（修订时不得引入回退，可 read 参考）：${prevReviewPath}`
    : "（首次修订，无历史基线）";
  return {
    label: "user-revision-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是修订专家，处理用户对文章的直接修改要求。

主题：${topic}
待修改文章：${draftPath}（read 后逐条处理，修改后原地写回）
${baseline}

用户修改指令清单（已经用户确认，权威性最高——不擅自偏离、不扩大改动范围）：
${changeRequests}

${styleBlock(styleDirective)}执行规则：
1. read 全文与指令清单，逐条处理每个修改指令
2. 改动最小化：只改指令涉及的段落及必要的连带一致性调整（术语/引用/过渡），其余保持原样
3. 修订自查：不得引入新问题——引用编号仍有效、术语与全文一致、修改段落与前后文衔接自然
4. 某指令与现有证据矛盾或无法执行时，如实记入 notes 说明原因，不硬改不编造
5. 全部处理完后用 write 把全文写回 ${draftPath}

回复处理报告 JSON（纯 JSON）：
{
  "contentPath": "${draftPath}",
  "processedRequests": <已处理条数>,
  "skippedRequests": [{ "id": "C1", "reason": "原因" }],
  "notes": ["连带调整说明"]
}`, experienceBrief),
  };
}

// ======================== Polish Agent ========================

/**
 * v2.5：输入输出都走文件。
 * @param draftPath 润色前正文路径
 * @param polishedPath 润色后正文落盘路径
 */
export function createPolishAgent(
  draftPath: string,
  polishedPath: string,
  model: string,
  styleDirective?: string,
  changedSections?: string[],
): AgentSpawnConfig {
  return {
    label: "polish-agent",
    model,
    lightContext: false,
    task: `你是一个专项技能执行者（文字润色）。

第一步：读取技能指南
用 read 工具完整读取：
<skillsDir>\\humanizer-zh\\SKILL.md
将其中所有规则作为你的工作标准。

第二步：处理输入
读取待润色正文：${draftPath}
对全文执行人性化润色，去除 AI 写作痕迹。
${changedSections?.length ? `**局部润色模式（v2.10）**：本轮为修改后复润，重点处理以下修改过的章节：
${changedSections.map((s) => `- ${s}`).join("\n")}
其余段落保持原样，仅做必要的全文一致性检查，不要重写未修改的部分。
` : ""}${styleBlock(styleDirective)}第三步：输出
用 write 把润色后的完整正文（Markdown）写入：${polishedPath}
然后在回复中输出质量评分 JSON（纯 JSON，不含正文）：
{
  "polishedPath": "${polishedPath}",
  "qualityScore": <50分制评分>,
  "changes": ["主要改动说明"],
  "skippedReason": "如触发跳过条件则说明，否则为null"
}

${buildSkillAutonomyDirective()}`,
  };
}

// ======================== Reviewer Agent（单审，5 维全出）========================

/** 维度定义说明（单审/双审共用的评分口径） */
const DIMENSION_SPEC = `
维度评分（v2.6，0-100）：
- facts = 事实准确性 + 引用一致性（文中 [S1] 等编号必须存在于 sources 中）
- evidence = 证据充分性（论点是否有足够证据支撑）
- code = 代码正确性（无代码章节填 null）
- structure = 结构完整性（章节组织、逻辑连贯）
- language = 语言可读性（表达质量而非"是否像 AI"，文章已润色）`;

/**
 * v2.5：走文件 + 来源真实性抽查；v2.6：分维度评分。
 * @param draftPath 待审草稿路径
 * @param researchPath ResearchResult 路径
 */
export function createReviewerAgent(
  draftPath: string,
  researchPath: string,
  reviewPath: string,
  reviewCount: number,
  maxReviews: number,
  model: string,
  experienceBrief?: string,
): AgentSpawnConfig {
  return {
    label: "reviewer-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是一个严格的技术文章审核专家。请先读取以下两个文件，然后审核。
（如需验证文中数据/代码逻辑，可自主调用数据分析等技能辅助验证）

文章文件：${draftPath}
研究数据文件（可用证据）：${researchPath}

审核（第 ${reviewCount + 1}/${maxReviews} 次）：
1. 事实准确性与引用一致性
2. 证据充分性
3. 结构完整性
4. 语言可读性（文章已润色，评估内容质量而非"是否像 AI"）
5. 代码正确性（如有）
6. 来源真实性抽查（见下）

${DIMENSION_SPEC}

## 来源真实性抽查（必做）

1. 从 research 文件的 findings 中，选出被草稿引用且 confidence=high 的事实性 claim，最多抽 3 条最核心的
2. 对应来源处理：
   - 有 URL：用 web_fetch 抓取该 URL，核对 claim 是否被来源内容支持
     - 支持 → match；矛盾 → mismatch（必须记为 high severity issue）
     - 无法访问/超时 → unreachable（如实记录，不算失败）
   - url=null → unverifiable（内部来源无公开 URL，不算错误）
3. 每次抽查都要给出独立判断，不要因为来源标题相关就直接判 match

${FILE_OUTPUT_RULE}

产物写入：${reviewPath}
请把 ReviewResult JSON 用 write 写入上述路径，内容：
{
  "decision": "approve|revise|research",
  "score": <各维度加权总评，整数，或 null>,
  "dimensionScores": { "facts": <0-100>, "evidence": <0-100>, "code": <0-100或null>, "structure": <0-100>, "language": <0-100> },
  "issues": [{ "severity": "high|medium|low", "description": "描述", "suggestedFix": "建议" }],
  "sourceChecks": [{ "sourceId": "S1", "claim": "被抽查的陈述", "result": "match|mismatch|unreachable|unverifiable", "note": "简要说明" }],
  "feedback": "总反馈"
}

决策规则：
- approve = 达标且无 high 问题且抽查无 mismatch
- revise = 可改进
- research = 缺关键证据（必须回环节一，不要把证据缺失降级成 revise）
- 非 approve 必须有 issue；低分维度（<70）必须在 issues 中有对应问题记录

完成后回复一行 JSON：{"reviewPath": "<上述路径>", "decision": "...", "score": <分数>, "issueCount": <数量>}`, experienceBrief),
  };
}

// ======================== 双审分域：事实核查视角（v2.6 改法B）========================

/**
 * 负责维度：facts / evidence / code + 来源真实性抽查。
 * 与读者视角并行 spawn，结果由编排器 mergeDualReview 合并。
 */
export function createFactCheckerAgent(
  draftPath: string,
  researchPath: string,
  reviewPath: string,
  reviewCount: number,
  maxReviews: number,
  model: string,
  experienceBrief?: string,
): AgentSpawnConfig {
  return {
    label: "reviewer-fact-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是一个严格的事实核查专家（双审模式：事实核查视角）。
只审事实与证据，不评结构与文笔。

文章文件：${draftPath}
研究数据文件（可用证据）：${researchPath}

审核（第 ${reviewCount + 1}/${maxReviews} 次）你只负责三个维度：
${DIMENSION_SPEC}
（你只出 facts / evidence / code 三个维度分，structure 与 language 由另一位审稿人负责，不要重复评分）

## 来源真实性抽查（必做）

1. 从 research 文件的 findings 中，选出被草稿引用且 confidence=high 的事实性 claim，最多抽 3 条最核心的
2. 有 URL：用 web_fetch 抓取核对——支持 → match；矛盾 → mismatch（必须记为 high severity issue）；无法访问 → unreachable（如实记录，不算失败）
3. url=null → unverifiable（不算错误）

${FILE_OUTPUT_RULE}

产物写入：${reviewPath}
请把 ReviewResult JSON 用 write 写入上述路径，内容：
{
  "decision": "approve|revise|research",
  "score": null,
  "dimensionScores": { "facts": <0-100>, "evidence": <0-100>, "code": <0-100或null> },
  "issues": [{ "severity": "high|medium|low", "description": "描述", "suggestedFix": "建议" }],
  "sourceChecks": [{ "sourceId": "S1", "claim": "被抽查的陈述", "result": "match|mismatch|unreachable|unverifiable", "note": "简要说明" }],
  "feedback": "事实与证据层面总反馈"
}

决策规则：approve=无事实错误且无 high 且抽查无 mismatch；research=缺关键证据（不降级为 revise）；非 approve 必须有 issue。

完成后回复一行 JSON：{"reviewPath": "<上述路径>", "decision": "...", "facts": <分数>, "issueCount": <数量>}`, experienceBrief),
  };
}

// ======================== 双审分域：读者体验视角（v2.6 改法B）========================

/**
 * 负责维度：structure / language，另出 facts 作为双保险交叉视图。
 * 不做来源抽查（事实侧负责），不评代码。
 */
export function createReaderReviewerAgent(
  draftPath: string,
  reviewPath: string,
  reviewCount: number,
  maxReviews: number,
  model: string,
  experienceBrief?: string,
): AgentSpawnConfig {
  return {
    label: "reviewer-reader-agent",
    model,
    lightContext: false,
    task: withAutonomy(`你是一个挑剔的技术读者兼资深编辑（双审模式：读者体验视角）。
只审结构与可读性，不核对来源真实性（事实由另一位审稿人负责），不评代码。

文章文件：${draftPath}

审核（第 ${reviewCount + 1}/${maxReviews} 次）：
1. structure：结构完整性——章节组织、论证顺序、逻辑连贯、覆盖度
2. language：语言可读性——表达质量、节奏、易读性（文章已润色，评估内容质量而非"是否像 AI"）
3. facts（交叉双保险）：仅从读者直觉出发——有无读着觉得不对劲、前后矛盾、解释不清的地方，记为 issue 即可，无需核实来源

${DIMENSION_SPEC}
（你只出 structure / language / facts 三个维度分，evidence 与 code 由另一位审稿人负责）

${FILE_OUTPUT_RULE}

产物写入：${reviewPath}
请把 ReviewResult JSON 用 write 写入上述路径，内容：
{
  "decision": "approve|revise|research",
  "score": null,
  "dimensionScores": { "structure": <0-100>, "language": <0-100>, "facts": <0-100> },
  "issues": [{ "severity": "high|medium|low", "description": "描述", "suggestedFix": "建议" }],
  "sourceChecks": [],
  "feedback": "读者体验层面总反馈"
}

决策规则：approve=结构与可读性达标；revise=可改进；research=仅当读者视角发现重大内容缺口且明显缺证据时使用；非 approve 必须有 issue。

完成后回复一行 JSON：{"reviewPath": "<上述路径>", "decision": "...", "language": <分数>, "issueCount": <数量>}`, experienceBrief),
  };
}
