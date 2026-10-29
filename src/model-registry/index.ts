/**
 * 智能模型决策系统 v2.2 —— Agent 自主选择最优模型
 *
 * 设计理念：
 * 1. MODEL_REGISTRY 只提供模型能力数据（事实），不做决策
 * 2. 模型选择由编排 Agent（LLM）根据具体任务场景自主判断
 * 3. 本模块提供决策支持：能力过滤 + 候选集生成 + 上下文参考
 * 4. 最终选哪个模型，由 Agent 结合任务具体情况权衡决定
 *
 * 与 v2.1 的区别：
 * - v2.1: 固定评分算法（quality→flagship 优先），规则驱动
 * - v2.2: Agent 拿到候选集和任务上下文后自主决策，判断驱动
 *
 * 新模型加入只需更新 MODEL_REGISTRY，Agent 决策时自动感知。
 */

// ======================== 模型注册表（纯数据）========================

export interface ModelInfo {
  id: string;                    // 完整模型 ID（含 provider 前缀，用于 spawn）
  provider: string;
  name: string;
  inputModalities: string[];     // ["text"] / ["text", "image"]
  contextWindow: number;
  maxOutputTokens?: number;      // 有硬限制才标注
  speedTier: "fast" | "medium" | "slow";
  qualityTier: "flagship" | "high" | "mid" | "budget";
  strengths: string[];           // 模型特长（供 Agent 决策参考）
  notes?: string;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: "qwen/bailian/qwen3.8-max",
    provider: "qwen",
    name: "Qwen3.8 Max",
    inputModalities: ["text", "image"],
    contextWindow: 1_000_000,
    speedTier: "slow",
    qualityTier: "flagship",
    strengths: ["综合能力最强", "多模态理解", "复杂推理", "中文能力优秀"],
    notes: "较慢，质量敏感且不赶时间的任务首选",
  },
  {
    id: "qwen/bailian/qwen3.7-plus",
    provider: "qwen",
    name: "Qwen3.7 Plus",
    inputModalities: ["text", "image"],
    contextWindow: 1_000_000,
    speedTier: "medium",
    qualityTier: "high",
    strengths: ["均衡", "多模态", "长上下文"],
    notes: "Max 的速度折中版",
  },
  {
    id: "qwen/bailian/qwen3.8-flash",
    provider: "qwen",
    name: "Qwen3.8 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1_000_000,
    speedTier: "fast",
    qualityTier: "mid",
    strengths: ["速度快", "多模态", "1M 上下文"],
    notes: "默认子 Agent 模型，适合信息提取/摘要类",
  },
  {
    id: "volcengine/fangzhou/doubao-seed-evolving",
    provider: "volcengine",
    name: "Doubao Seed Evolving",
    inputModalities: ["text", "image"],
    contextWindow: 1_000_000,
    speedTier: "medium",
    qualityTier: "high",
    strengths: ["多模态", "持续进化", "长上下文"],
  },
  {
    id: "volcengine/fangzhou/doubao-seed-2-1-turbo",
    provider: "volcengine",
    name: "Doubao Seed 2.1 Turbo",
    inputModalities: ["text", "image"],
    contextWindow: 256_000,
    speedTier: "fast",
    qualityTier: "mid",
    strengths: ["速度快", "多模态"],
    notes: "256K 上下文",
  },
  {
    id: "moonshot/bailian/kimi-k2.6",
    provider: "moonshot",
    name: "kimi-k2.6",
    inputModalities: ["text", "image"],
    contextWindow: 256_000,
    maxOutputTokens: 8192,
    speedTier: "medium",
    qualityTier: "high",
    strengths: ["多模态", "长文本理解"],
    notes: "⚠️ 输出上限 8192 tokens，不适合生成超长文",
  },
  {
    id: "deepseek/qianfan/deepseek-v4-pro",
    provider: "deepseek",
    name: "DeepSeek V4 Pro",
    inputModalities: ["text"],
    contextWindow: 1_000_000,
    speedTier: "medium",
    qualityTier: "flagship",
    strengths: ["推理最强", "代码生成", "数学", "结构化输出"],
    notes: "纯文本旗舰，代码/推理类任务首选",
  },
  {
    id: "deepseek/bailian/deepseek-v4-flash-0731",
    provider: "deepseek",
    name: "DeepSeek V4 Flash",
    inputModalities: ["text"],
    contextWindow: 1_000_000,
    speedTier: "fast",
    qualityTier: "mid",
    strengths: ["速度快", "推理不错"],
  },
  {
    id: "glm-5.3",
    provider: "zai",
    name: "GLM-5.3",
    inputModalities: ["text"],
    contextWindow: 1_000_000,
    speedTier: "medium",
    qualityTier: "high",
    strengths: ["中文写作", "指令遵循"],
    notes: "智谱最新版",
  },
  {
    id: "glm-5.2",
    provider: "zai",
    name: "GLM-5.2",
    inputModalities: ["text"],
    contextWindow: 1_000_000,
    speedTier: "medium",
    qualityTier: "high",
    strengths: ["中文写作", "指令遵循", "稳定"],
    notes: "当前主会话默认模型",
  },
  {
    id: "glm-5.1",
    provider: "zai",
    name: "GLM-5.1",
    inputModalities: ["text"],
    contextWindow: 200_000,
    speedTier: "fast",
    qualityTier: "budget",
    strengths: ["轻量任务"],
    notes: "旧版，200K 上下文",
  },
  {
    id: "minimax/bailian/MiniMax-M3",
    provider: "minimax",
    name: "MiniMax-M3",
    inputModalities: ["text"],
    contextWindow: 1_000_000,
    speedTier: "medium",
    qualityTier: "mid",
    strengths: ["长文本处理"],
  },
];

