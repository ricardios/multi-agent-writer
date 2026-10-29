---
name: multi-agent-writer
description: |
  多 Agent 协作写作系统：Research/Analysis/Writer/Polish/Reviewer 多类子 Agent
  协作生成高质量文章，含审核修订循环、分维度评分、可选双审分域对抗（标准/严格档位）、
  humanizer-zh 润色必问项（未安装自动装）、长文分章并行写作（大纲 >10 章自动 map-reduce）、
  智能模型选择（12 模型按任务自主决策）、技能自主调用（运行时扫描已安装技能）、
  来源真实性抽查、断点续跑（含按章恢复）、经验库闭环、用户写作偏好档案。
  触发场景：用户说"多agent写文章"、"用多agent系统写"、"协作写作"，
  或要求带研究、审核循环、多轮修订的高质量文章生成；
  终稿交付后用户提出修改意见时触发修改模式（结构化指令+分级路由+维度回归对比）。
version: 3.0
author: 谭傲
created_at: 2026-10-27
---

# 多 Agent 协作写作系统

收到写作任务后，按以下流程编排多个子 Agent 完成文章。参考实现代码位于
本技能目录下的 `src/`（model-registry / skill-registry / experience / schemas / prompts / platform / style-profile，随技能一起部署）。

## 任务配置收集（v2.6，流程开始前一次问全）

收到写作任务后，spawn 前**一次性**向用户收集配置（AskUserQuestion 或直接对话）：
1. 质量档位：**标准**（单审，默认）或 **严格**（双审分域对抗，token 成本翻倍）——必问
2. humanizer-zh 润色：**使用**（默认）或 **跳过**——必问（说明见下）
3. 字数要求、目标受众、文风偏好——先读用户写作偏好档案（见下节），已设字段作为默认值带出，用户确认或覆盖；未设字段用通用默认
4. 用户不回或说"随便"→ 全部默认（含档案已设值），**绝不阻塞流程等配置**
5. 断点续跑任务跳过询问，沿用 pipeline-state.json 的 reviewMode / polishEnabled

**质量档位询问必须带模式说明**（用户不应需要猜"标准/严格"是什么意思），参考话术：

> 审核模式选哪种？
> 1. **标准**（默认）：1 个审核 Agent 全维度审一遍——事实/证据/结构/语言/代码 5 个维度评分，并抽查 2-3 个引用来源的真实性。审核环节 token 消耗 1×。
> 2. **严格**（双审）：2 个不同模型的审核 Agent 并行，一个专审事实/证据/引用+来源真实性抽查，另一个专审结构/语言/可读性，结果合并去重。能互相暴露单模型盲点、抓住更多问题，适合重要文章；审核环节 token 约 2×。
> 不回复或"随便"则用标准。

## humanizer-zh 润色选项（v2.9，必问项）

**询问前必须检查技能安装状态**：
- 检查 `<skillsDir>/humanizer-zh/SKILL.md`（skillsDir 按 platform.json 定位）是否存在
- **未安装且用户选择使用** → 先安装：`exec: git clone https://github.com/op7418/Humanizer-zh`，确认仓库内 SKILL.md 位置，确保最终位于 `SKILLs\humanizer-zh\SKILL.md`（必要时把 SKILL.md 及附属文件移到该标准位置）；装入 SKILLs 目录后用户技能面板自动显示，无需其他操作
- 安装失败（网络等）→ 如实告知用户，Polish 环节跳过（stageLog 记 skipped + note），流程继续不阻塞
- 已安装 → 直接询问

**询问必须带模式说明**，参考话术：

> 润色选项：是否用 humanizer-zh 技能做人性化润色（去 AI 痕迹）？
> 1. **使用**（默认）：初稿完成后由润色 Agent 按 humanizer-zh 规则处理——句式多样化、去套话空话、让表达更像人写的自然中文；适合绝大多数文章。Polish 环节 token 消耗 1×。
> 2. **跳过**：适合正式公文、API 参考文档等不需要口语化处理的文体，或你想保留初稿原始风格；省去润色环节的时间和 token。
> 不回复默认使用。

用户选择记录为 polishEnabled，写入 pipeline-state.json，断点续跑沿用；Polish 环节按此开关执行，不再由编排器自动判断跳过（用户显式选择优先）。

