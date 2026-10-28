# WORKCHECKLIST 发布记录（2026-10-28，Asia/Shanghai）

- 架构：GitHub Pages 前端 + Supabase；旧 Apps Script 实验未部署。
- 最新运行配置 revision 1 已 enforced，允许 api.github.com、api.supabase.com、tigerbearai-jpg.github.io，实际 GitHub API 请求成功。
- 当前会话未提供 Cloud Environment Onboarding: Setup 技能或草稿配置读写工具，无法建立或保存新草稿；未重试过期草稿。results-receiver.actions.githubusercontent.com 仍未获准，CLI 日志下载被拒；通过已授权 GitHub 连接器成功读取日志。
- 密钥检查成功：https://github.com/tigerbearai-jpg/WORKCHECKLIST/actions/runs/40620286538 。SUPABASE_ACCESS_TOKEN 有效，具备目标项目管理 SQL 权限；未读取或输出密钥。
- 生产迁移成功：https://github.com/tigerbearai-jpg/WORKCHECKLIST/actions/runs/40620353280 。校验已审核 SQL SHA256 3546a65965307d01577970b2c8705c74a5b266948f2c4df750146dff75b0f067，执行迁移并通过后置结构检查，保留原有多项目结构。
- 网站 PR #1 已按期望 head 5f53412f7f0bda4a75497a424950f5c2a322d6fe 合并，发布代码提交 73889ba4918eef1555bf1ea8e525a18897a468ea。
- 合并前重新运行 14 项真实前端／适配层／本地 PostgreSQL 测试全部通过，含匿名拒读和用户隔离；不是生产登录读写验收。
- Pages 部署：https://github.com/tigerbearai-jpg/WORKCHECKLIST-SITE/actions/runs/40620446370 。Pages build API 已为 built，提交为 73889ba4918eef1555bf1ea8e525a18897a468ea。普通网站首页与 index.html、work-model.js、supabase-adapter.js、work-sync.js 已逐字节核对匹配发布版本，包含工作操作台及要素管理。Actions build 和 deploy 均已完成，整个部署工作流 conclusion=success。
- 没有生产测试账户，未使用真实业务记录进行登录读写验收。后续不能将静态资源发布和 schema 检查当作真实登录验收。