// ======================== 硬约束过滤（客观条件，非决策）========================

export interface TaskConstraints {
  /** 任务必需的输入模态（硬约束：模型必须支持，否则无法执行） */
  requiredModalities?: string[];
  /** 预估输出长度（硬约束：排除输出上限不够的模型） */
  estimatedOutputTokens?: number;
  /** 需要的最低上下文窗口（硬约束） */
  minContextWindow?: number;
  /** 明确排除的模型（如已知某模型当前不稳定） */
  excludeModels?: string[];
}

/**
 * 应用硬约束，返回可用候选集
 * 注意：这只是"物理可行"过滤，不是选择。
 * 选择由 Agent 在候选集上做判断。
 */
export function filterCandidates(constraints: TaskConstraints): ModelInfo[] {
  let candidates = [...MODEL_REGISTRY];

  if (constraints.requiredModalities?.length) {
    candidates = candidates.filter((m) =>
      constraints.requiredModalities!.every((mod) => m.inputModalities.includes(mod)),
    );
  }

  if (constraints.estimatedOutputTokens) {
    candidates = candidates.filter(
      (m) => !m.maxOutputTokens || m.maxOutputTokens >= constraints.estimatedOutputTokens!,
    );
  }

  if (constraints.minContextWindow) {
    candidates = candidates.filter((m) => m.contextWindow >= constraints.minContextWindow!);
  }

  if (constraints.excludeModels?.length) {
    candidates = candidates.filter((m) => !constraints.excludeModels!.includes(m.id));
  }

  return candidates;
}

// ======================== 决策上下文（供 Agent 判断）========================

export interface DecisionContext {
  /** 任务描述（Agent 已知） */
  taskDescription: string;
  /** 硬约束过滤后的候选模型 */
  candidates: ModelInfo[];
  /** 候选数 */
  candidateCount: number;
  /** 提示：如果候选为空，说明硬约束无法满足 */
  infeasible?: boolean;
}

/**
 * 为 Agent 生成决策上下文
 *
 * 用法（编排器视角）：
 *   const ctx = buildDecisionContext("需要分析架构图并生成文字说明", { requiredModalities: ["image"] });
 *   // ctx.candidates = 所有支持图片的模型
 *   // 然后 Agent（我）结合具体情况判断：
 *   //   - 图里有中文 → Qwen/GLM 系中文能力强
 *   //   - 需要精确的视觉细节 → Qwen3.8 Max
 *   //   - 只是简单看图分类 → Flash 级就够
 *   //   - 输出要很长 → 排除 kimi-k2.6
 *   // 最终由 Agent 定夺
 */
