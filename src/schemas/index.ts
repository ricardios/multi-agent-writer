/**
 * 数据契约 —— Agent 间传递的结构化 JSON
 * v2: 纯 JSON Schema，不依赖 Zod 运行时（由 Orchestrator 校验）
 */

// ======================== ResearchResult ========================
export const researchSchema = {
  type: "object",
  properties: {
    topic: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          sourceId: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["claim", "sourceId", "confidence"],
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          url: { type: "string", nullable: true },
          verified: { type: "boolean" },
        },
        required: ["id", "title", "url", "verified"],
      },
    },
    gaps: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["topic", "findings", "sources", "gaps", "summary"],
};

// ======================== AnalysisResult ========================
export const analysisSchema = {
  type: "object",
  properties: {
    topic: { type: "string" },
    keyPoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          sourceIds: { type: "array", items: { type: "string" } },
          importance: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["point", "sourceIds", "importance"],
      },
    },
    outline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          description: { type: "string" },
          sourceIds: { type: "array", items: { type: "string" } },
        },
        required: ["heading", "description", "sourceIds"],
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          sourceIds: { type: "array", items: { type: "string" } },
        },
        required: ["description", "sourceIds"],
      },
    },
    missingEvidence: { type: "array", items: { type: "string" } },
    needsMoreResearch: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["topic", "keyPoints", "outline", "risks", "missingEvidence", "needsMoreResearch", "summary"],
};

// ======================== DraftMeta（v2.5：正文走文件，JSON 只回元数据）========================
// 正文由 Writer 直接 write 到 interim/draft-v{N}.md，此 JSON 只含元数据。
// contentPath 是正文的实际落盘路径，编排器校验其存在后传给下游。
export const draftMetaSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    categories: { type: "array", items: { type: "string" } },
    contentPath: { type: "string", description: "正文文件路径，如 .../interim/draft-v1.md" },
    usedSourceIds: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["title", "description", "tags", "categories", "contentPath", "usedSourceIds", "notes"],
};

// 兼容旧版：若子 Agent 仍内联返回 content，编排器把正文写盘后归一为 DraftMeta
export const draftSchema = draftMetaSchema;

// ======================== ReviewResult ========================
// v2.6：score 单总分 → 降为可选（加权算出供经验库趋势记录），
// 新增必填 dimensionScores（分维度评分，改法A）。
// 维度定义（5 维）：facts=事实准确性+引用一致性；evidence=证据充分性；
// code=代码正确性（无代码章节可为 null）；structure=结构完整性；language=语言可读性。
export const DIMENSIONS = ["facts", "evidence", "code", "structure", "language"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** 加权总分（code 为 null 时其余归一化）；权重：facts .3 / evidence .2 / structure .2 / language .2 / code .1 */
export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  facts: 0.3, evidence: 0.2, code: 0.1, structure: 0.2, language: 0.2,
};

export function weightedScore(dimensionScores: Partial<Record<Dimension, number>>): number | null {
  const entries = DIMENSIONS
    .map((d) => [d, dimensionScores[d]] as const)
    .filter(([, v]) => typeof v === "number");
  if (!entries.length) return null;
  const totalW = entries.reduce((s, [d]) => s + DIMENSION_WEIGHTS[d], 0);
  const sum = entries.reduce((s, [d, v]) => s + DIMENSION_WEIGHTS[d] * (v as number), 0);
  return Math.round(sum / totalW);
}

