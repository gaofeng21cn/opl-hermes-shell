# OPL Hermes Shell Archive

本仓的 One Person Lab App 产品角色已经退休。仓库只保留完整 Git 历史和源代码作为
read-only provenance；App 产品 truth 留在 `one-person-lab-app`。

- 不再进行 upstream intake、候选推进、显式 replay、功能维护或兼容适配。
- 不再承担 build、package、smoke、install、CI、巡检或 release 义务。
- 既有 `candidate` 文件名、包名和命令名只是历史实现标识，不能恢复候选资格。
- 重新打开本仓需要新的 One Person Lab App 明确产品决策。

归档终态的机器检查入口：`npm run validate:archive`。

<!-- CODEGRAPH_START -->
## CodeGraph

- 本仓库使用本地 `.codegraph/` 索引；该目录不得纳入 Git。
- 定义、调用、影响范围和代码路径等结构检索优先使用 CodeGraph；字面文本检索使用 `rg`。
- 索引缺失或过期时运行 `codegraph init .` 或 `codegraph sync .`。
<!-- CODEGRAPH_END -->