export function buildDecisionContext(
  taskDescription: string,
  constraints: TaskConstraints,
): DecisionContext {
  const candidates = filterCandidates(constraints);
  return {
    taskDescription,
    candidates,
    candidateCount: candidates.length,
    infeasible: candidates.length === 0,
  };
}

/**
 * 生成给 Agent 看的模型候选清单（紧凑格式）
 * 编排器 spawn 子 Agent 时把这段附在决策提示里
 */
export function formatCandidatesForPrompt(candidates: ModelInfo[]): string {
  if (candidates.length === 0) return "（无可用模型满足硬约束）";
  return candidates
    .map((m) => {
      const parts = [
        `${m.id}`,
        `名称:${m.name}`,
        `模态:${m.inputModalities.join("+")}`,
        `质量:${m.qualityTier}`,
        `速度:${m.speedTier}`,
        `上下文:${m.contextWindow >= 1_000_000 ? "1M" : `${m.contextWindow / 1000}K`}`,
      ];
      if (m.maxOutputTokens) parts.push(`输出上限:${m.maxOutputTokens}`);
      parts.push(`特长:${m.strengths.join("/")}`);
      if (m.notes) parts.push(`备注:${m.notes}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

// ======================== Agent 决策（编排时执行）========================

/**
 * 编排 Agent 的模型决策流程
 *
 * 这个函数体现"Agent 自主选择"：
 * 1. 先用硬约束筛出物理可行的候选集
 * 2. Agent（编排器 LLM）结合任务具体语境判断最优
 * 3. 判断依据不限于注册表数据——可以包括：
 *    - 任务语言（中文任务偏好中文强的模型）
 *    - 任务领域（代码/数学偏好 DeepSeek）
 *    - 上一轮同类任务的实际表现（经验记忆）
 *    - 当前时间敏感度（赶时间选快模型）
 *    - 输出格式要求（JSON 结构化偏好指令遵循强的）
 *
 * 注意：实际运行时，这个"判断"由编排器 LLM（我）执行，
 * 代码里的 defaultChoice 只是无可参考信息时的兜底。
 */
export function agentDecideModel(
  taskDescription: string,
  constraints: TaskConstraints,
  defaultChoice?: string, // Agent 判断后的最终决定
): string {
  const ctx = buildDecisionContext(taskDescription, constraints);

  if (ctx.infeasible) {
    throw new Error(
      `任务无法执行——没有模型满足硬约束：${taskDescription}\n` +
      `约束：${JSON.stringify(constraints)}`,
    );
  }

  // Agent 明确指定了选择（经过自主判断）
  if (defaultChoice) {
    const chosen = ctx.candidates.find((m) => m.id === defaultChoice);
    if (!chosen) {
      throw new Error(
        `Agent 选择的 ${defaultChoice} 不满足任务硬约束或不在注册表中`,
      );
    }
    console.log(
      `[ModelDecision] Agent 自主选择 ${chosen.name} (${chosen.id}) — 任务: ${taskDescription}`,
    );
    return chosen.id;
  }

  // 无明确判断时的兜底：候选集中质量最高的
  // （实际运行中 Agent 应该总是给出明确判断，这只是防御性代码）
  const tierOrder = { flagship: 4, high: 3, mid: 2, budget: 1 };
  const fallback = [...ctx.candidates].sort(
    (a, b) => tierOrder[b.qualityTier] - tierOrder[a.qualityTier],
  )[0];

  console.log(
    `[ModelDecision] 使用兜底选择 ${fallback.name} (${fallback.id}) — ` +
    `建议 Agent 下次给出明确判断`,
  );
  return fallback.id;
}

// ======================== 能力查询 ========================

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}

export function supportsModality(modelId: string, modality: string): boolean {
  return getModelInfo(modelId)?.inputModalities.includes(modality) ?? false;
}

export function listAllModels(): ModelInfo[] {
  return [...MODEL_REGISTRY];
}
