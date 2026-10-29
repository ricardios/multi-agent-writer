# multi-agent-writer 部署向导（v3.0）

> 分发仓库：https://github.com/ricardios/multi-agent-writer
> 获取方式：git clone，或在仓库页 Code → Download ZIP 后解压。
> 本文档由**对方平台的部署 agent** 阅读**并执行**。用户只需说一句"帮我部署 multi-agent-writer"。
> 原则：manifest 只存"怎么找"不存"有什么"（技能靠运行时扫描，模型每次任务开始探测刷新）——
> 部署后用户随时增减技能/模型，系统自适应，无需重新部署。

## 第 0 步：读取分发包

确认拿到以下内容（分发包根目录）：
- `SKILL.md`（平台无关的编排指南）
- `src/`（契约与 prompt 模板参考实现）
- `deploy/`：`platform-template.json`、`seeds/experience-seed.md`、`seeds/style-profile-seed.md`、本向导

## 第 1 步：Preflight 环境预检（逐项检查，如实记录）

| 检查项 | 方法 | 不满足时的处理 |
|---|---|---|
| 文件系统读写 | read/write 一个临时文件 | 无此能力则无法部署，告知用户并停止 |
| exec 执行命令 | 跑一个无害命令（如查版本） | 无 exec 则技能安装/脚本调用受限，告知用户并停止 |
| 子会话 spawn | 探测平台是否有 spawn 子 agent 能力 | 无 → spawnMethod 设 "serial-roleplay"（单会话串行扮演各角色，中间产物仍走文件），告知用户降级模式已启用 |
| python3 | `python3 --version` | 无 → web-search 脚本不可用，记录降级方案 |
| git | `git --version` | 无 → humanizer-zh 无法用 clone 安装，尝试直接下载 zip 或请用户手动安装 |
| 网络 | 能否访问 github.com | 无 → 跳过技能安装，告知用户装好后再说"多agent写文章"时会自动重试 |

## 第 2 步：探测平台事实

1. **技能目录**：找出本平台安装技能的目录（一个或多个）。探测方式：问用户 / 查平台文档 / 列出平台配置中的技能路径
2. **模型清单**：获取本平台可用模型。探测方式（按序尝试）：
   - 平台有模型列表工具 → 用它（modelDiscovery.method = "runtime-tool"，在 note 写明工具名）
   - 无工具 → 请用户提供（method = "manual"）
   - 每个模型标注：tier（flagship/fast/standard）、modalities（是否支持 image）、outputLimitTokens（输出上限，不知道留 null）、note
   - **单模型平台完全支持**：manifest.models 只写一项即可，系统自动退化为"唯一选择"
3. **环境**：OS 类型、终端编码（Windows 默认 GBK 坑适用）、python3/git 有无

## 第 3 步：生成 platform.json

复制 `deploy/platform-template.json`，填入第 1-2 步的探测结果，写到：
`<skillsDir>/multi-agent-writer/platform.json`（与本技能的 SKILL.md 同目录）。

## 第 4 步：安装核心文件

1. `SKILL.md` → `<skillsDir>/multi-agent-writer/SKILL.md`
2. `src/` → `<skillsDir>/multi-agent-writer/src/`（参考实现，供编排器查阅契约）
3. 数据种子：`seeds/experience-seed.md` → `<skillsDir>/multi-agent-writer/experience.md`；
   `seeds/style-profile-seed.md` → `<skillsDir>/multi-agent-writer/style-profile.md`
   （**注意**：这两个文件是空白种子——绝不携带任何部署者的个人数据）

## 第 5 步：安装关键依赖

1. **humanizer-zh（必须）**：检查 `<skillsDir>/humanizer-zh/SKILL.md` 是否存在；
   不存在 → `git clone https://github.com/op7418/Humanizer-zh`，确保 `<skillsDir>/humanizer-zh/SKILL.md` 就位
   （仓库许可见其 LICENSE，分发时保留声明）。
   装好后技能面板自动显示。失败 → 如实告知，不阻塞——运行时 Polish 前还会再检查重试
2. **web-search（Research 依赖）**：检查是否可用；不可用 → 在 platform.json.dependencies.webSearch.fallback 写明降级方式
   （如"用平台自带搜索工具替代"），Research 环节自动改用

## 第 6 步：冒烟测试（必做，部署成功 ≠ 运行正常）

向用户确认后，跑一篇迷你文章验收：
- 主题任选轻量题材，要求 500 字左右（大纲 ≤3 章，走串行路径，省 token）
- 标准审查模式、润色使用（顺带验证 humanizer-zh）
- 验证全链路：Research → Analysis → Writing → Polish → Review → Output 产物落盘
- 失败项按 stageLog 定位修复后重跑（interim/ 支持断点续跑）

## 第 7 步：交付

向用户报告：preflight 结果、生成的 manifest 摘要（模型数/技能目录/降级模式）、冒烟测试结果，
然后告知触发方式："说『多agent写文章』即可使用"。

## 升级方式

分发主干：https://github.com/ricardios/multi-agent-writer 。
升级时：拉取/下载新版 SKILL.md / src / deploy 覆盖旧文件；
**platform.json、experience.md、style-profile.md 属于部署方私有数据，永不覆盖**。
manifest 结构变更时按新版模板补填字段（探测方法不变，只是补充声明）。

## 权限提示

本系统的子 Agent 拥有技能自主权（可 exec 调用任何已安装技能的脚本）。
企业/受限环境部署前，请确认平台权限策略允许子会话执行命令；受限平台建议在
manifest.modelDiscovery.note 中记录权限限制，编排器会选择合规的降级路径。
