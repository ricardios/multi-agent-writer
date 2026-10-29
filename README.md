# 多 Agent 协作写作系统 v3.0 — 可分发跨平台版

## 快速部署（三步）

1. **获取**：`git clone https://github.com/ricardios/multi-agent-writer`，或在仓库页 Code → Download ZIP 后解压到任意位置
2. **部署**：确保你的 agent 平台能访问解压后的文件，然后对你的 agent 说一句：**"帮我部署 multi-agent-writer"**——它会读取 `deploy/INSTALL.md` 自动完成：环境预检（spawn/python3/git/网络）→ 探测平台事实（技能目录/模型清单）→ 生成 platform.json → 安装核心文件与 humanizer-zh → 初始化数据种子 → 冒烟测试
3. **使用**：部署完成后说 **"多agent写文章"** 即可触发全流程

兼容性：单模型平台（退化为唯一选择）、无子会话 spawn 能力的平台（serial-roleplay 串行降级）、缺 web-search（降级到平台自带搜索）均有对应降级路径，详见 `deploy/INSTALL.md`。部署后随时增减平台技能/模型，系统自适应，无需重新部署。

<img width="1192" height="1684" alt="multi-agent-writer技能一页纸-预览" src="https://github.com/user-attachments/assets/af043c11-fd4f-4d62-bfb7-6d98a7affd92" />

## v3.0 变更（2026-10-29）

1. **平台适配层**：platform.json manifest 只存"怎么找"不存"有什么"——技能靠运行时扫描（天然兼容增减），模型每次任务开始探测刷新（三层兕底：探测→快照→默认），spawn 失败自动剔除重选，全部失效才降级直写；新模型无标注按保守策略首用，运行表现记入经验库形成动态标注。
2. **分发包**：`deploy/pack.ps1` 生成干净 zip（白名单制 + 红线校验，绝不夹带部署者私有数据）；对方平台说"帮我部署 multi-agent-writer"，agent 读 `deploy/INSTALL.md` 执行向导（preflight 预检→探测平台事实→生成 manifest→安装核心+humanizer-zh→空白种子初始化→冒烟测试）。
3. **兼容性覆盖**：单模型平台（退化为唯一选择）／无 spawn 平台（serial-roleplay 串行降级）／无 web-search（降级到平台自带搜索）／编码差异（GBK 坑按 manifest 开关）。
4. **升级通道**：git 仓库分发；升级只覆盖 SKILL.md/src/deploy，platform.json 与 experience/style-profile 为部署方私有数据永不覆盖。

## v2.10 变更（2026-10-29）

1. **修改模式（Amendment）**：终稿交付后的用户修改意见不再由主 agent 直改，改走多 Agent 流程：意见解析成结构化指令清单（UserChangeRequest）并向用户确认一次；trivial/minor/major 分级路由（trivial 纯错字才直改；minor 走 user-revision-agent；major 按需回 Research/Analysis/分章重写）；Review 复验 + 维度回归对比（任一维度回退超 3 分即报告，防"改好一处弄坏另一处"）；局部润色（changedSections 只润修改段落）；旧终稿留档 article-final-v{K}.md；同类修改意见反复出现提示写入偏好档案。pipeline-state 增加 amendmentActive/finalVersion/userChangeRequests，修改会话沿用原配置。

## v2.9 变更（2026-10-29）

1. **humanizer-zh 润色改为必问配置项**：任务配置时必问是否启用（polishEnabled，默认使用），带说明与 token 成本；未安装时自动从 GitHub（https://github.com/op7418/Humanizer-zh）安装到 SKILLs 目录（技能面板自动显示），安装失败不阻塞流程；Polish 环节按配置开关执行，原自动跳过条件退役。

## v2.8 变更（2026-10-29）

1. **用户写作偏好档案（优化项 #6，收官）**：style-profile.md 持久化用户偏好（目标读者/语言风格/禁用表达/结构偏好/常用标签/默认字数档）。任务配置时已设字段默认带出（"这次…"当次覆盖，"以后都…"写入档案）；buildStyleDirective() 生成风格指令注入 Writer / ChapterWriter / Revise / Polish，Polish 强制规避禁用表达；档案为空不注入。与经验库分工：经验库记录系统怎么跑得好，偏好档案记录用户要什么。

## v2.7 变更（2026-10-29）

1. **长文分章并行写作（优化项 #5，自动触发）**：大纲章节 >10 时自动启用 map-reduce——并行 spawn 单章 Writer（同一模型，风格一致优先，单章短不超时可用快速模型，直接绕开长文超时坑）；全部章节完成后旗舰统稿 Agent 章序校对/风格术语统一/去章间重复，失败缺章由统稿补写。断点续跑按 chapter-{NN}.md 文件存在性只补缺章。≤10 章保持串行路径。触发阈值 PARALLEL_WRITE_THRESHOLD=10。

## v2.6 变更（2026-10-29）

1. **分维度评分（改法A）**：ReviewResult 从单一总分拆为 5 维（facts/evidence/code/structure/language，加权 facts .3 / evidence .2 / structure .2 / language .2 / code .1）；低分维度驱动智能路由——evidence 低 → research，结构语言低 → 纯 revise；任一维度 <70 不得 approve。
2. **配置化双审（改法B，用户决策）**：任务开始时问质量档位（标准=单审 / 严格=双审，默认标准，不阻塞流程）；严格模式下并行 spawn 两个分域 Reviewer（不同模型）：fact-checker 出 facts/evidence/code + 来源抽查，reader-reviewer 出 structure/language + facts 交叉双保险；mergeDualReview 合并——decision 取严格票、issues 去重、facts 取较低分；deltaIssues 记入经验库量化双审价值。
3. **审核预算用尽行为**：maxReviews 用尽仍未 approve → 终稿照常交付 + 未解决 issue 清单如实报告用户。