## 用户写作偏好档案（v2.8）

档案文件：本技能目录下的 `style-profile.md`（与 SKILL.md、platform.json 同目录）

字段：目标读者、语言风格、禁用表达、结构偏好、常用标签/分类、默认字数档。

生命周期：
1. **读**（任务配置收集时）：已设字段作为默认值带出，用户确认或当次覆盖；未设字段走通用默认
2. **注入**（Writing 和 Polish 环节）：编排器用 buildStyleDirective() 生成"用户风格要求"段，拼入 Writer / ChapterWriter / Revise / Polish 的任务 prompt（用户临时覆盖标注【当次覆盖，优先级最高】）；档案无已设字段时不注入
3. **写**（配置时/用户主动）：用户说"以后都……"才更新档案对应字段；说"这次……"仅当次生效不写档案；Polish 环节对禁用表达清单强制规避

与经验库分工：经验库记录【系统】怎么跑得好（模型/流程），偏好档案记录【用户】要什么（风格/受众）。

## 执行流程（6 环节 + 审核循环）

```
① Research ── 并行检索 → search-results.md → 子Agent → research.json
② Analysis ── 大纲设计 → analysis.json
③ Writing ─── 全文写入 draft-v{N}.md（revise 就地递增版本）
④ Polish ──── humanizer-zh → polished-v{N}.md
⑤ Review ──── 审核 → review-v{N}.json
   ├─ approve → ⑥
   ├─ revise → 定向修订（回 ③，版本+1 后重润色再审核）
   └─ research → 回 ①（补充检索后全链路重跑，researchRounds+1）
⑥ Output ──── 终稿保存 + 执行报告 + 经验库写入
```

循环控制：`maxReviews=3`（最多审核 3 次）、`maxResearchRounds=2`（最多补充研究 2 轮），防止死循环。审核预算用尽仍未 approve：不再循环，终稿照常交付，但必须把未解决 issue 清单如实报告用户，由用户决定是否接受。

## 中间产物走文件（v2.5 核心规则）

**大产物不进 prompt，一律落盘 interim/ 目录，下游 Agent 只收文件路径 + 一行导航摘要。**

interim/ 目录（建在当次任务文件夹 output/ 下；无任务文件夹时用
本项目的 `output/interim/`，按部署位置定位）：

```
interim/
├── pipeline-state.json   # 断点续跑状态机（见下）
├── search-results.md     # ① 原始搜索结果
├── research.json        # ① ResearchResult
├── analysis.json        # ② AnalysisResult
├── draft-v{N}.md        # ③ 草稿正文（Writer 直接 write，不进 JSON）
├── draft-meta-v{N}.json # ③ Writer 元数据（title/tags/usedSourceIds/contentPath）
├── chapters/            # ③ 分章并行模式（>10章）各章产物 chapter-{NN}.md
├── polished-v{N}.md     # ④ 润色后正文
├── review-v{N}.json     # ⑤ ReviewResult（双审模式下为合并结果）
├── review-v{N}-fact.json    # ⑤ 双审：事实视角原始结果
└── review-v{N}-reader.json  # ⑤ 双审：读者视角原始结果
```

理由：长文塞 JSON 的 content 字段会转义出错/截断；revise 循环重传全文浪费 token；子 Agent 崩溃产物即丢。

各环节传递方式：
- Research Agent：给 search-results.md 路径 + "关键词N路/结果约N条"摘要
- Analysis Agent：给 research.json 路径 + "findings N条/sources N个/gaps N条"摘要
- Writer Agent：给 research.json + analysis.json 路径 + 大纲章节标题列表（一行一章）
- Polish Agent：给草稿路径 + 润色输出路径
- Reviewer Agent：给草稿路径 + research.json 路径
- Writer 输出契约：正文 write 到 draft-v{N}.md，JSON 只回元数据（contentPath 指向该文件）
- revise 循环：只给 draft 文件 + 上次 review 文件 + issue 摘要，定向修订、原地写回，版本号 +1

