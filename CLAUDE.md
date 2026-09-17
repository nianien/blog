# Blog 项目指南

@AGENTS.md

项目规范统一维护在根目录 `AGENTS.md`，执行任务前读取该文件。若当前工具不展开上述引用，直接打开文件读取。

- 工程结构、启动与发布说明见 `README.md` 和 `scripts/README.md`
- 三个项目技能的实现统一放在 `.agents/skills/`
- `.claude/skills/` 保留 Claude 的技能入口与脚本兼容入口，按各入口指引加载对应实现
- 更新公共规范与技能时修改唯一实现，不在本文件复制另一套规则