## v2.5 变更（2026-10-29）

1. **中间产物走文件**：环节产物落盘 interim/ 目录，下游 Agent 只收文件路径 + 导航摘要；Writer 正文直接写盘、JSON 只回元数据。消除长文 JSON 转义/截断风险，revise 循环不再重传全文。
2. **断点续跑**：pipeline-state.json 状态机记录当前环节/版本/轮次；任务中断后从未完成环节恢复，不用全链路重跑。
3. **来源真实性抽查**：Reviewer 对核心 claim 用 web_fetch 抽查 2-3 个来源，mismatch 记 high severity issue 且不能 approve；结果记入 ReviewResult.sourceChecks。
4. **经验库闭环**：experience.md 沉淀每次运行的模型/耗时/成败与新教训；任务开始注入决策，任务结束追加记录；模型选择从静态参考变为数据驱动。

## 核心理念

**每个 Agent 拥有完整的自主权：选模型、用技能，都自己判断。**

```
用户输入主题
    │
    ▼
编排 Agent（部署平台的主会话）
  ├─ 为每个环节选定初始模型（可被子 Agent 覆盖建议）
  └─ 不预判全部技能——交给子 Agent 自主发现
    │
    ├─ Research Agent（自主：检索类技能任用）
    ├─ Analysis Agent（自主：分析类技能任用）
    ├─ Writer Agent（自主：配图等技能任用）
    ├─ Polish Agent（humanizer-zh 润色）
    ├─ Reviewer Agent（自主：验证类技能任用）
    └─ Output / Publish（格式转换、发布技能任用）
```

## 三层自主权

| 层级 | 谁决策 | 决策内容 |
|------|--------|---------|
| 编排层 | 编排 Agent（我） | 流程结构、环节顺序、初始模型 |
| 模型层 | 每个子 Agent | 结合任务语境选最优模型（12 个候选） |
| 技能层 | 每个子 Agent | 扫描发现全部已安装技能，自主调用（70+ 且持续增长） |

## 技能自主权实现

每个子 Agent 的任务 prompt 都嵌入一段**技能自主使用指令**：

```
你可以自主发现和使用已安装的技能：
1. 技能目录：SKILLs/ 和内置 resources/cfmind/skills/
2. 用法：exec 列出目录 → read 读取 SKILL.md → 按其指引调用
3. 原则：某技能能提升任务质量就用，不必等编排器指示
```

效果举例：
- Writer 写到架构章节 → 自己发现 diagram-maker → 生成配图
- Reviewer 看到文中性能数据要验证 → 自己发现 data-analysis → 核对数字
- Research 发现主题涉及内部知识库 → 自己发现对应检索技能 → 补充内部资料检索
- 任何新技能装好后 → 子 Agent 下次扫描自动发现 → 自主决定用不用

## 动态发现机制（skill-registry 核心）

```typescript
// Agent 的"技能雷达"——运行时扫描，自动感知新技能
discoverSkills(): DiscoveredSkill[]
// 扫描两个目录的全部子文件夹
// 读取每个 SKILL.md 的 frontmatter（name + description）
// 返回完整技能清单
```

新技能安装 → 零代码改动 → 下次运行时 Agent 自动发现。

## 完整流程（6 环节 + 审核循环）

```
① Research ── 模型自选 + 检索技能自用
② Analysis ── 模型自选 + 分析技能自用
③ Writing ─── 模型自选 + 配图等技能自用
④ Polish ──── humanizer-zh 去除 AI 痕迹（默认启用，可跳过）
⑤ Review ──── 模型自选 + 验证技能自用
   ├─ approve → ⑥
   ├─ revise → 回 ③（重写后重润色）
   └─ research → 回 ①（补充检索）
⑥ Output/Publish ── 格式转换（docx/pdf/pptx）、发布（飞书）技能自用
```

## 项目结构

```
multi-agent-writer/
├── src/
│   ├── model-registry/index.ts   # 12 模型注册 + 硬约束过滤 + 决策支持
│   ├── skill-registry/index.ts   # ★ v2.4：动态发现 + 自主权指令生成
│   ├── experience/index.ts        # ★ v2.5：经验库读写 + 注入简报生成
│   ├── schemas/index.ts           # Agent 间数据契约（v2.5：DraftMeta/PipelineState/sourceChecks）
│   └── prompts/index.ts           # 6 类 Agent prompt（v2.5：文件传递 + 抽查 + 经验注入）
├── output/
│   ├── draft-v1.md
│   └── article-final.md
└── README.md
```

技能侧对应文件：`SKILLs/multi-agent-writer/SKILL.md`（编排执行指南）+ `SKILLs/multi-agent-writer/experience.md`（经验库，运行时持续更新）。

## 设计原则汇总

1. **注册表是数据不是规则**：模型表、技能标注只提供事实，决策在 Agent
2. **发现优于枚举**：技能运行时扫描目录，新装即生效
3. **自主权下放**：子 Agent 对自己的任务最了解，技能使用权在它手里
4. **MCP 同理预留**：MCP_REGISTRY 空位已留，接入后同样走 Agent 自主决策
5. **经验优于静态**（v2.5）：模型选择参考运行沉淀的教训，越用越准