**DraftResult 契约（v2.5，正文在文件里）：**
```json
{
  "title": "标题", "description": "描述",
  "tags": ["标签"], "categories": ["分类"],
  "contentPath": "interim/draft-v1.md",
  "usedSourceIds": ["S1"],
  "notes": ["编辑说明"]
}
```
兼容：子 Agent 若仍内联返回 content，编排器把正文写盘后归一为此格式。

## 断点续跑（pipeline-state.json）

每个环节完成后，编排器用 write 更新 interim/pipeline-state.json：

```json
{
  "topic": "主题",
  "runDir": "当次 output 目录绝对路径",
  "currentStage": "review",
  "reviewMode": "standard",
  "draftVersion": 2,
  "reviewCount": 1,
  "researchRounds": 1,
  "finished": false,
  "stageLog": [{ "stage": "research", "status": "ok", "model": "...", "durationSec": 45, "artifact": "interim/research.json" }],
  "updatedAt": "2026-10-29T14:00:00+08:00"
}
```

恢复规则（任务开始时编排器先检查）：
1. interim/pipeline-state.json 存在且 `finished=false` → 断点续跑：校验 `currentStage` 上游产物文件存在，从该环节继续
2. 存在且 `finished=true` → 旧任务已完成，新建目录重新开始
3. 不存在 → 全新流程
4. 恢复时若上游产物缺失（被清理），从最早的缺失环节重跑
5. 每个环节实际使用的模型/耗时/成败记入 stageLog（终稿报告和经验库写入都用它）

## 环节一：Research（检索）

1. **web-search 用前检查（v3.0）**：确认 web-search 技能可用；不可用 → 按 platform.json.dependencies.webSearch.fallback 降级（平台自带搜索/浏览器工具替代），Research 照常进行
2. 编排器将主题拆为 3-5 个搜索关键词
3. 用 web-search 技能**并行**执行多路搜索：
   `exec: python3 <web-search技能目录>\scripts\search.py "关键词"`
   （Windows/GBK 终端报 UnicodeEncodeError 时结果通常已部分返回，可用 --json 重试或忽略报错取已输出内容；是否适用看 platform.json 的 environment.encoding）
4. 搜索结果汇总写入 `interim/search-results.md`，spawn research-agent（read 该文件，产出 research.json）

**ResearchResult 契约：**
```json
{
  "topic": "主题",
  "findings": [{ "claim": "事实", "sourceId": "S1", "confidence": "high|medium|low" }],
  "sources": [{ "id": "S1", "title": "标题", "url": "URL或null", "verified": true }],
  "gaps": ["证据缺口"],
  "summary": "研究总结"
}
```

## 环节二：Analysis（分析）

spawn analysis-agent（read research.json，产出 analysis.json）。

**AnalysisResult 契约：**
```json
{
  "topic": "主题",
  "keyPoints": [{ "point": "论点", "sourceIds": ["S1"], "importance": "high" }],
  "outline": [{ "heading": "章节标题", "description": "描述", "sourceIds": ["S1"] }],
  "risks": [{ "description": "风险", "sourceIds": ["S1"] }],
  "missingEvidence": ["缺失证据"],
  "needsMoreResearch": false,
  "summary": "分析总结"
}
```

## 环节三：Writing（写作，v2.7 起自动双路径）

大纲章节数 ≤10：**串行路径**——spawn 单个 writer-agent（read research.json + analysis.json，正文 write 到 draft-v{N}.md，回元数据 JSON；注入 styleDirective）。
若子 Agent 写长文超时失败，**编排器直接用主模型生成并写盘**（已验证的降级路径），stageLog 记 degraded。

大纲章节数 >10：**分章并行路径（map-reduce，自动触发，无需问用户）**：
1. **map**：编排器按大纲并行 spawn 每章一个 chapter-writer，产物 interim/chapters/chapter-{NN}.md（NN 两位编号）；单章短不超时，可选快速模型；**全部章节必须用同一模型**（风格一致性优先，避免统稿负担失控）；每章注入 styleDirective
2. 每章 Writer 只写本章：知道全文大纲、前后章标题，开头衔接前章、结尾为后章留口；不总结全文
3. **reduce**：全部章节完成后 spawn stitcher-agent 统稿（旗舰模型）：章序校对、风格/人称/术语统一、去章间重复、修过渡；**写作失败的缺章由统稿 Agent 基于大纲补写**；输出 draft-v{N}.md + 汇总元数据
4. 断点续跑：按 chapter-{NN}.md 文件存在性判断，**只补缺失章**后重统稿；串行路径仍按 draft 文件判断
5. 并行 spawn 数量过大时分批（每批 4-6 个），批间用 sessions_yield 等完成
6. writingMode（serial/parallel）记入 pipeline-state.json，revise 循环在当前 draft 上定向修订（revise 不再分章）