export const reviewSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["approve", "revise", "research"] },
    score: { type: "number", minimum: 0, maximum: 100, nullable: true, description: "v2.6 起可选，由 dimensionScores 加权得出" },
    dimensionScores: {
      type: "object",
      description: "单审 5 维全出；双审分域：事实视角出 facts/evidence/code，读者视角出 structure/language/facts（facts 双查）",
      properties: {
        facts: { type: "number", minimum: 0, maximum: 100, nullable: true },
        evidence: { type: "number", minimum: 0, maximum: 100, nullable: true },
        code: { type: "number", minimum: 0, maximum: 100, nullable: true },
        structure: { type: "number", minimum: 0, maximum: 100, nullable: true },
        language: { type: "number", minimum: 0, maximum: 100, nullable: true },
      },
      required: ["facts", "evidence", "code", "structure", "language"],
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          description: { type: "string" },
          suggestedFix: { type: "string" },
        },
        required: ["severity", "description", "suggestedFix"],
      },
    },
    // v2.5：来源真实性抽查记录（仅事实核查视角/单审 Reviewer 做）
    sourceChecks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceId: { type: "string" },
          claim: { type: "string", description: "被抽查的事实性陈述" },
          result: { type: "string", enum: ["match", "mismatch", "unreachable", "unverifiable"] },
          note: { type: "string" },
        },
        required: ["sourceId", "claim", "result"],
      },
    },
    feedback: { type: "string" },
  },
  required: ["decision", "dimensionScores", "issues", "sourceChecks", "feedback"],
};

// ======================== PipelineState（v2.5：断点续跑）========================
// 每个环节完成后编排器更新此文件；重新启动任务时若存在且未 finished，从断点恢复。
export const pipelineStateSchema = {
  type: "object",
  properties: {
    topic: { type: "string" },
    runDir: { type: "string", description: "当次任务 output 目录（interim/ 的父目录）" },
    currentStage: { type: "string", enum: ["research", "analysis", "writing", "polish", "review", "output"] },
    reviewMode: { type: "string", enum: ["standard", "dual"], description: "审查模式：standard=单审，dual=双审分域对抗（任务配置时确定，断点续跑沿用）" },
    polishEnabled: { type: "boolean", description: "v2.9：是否执行 humanizer-zh 润色环节（任务配置时确定，断点续跑沿用；false 时 stageLog 记 skipped）" },
    amendmentActive: { type: "boolean", description: "v2.10：修改会话激活中（终稿交付后用户提出修改意见时重新打开：finished 置 false，draftVersion 继续递增）" },
    finalVersion: { type: "number", description: "v2.10：终稿第几版（从 1 计，每轮修改 +1，用于 article-final-v{N}.md 留档命名）" },
    writingMode: { type: "string", enum: ["serial", "parallel"], description: "v2.7：串行单Writer / 分章并行。大纲章节 >PARALLEL_WRITE_THRESHOLD(10) 自动 parallel，断点续跑沿用" },
    plannedChapters: { type: "number", description: "v2.7：parallel 模式的总章数。恢复时按 interim/chapters/chapter-{NN}.md 文件存在性判断缺哪章补哪章" },
    draftVersion: { type: "number", description: "草稿版本号，从 1 递增（每次 revise +1）" },
    reviewCount: { type: "number", description: "已完成的审核次数" },
    researchRounds: { type: "number", description: "已执行的研究轮次（含补充检索）" },
    finished: { type: "boolean" },
    userChangeRequests: {
      type: "array",
      description: "v2.10：修改会话中经用户确认的结构化修改指令清单（UserChangeRequest，见 userChangeRequestSchema）",
      items: { type: "object" },
    },
    stageLog: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stage: { type: "string" },
          status: { type: "string", enum: ["ok", "timeout", "fail", "skipped", "degraded"] },
          model: { type: "string" },
          durationSec: { type: "number" },
          note: { type: "string" },
          artifact: { type: "string", description: "该环节产物文件路径" },
        },
        required: ["stage", "status"],
      },
    },
    updatedAt: { type: "string", description: "ISO 时间戳" },
  },
  required: ["topic", "runDir", "currentStage", "reviewMode", "polishEnabled", "writingMode", "draftVersion", "reviewCount", "researchRounds", "finished", "stageLog"],
};

// v2.7：分章并行的触发阈值（大纲章节数超过此值自动启用）
export const PARALLEL_WRITE_THRESHOLD = 10;

