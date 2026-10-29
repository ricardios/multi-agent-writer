# multi-agent-writer 经验库（空白种子）

> 部署初始化用。任务开始必读（注入模型选择和子 Agent prompt），任务结束必写（追加运行记录和新教训）。
> 体积控制：运行日志只留最近 20 条；文件超 30KB 时编排器整理——日志聚合为统计摘要，经验条目全部保留。

## 运行日志

| 日期 | 主题 | 各环节（模型/耗时/状态） | 决策链 | 终分 |
|---|---|---|---|---|

## 经验条目

### 模型选择类（M#）

- M1【高置信】Writer 环节慎用 fast 级模型写长文——长文实测易超时；长文写作/审核用旗舰模型，或直接编排器写盘降级。
- M2【高置信】输出超 8192 tokens 的任务排除小输出上限模型（部署时在 manifest.models[].outputLimitTokens 标注）。
- M3【高置信】读图任务必须选多模态模型（manifest.models[].modalities 含 image）。
- M4【参考】信息提取、格式化、短摘要类任务用 fast 级模型即可。
- M5【规则】新平台/新模型首用：无能力标注时按保守策略（当纯文本、先给短任务），运行后表现记入本库形成动态标注。
- M6【规则】spawn 失败的模型：从候选剔除并记入本库，自动换下一个；全部失效才降级为编排器直写。

### 流程与环境类（F#）

- F1【视平台】原部署平台（Windows/GBK 终端）遇特殊 Unicode 字符报 UnicodeEncodeError 但结果已部分返回——取已输出内容，不要判定为失败。是否适用看 platform.json 的 environment.encoding。
- F2【高置信】Reviewer 倾向把"缺关键证据"误判为 revise——若 Analysis 的 needsMoreResearch=true 或 issue 明显指向证据缺失，编排器应上调为 research。
- F3【规则】引用格式多样（[S1]/（S1）/S1、S2），统一用正则 `[\[（(]((?:S\d+)(?:\s*[,，、;；]\s*S\d+)*)[\]）)]` 提取校验。
- F4【规则】中间产物走文件不走 prompt：正文 write 到 interim/draft-v{N}.md，JSON 只回元数据，防长文 JSON 转义/截断。
- F5【规则】来源抽查中无公开 URL 的来源标 unverifiable，不算错误；unreachable 不算失败但要在 feedback 说明可信度局限。
- F6【规则】双审模式：两个分域 Reviewer 用不同模型（避开同模型盲点）；deltaIssues（读者视角独有发现数）随运行记录写入本库；任一维度 <70 不得 approve。
- F7【规则】分章并行：全部章节 Writer 用同一模型（风格一致优先）；统稿用旗舰模型且负责补写缺章；断点续跑按 chapter-{NN}.md 文件存在性只补缺章。
- F8【v3.0 规则】平台适配：模型清单每次任务开始按 manifest.modelDiscovery 探测刷新，manifest.models 仅为探测失败的快照兜底；技能增减靠运行时目录扫描天然兼容；关键依赖（humanizer-zh、web-search）用前检查，缺失按 dependencies 降级说明处理。
