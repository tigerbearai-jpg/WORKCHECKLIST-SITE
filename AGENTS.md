# WORKCHECKLIST-SITE 项目约定

- 当前网站为 GitHub Pages + Supabase，网址 https://tigerbearai-jpg.github.io/WORKCHECKLIST-SITE/ 。本仓库是实际发布前端。先读 README.md 和 docs/PROJECT_CONTEXT.md，再核对远端最新提交与发布状态，不以旧迁移 README 推断线上架构。
- 中文交流。用户已批准工作操作台、叠加筛选、状态展示、分类多选、编辑返回位置、进展与备注、要素管理方案。其他业务逻辑调整先确认。
- 保留现有多项目关联、Supabase Auth + RLS、GPT 工作同步、事项软删除、SOP、历史日志及考核导出。不得用旧 Apps Script 实验覆盖此仓库。
- 不输出、提交真实业务数据、用户凭据或 secret/service role key。前端只用 publishable key。匿名拒读和用户隔离必须验证。
- 修改后给出验证结果；先 PR 审核，再由用户手动批准数据库迁移与网站部署。main 可能直接发布 Pages，开发改动使用独立分支。
- 保护其他任务的本地改动；不擅自创建 Git worktree。交接时分别记录本地、远端分支、PR、数据库迁移和实际部署状态。