// ======================== 修改模式（v2.10）========================

export const REVISION_TIERS = ["trivial", "minor", "major"] as const;
export type RevisionTier = (typeof REVISION_TIERS)[number];

/** 维度回退容忍度：修改后某维度比上一版低超过此分才记回退（防 Reviewer 打分±2 正常波动误报） */
export const DIMENSION_REGRESSION_TOLERANCE = 3;

/** 用户修改指令（Amendment 模式的结构化意见清单） */
export const userChangeRequestSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "C1, C2..." },
    target: { type: "string", description: "改哪里：章节/段落/全文语气" },
    change: { type: "string", description: "改成什么（用户意图的结构化转述）" },
    reason: { type: "string", description: "为什么（用户原话摘要）" },
    scope: { type: "string", enum: ["trivial", "minor", "major"], description: "分级：trivial=主agent直改；minor=Revise Agent；major=回上游（补Research/调Analysis/重写章节）" },
  },
  required: ["id", "target", "change", "reason", "scope"],
};

/** 维度回归对比：修改后 vs 上一版基线，检出回退维度 */
export function compareDimensionScores(
  prev: Partial<Record<Dimension, number>> | undefined,
  next: Partial<Record<Dimension, number>>,
): { regressions: Array<{ dimension: Dimension; prevScore: number; nextScore: number }>; allPass: boolean } {
  const regressions: Array<{ dimension: Dimension; prevScore: number; nextScore: number }> = [];
  for (const d of DIMENSIONS) {
    const p = prev?.[d];
    const n = next?.[d];
    if (typeof p === "number" && typeof n === "number" && n < p - DIMENSION_REGRESSION_TOLERANCE) {
      regressions.push({ dimension: d, prevScore: p, nextScore: n });
    }
  }
  return { regressions, allPass: regressions.length === 0 };
}

// ======================== 双审合并（v2.6 改法B）========================

/**
 * 合并双审结果：
 * - decision 取严格票：research > revise > approve（缺证据是最根本问题，一票即 research）
 * - issues 按 description 精确去重合并
 * - dimensionScores：facts 取两者较低分（双保险）；evidence/code 取事实视角；structure/language 取读者视角
 * - sourceChecks 取事实视角（抽查只在事实侧做）
 * - deltaIssues = 读者视角发现但事实视角未覆盖的 issue 数（去重后增量，写经验库量化双审价值）
 */
export function mergeDualReview(factCheck: any, readerReview: any): { merged: any; deltaIssues: number } {
  const strictness: Record<string, number> = { approve: 0, revise: 1, research: 2 };
  const decision = strictness[factCheck.decision] >= strictness[readerReview.decision]
    ? factCheck.decision : readerReview.decision;

  const factDescs = new Set((factCheck.issues ?? []).map((i: any) => (i.description ?? "").trim()));
  const mergedIssues = [...(factCheck.issues ?? [])];
  let deltaIssues = 0;
  for (const issue of readerReview.issues ?? []) {
    if (!factDescs.has((issue.description ?? "").trim())) {
      mergedIssues.push(issue);
      deltaIssues++;
    }
  }

  const fs = factCheck.dimensionScores ?? {};
  const rs = readerReview.dimensionScores ?? {};
  const dimensionScores: Partial<Record<Dimension, number>> = {
    facts: Math.min(fs.facts ?? 100, rs.facts ?? 100),
    evidence: fs.evidence ?? null,
    code: fs.code ?? null,
    structure: rs.structure ?? null,
    language: rs.language ?? null,
  };

  const merged = {
    decision,
    score: weightedScore(dimensionScores),
    dimensionScores,
    issues: mergedIssues,
    sourceChecks: factCheck.sourceChecks ?? [],
    feedback: `【事实视角】${factCheck.feedback ?? ""}\n【读者视角】${readerReview.feedback ?? ""}`.trim(),
  };
  return { merged, deltaIssues };
}

// ======================== 业务规则校验 ========================