## 环节四：Polish（润色，v2.9 起配置驱动）

polishEnabled=true（默认）：spawn polish-agent：先 read 完整读取
`<skillsDir>/humanizer-zh/SKILL.md`（按 platform.json 定位）
作为工作指南，read 草稿文件，润色后 write 到 polished-v{N}.md，回复质量评分 JSON；
注入 styleDirective（禁用表达清单强制规避）。

polishEnabled=false：跳过本环节（stageLog 记 skipped + 用户选择），Review 直接审 draft-v{N}.md。
配置时若技能未安装且用户选择使用，先按安装流程装好再继续（见 humanizer-zh 润色选项节）。

## 环节五：Review（审核）

按任务配置的审查模式执行（标准=单审 / 严格=双审，未配置默认单审）。

**维度评分（v2.6，单审双审通用）**：
- facts = 事实准确性 + 引用一致性
- evidence = 证据充分性
- code = 代码正确性（无代码章节 null）
- structure = 结构完整性
- language = 语言可读性（已润色，不评"是否像 AI"）
- 加权总分：facts .3 / evidence .2 / structure .2 / language .2 / code .1（code 为 null 时归一化）
- 任一维度 <70 时不得 approve；低分维度必须在 issues 有对应记录

**单审模式**：spawn reviewer-agent（read 草稿 + research.json，产出 review-v{N}.json，5 维全出 + 来源抽查）。

**双审模式（严格档位）**：**并行 spawn 两个分域 Reviewer**：
- fact-checker：出 facts/evidence/code + 来源真实性抽查，写 review-v{N}-fact.json
- reader-reviewer：出 structure/language + facts 交叉双保险（只从读者直觉记 issue，不核实来源），写 review-v{N}-reader.json
- 编排器用 mergeDualReview 合并：decision 取严格票（research > revise > approve）；issues 按 description 去重；facts 取两者较低分，其余各取各域；sourceChecks 取事实侧
- deltaIssues（读者视角独有发现数）记入 stageLog 并写入经验库——多次运行后用数据判断双审值不值
- 两个 Reviewer 用不同模型（避开同一模型盲点）

**来源真实性抽查（单审和双审事实侧必做）**：
1. 从 findings 中选被草稿引用且 confidence=high 的核心 claim，最多抽 3 条
2. 有 URL 的来源用 web_fetch 抓取核对：支持=match；矛盾=mismatch（记 high severity issue）；无法访问=unreachable（如实记录，不算失败）
3. url=null 的来源标 unverifiable，不算错误

**ReviewResult 契约：**
```json
{
  "decision": "approve|revise|research",
  "score": 78,
  "dimensionScores": { "facts": 80, "evidence": 70, "code": null, "structure": 85, "language": 75 },
  "issues": [{ "severity": "high|medium|low", "description": "描述", "suggestedFix": "建议" }],
  "sourceChecks": [{ "sourceId": "S1", "claim": "被抽查的陈述", "result": "match|mismatch|unreachable|unverifiable", "note": "说明" }],
  "feedback": "总反馈"
}
```

业务规则：非 approve 必须有 issue；有 high severity issue、sourceChecks 有 mismatch 或任一维度 <70 不能 approve；
缺关键证据必须 research（不降级为 revise）；Analysis 的 needsMoreResearch=true 时编排器可将 revise 上调为 research。
维度分数驱动的路由：evidence 分低 → research；事实分高但 structure/language 低 → 纯 revise（不浪费研究轮）。

revise → Writer 定向修订（只改问题段落，不重写全文，draft-v{N}.md 原地更新、版本+1，优先修低分维度的 issue），重润色再审核。
research → 回环节一补充检索，researchRounds+1。

