# 工作管理系统交接记录

2026-10-27（Asia/Shanghai）：本仓库 `tigerbearai-jpg/WORKCHECKLIST-SITE` 是用户实际使用的 GitHub Pages 前端，后端为 Supabase。开发和迁移资料另在 `tigerbearai-jpg/WORKCHECKLIST`。用户提供的网址为 https://tigerbearai-jpg.github.io/WORKCHECKLIST-SITE/ 。每次先核对远端和实际发布状态。

此前环境误停留在 WORKCHECKLIST 的旧快照，并在 `apps/work/` 产生 Apps Script 实验；该实验没有进入现用网站。不能将其测试结果或功能完成状态归到本仓库。

本次在发布仓库 main 的 `a0657b9` 上建立 `fix/workbench-filters-progress`，已实现用户确认的操作台状态切换、组合筛选、突出事项状态、分类多选、保留返回位置、进展联动与独立备注，以及 GPT 同步下方的要素管理。保留既有多项目关联、登录、GPT 同步、SOP 和考核 CSV。

验证：14 项真实前端／适配层／本地 PostgreSQL 测试通过，包括模拟 Supabase 查询传输下的 RLS 和用户隔离；不是生产 Supabase 验收。上线需先审核和执行 `database/202610270010_workbench.sql`，再批准合并发布分支，最后核对 Pages 部署和真实登录。未执行生产迁移，未发布到 main，未改真实记录。

继续任务：先核对本文件、README 和 Git 状态／远端；区分代码分支、PR、数据库迁移及网站实际部署，不能仅凭本地测试说用户网址已经有新功能。


## 2026-10-28 进展展示简化

工作操作台版本已完成生产迁移并发布，代码提交为 `73889ba`，迁移运行 https://github.com/tigerbearai-jpg/WORKCHECKLIST/actions/runs/40620353280 ，Pages 部署 https://github.com/tigerbearai-jpg/WORKCHECKLIST-SITE/actions/runs/40620446370 。上述 2026-10-27 的未发布描述为历史状态。

用户本次确认：删除独立进展说明输入框，只保留备注输入；当前进展显示目前进行中的步骤。没有进行中步骤时显示相应的未记录、待开始或全部完成状态；备注不拼入当前进展。历史 `latest_progress` 保留，保存备注或其他信息时不清空。无需新增数据库迁移，保留现有多项目关联、Auth、RLS、GPT 同步、历史日志与导出。


## 2026-10-28 事项紧急程度与步骤排序

分支 `feature/urgency-step-order` 基于已发布的 `f75a6fb`。用户明确紧急程度设置在每个工作事项上，不设置在所属项目上。新增或编辑事项时可选择紧急、急、正常，默认为正常；首页按此等级稳定排序，同级保持原有顺序。列表筛选及状态视图继续生效，项目关联不改变事项本身的紧急程度。

工作步骤增加上移／下移按钮，保存时更新ordinal，保留ID、状态、完成日期和其他步骤资料；取消不保存顺序。进展仍只显示当前进行中的步骤，备注独立。

新迁移只增加work_items.urgency非空字段及三级值约束，须在前端发布前执行并校验；保留RLS与业务记录。回归覆盖等级和步骤顺序持久化、筛选及原有多项目、Auth/RLS、GPT同步能力，不等于生产账户登录验收。