/**
 * ReviewResult 校验。
 * @param mode "single"（默认）单审 5 维全出；"fact" 事实视角（facts/evidence/code 必填）；"reader" 读者视角（structure/language/facts 必填）
 */
export function validateReview(review: any, mode: "single" | "fact" | "reader" = "single"): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const validDecisions = ["approve", "revise", "research"];

  if (!validDecisions.includes(review.decision)) {
    errors.push(`decision 必须是 ${validDecisions.join("/")}，实际: ${review.decision}`);
  }

  if (review.decision !== "approve" && (!review.issues || review.issues.length === 0)) {
    errors.push("revise/research 必须包含可操作的 issue");
  }

  if (review.decision === "approve" && review.issues?.some((i: any) => i.severity === "high")) {
    errors.push("存在 high severity issue 时不能 approve");
  }

  if (review.decision === "approve" && (review.dimensionScores ? Object.values(review.dimensionScores).some((v: any) => typeof v === "number" && v < 70) : false)) {
    errors.push("存在维度 <70 时不能 approve（v2.6 业务规则）");
  }

  // v2.6：分维度评分校验
  const ds = review.dimensionScores;
  if (!ds || typeof ds !== "object") {
    errors.push("dimensionScores 必填（v2.6 分维度评分）");
  } else {
    const required: Record<"single" | "fact" | "reader", Dimension[]> = {
      single: ["facts", "evidence", "structure", "language"],  // code 允许 null（无代码章节）
      fact: ["facts", "evidence"],                              // code 允许 null
      reader: ["structure", "language", "facts"],
    };
    for (const d of required[mode]) {
      const v = ds[d];
      if (typeof v !== "number" || v < 0 || v > 100) {
        errors.push(`维度 ${d} 分数缺失或不在 0-100（code 无代码章节可 null）`);
      }
    }
  }

  // v2.5：来源抽查 mismatch = 事实错误，等同 high severity issue，不能 approve
  if (review.decision === "approve" && review.sourceChecks?.some((c: any) => c.result === "mismatch")) {
    errors.push("sourceChecks 中存在 mismatch（claim 与来源矛盾），不能 approve");
  }

  // v2.5：有抽查记录时，mismatch 必须在 issues 中也有对应 high 条目（防漏记）
  const mismatches = (review.sourceChecks ?? []).filter((c: any) => c.result === "mismatch");
  for (const c of mismatches) {
    const covered = review.issues?.some(
      (i: any) => i.severity === "high" && i.description?.includes(c.sourceId),
    );
    if (!covered) {
      errors.push(`来源 ${c.sourceId} 的 mismatch 未记入 issues（需补 high severity issue）`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 引用一致性校验。
 * v2.5：draft.content 由编排器从 interim/draft-v{N}.md 读取后传入，
 * 或由 DraftMeta.contentPath 定位读取——本函数不负责读盘。
 */
export function validateCitations(research: any, draft: { content: string; usedSourceIds: string[] }): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const validSourceIds = new Set(research.sources.map((s: any) => s.id));

  // 提取正文引用 [S1], (S1), [S1,S2] 等
  const citationGroups = [...draft.content.matchAll(
    /[\[（(]((?:S\d+)(?:\s*[,，、;；]\s*S\d+)*)[\]）)]/g,
  )];
  const cited = new Set(
    citationGroups.flatMap((m) => m[1].match(/S\d+/g) ?? []),
  );
  const declared = new Set(draft.usedSourceIds);

  for (const id of declared) {
    if (!validSourceIds.has(id)) {
      warnings.push(`声明的来源 ${id} 不存在于研究结果中`);
    }
  }
  for (const id of cited) {
    if (!declared.has(id)) {
      warnings.push(`正文引用了 ${id} 但未在 usedSourceIds 中声明`);
    }
  }
  for (const id of declared) {
    if (!cited.has(id)) {
      warnings.push(`声明了 ${id} 但正文未引用`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}