## 模型选择（v3.0：manifest 驱动 + 运行时探测 + 失效容错）

**候选来源（三层兕底，每次任务开始刷新）**：
1. **探测优先**：按 platform.json 的 modelDiscovery.method 获取当前可用模型清单（平台有列表工具就调，没有就凭本次会话/经验库判断；清单可能因用户中途增减模型而变化，不要依赖记忆）
2. **快照兕底**：探测无结果 → 用 platform.json 的 models 部署时快照
3. **保底**：两者皆无 → 仅用编排器默认模型（spawn 不指定 model）

platform.json 与本 SKILL.md 同目录；无它时按平台默认行为执行（技能自主权规则不变）。

**硬约束（能力约束，与平台无关，必须满足）**：
- 任务需要读图 → 模型 modalities 必须含 image
- 输出超 8192 tokens → 排除 outputLimitTokens 不足的模型

**选择流程**：读经验库相关条目 → 在刷新后的候选上应用硬约束 → 结合任务语境自主判断。
新模型无标注时按保守策略（当纯文本、先给短任务），运行后表现记入经验库形成动态标注。

**失效容错**：spawn 失败/超时 → 该模型从候选剔除并记经验库 M 条目 → 自动换下一个候选 → 全部失效才降级为编排器直写。

**spawn 方式**：platform.json 的 spawnMethod=subagent（默认，并行子会话）
或 serial-roleplay（单会话串行扮演各角色，中间产物仍走文件，各环节交接靠 interim/ 落盘）。

## 经验库闭环（v2.5）

经验库文件：本技能目录下的 `experience.md`（与 SKILL.md、platform.json 同目录，路径按 platform.json 的 skillsDirs 定位）

结构：`## 运行日志`（每次运行的环节/模型/耗时/成败/决策链/终分表）+ `## 经验条目`（模型选择类 M#、流程环境类 F#）。

**读（任务开始，Research spawn 前）**：
1. 编排器 read experience.md，将「经验条目」区注入模型选择决策
2. spawn 子 Agent 时把相关条目注入任务 prompt（如 Writer 注入"轻量模型超时"教训；不同角色注入相关条目）

**写（任务结束，Output 环节）**：
1. 追加运行记录到日志表：日期/主题/审查模式/各环节模型+耗时+状态（含降级标记）/决策链/终分/双审 delta（如有）
2. 本次新教训追加到经验条目区（带日期标记），格式：`- 【YYYY-MM-DD】<教训>`
3. 教训来源示例：某模型某环节超时/降级、Reviewer 误判模式、新发现的编码/格式坑、效果好的技能组合
4. pipeline-state.json 标记 finished 前完成写入（防重复记录）

**体积控制**：运行日志只保留最近 20 条；文件超 30KB 时整理——日志聚合为「模型×环节×成败」统计摘要，经验条目全部保留。

## 修改模式（Amendment，v2.10）

终稿交付后用户提出修改意见时，不再由主 agent 直改，改走以下流程：

```
用户修改意见
 │
① 意见解析：转成结构化修改指令清单（UserChangeRequest：id/target/change/reason/scope）
   向用户确认一次清单（防误解意图；用户不回则按解析结果执行）
 │
② 分级路由（按改动规模，判断标准与结果告知用户）
 ├─ trivial（错字/纯格式）→ 主 agent 直改 + 自查，不走多 Agent
 ├─ minor（局部措辞/个别段落）→ spawn user-revision-agent（注入 styleDirective + 上一版维度基线）
 └─ major（换论点/动结构/缺证据）→ 按需回上游：补 Research（researchRounds+1）/
     调 Analysis 大纲 / 受影响章节重写（>10 章自动分章并行）
 │
③ Review 复验（沿用原 reviewMode）+ 维度回归对比（v2.10 核心把关）
 ├─ compareDimensionScores：任一维度比上一版低超过 3 分 → 报告回退
 └─ 「修改在 X 维度引入回退」明确告知用户，由用户裁决（接受或再修）
 │
④ Polish（沿用原 polishEnabled；minor 修改传 changedSections 只润修改段落）
 │
⑤ 版本留档 + 偏好信号回流：
 ├─ 旧终稿改名 article-final-v{K}.md，新终稿覆盖 article-final.md
 ├─ pipeline-state：重新打开（amendmentActive=true、finished=false、draftVersion+1、finalVersion+1），
 │  修改完成后重新置 finished
 └─ 同类修改意见反复出现（≥2 次）→ 提示用户是否写入 style-profile 对应字段（源头减少下轮修改）
```

修改会话跳过初始配置询问，沿用原 reviewMode / polishEnabled / 偏好档案；
修改指令清单写入 pipeline-state.userChangeRequests（断点续跑恢复时沿用）。
trivial 是唯一例外：只有纯错字/格式才允许主 agent 直改，其余一律走多 Agent——修改质量不降级。

## 技能自主权（嵌入每个子 Agent 的任务 prompt）

```
你可以自主发现和使用已安装的技能：
1. 技能目录：按 platform.json 的 skillsDirs 定位（无 manifest 时用平台默认技能目录）
2. 用 exec 列目录 → read SKILL.md → 按其指引调用
3. 某技能能提升任务质量就用，不必等编排器指示；用了什么技能在输出中简要说明
```
技能增减天然兼容：清单每次运行时扫描目录，新装即发现、删除即不引用。

## 产出规范

1. 终稿保存为 `article-final.md`，初稿及各修订版保留在 interim/（draft-v{N}.md / polished-v{N}.md）
2. 保存到当次任务文件夹 output/（或本项目的 output/ 目录）
3. 向用户报告：全流程执行记录表（各环节模型/耗时/状态）、审查模式与维度分数表、Reviewer 决策链（revise→revise→approve）、修复的 issue 清单、来源抽查结果（match/mismatch/unreachable 计数）、双审 delta（严格模式下读者视角的独有发现数）、引用来源数、是否断点续跑、新写入经验库的教训
4. 经验库写入完成后才标记 pipeline-state.json finished

## 已知坑（实战验证，持续维护于经验库）

完整清单见经验库「经验条目」区。高频要点：
1. 轻量模型写长文超时 → Writer 用旗舰模型或编排器直写降级
2. web-search 在 GBK 终端报 UnicodeEncodeError → 结果已部分返回，取已输出内容
3. Reviewer 倾向把缺证据误判为 revise → 已强化决策规则；证据缺失明显时编排器上调为 research
4. 引用格式多样 → 用正则 `[\[（(]((?:S\d+)(?:\s*[,，、;；]\s*S\d+)*)[\]）)]` 统一提取校验

## 版本历史

- v3.0（2026-10-29）：平台适配层（platform.json manifest：只存发现方法不存清单；模型三层兕底：探测→快照→默认，失效容错剔除重选；技能目录参数化；web-search 用前检查降级；spawn 降级模式 serial-roleplay；分发包：INSTALL.md 部署向导 + 空白数据种子 + 打包脚本）
- v2.10（2026-10-29）：修改模式（Amendment）——用户改稿意见走多 Agent：意见解析成结构化指令清单+一次确认、trivial/minor/major 分级路由、维度回归对比防回退、局部润色、版本留档、偏好信号回流；修改不再由主 agent 直改（trivial 除外）
- v2.9（2026-10-29）：humanizer-zh 润色改为必问配置项（polishEnabled，带说明与 token 成本）；未安装时自动从 GitHub 安装（https://github.com/op7418/Humanizer-zh），装入 SKILLs 目录自动显示在技能面板；安装失败不阻塞流程
- v2.8（2026-10-29）：用户写作偏好档案（style-profile.md：配置默认带出、Writing/Polish 注入、临时覆盖与持久更新区分）
- v2.7（2026-10-29）：分章并行写作（大纲 >10 章自动 map-reduce：并行单章 + 旗舰统稿，缺章兜底补写，断点按章恢复）
- v2.6（2026-10-29）：分维度评分（5 维 + 加权 + 低分路由）；配置化双审（标准/严格档位、分域分工、facts 双查、严格票合并、delta 量化）；审核预算用尽行为
- v2.5（2026-10-29）：中间产物走文件 + 断点续跑；来源真实性抽查（sourceChecks）；经验库闭环
- v2.4（2026-10-27）：全员技能自主权 + 动态发现
- v2.3 及以前：静态注册表 + 编排器预判技能
