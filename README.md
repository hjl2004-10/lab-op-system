# YANG11 实验室进度协作台

面向实验室教师和学生的甘特图进度管理系统。前端保留原项目的任务甘特图、进度记录、评价、成员管理、档案、历史和导入导出功能；后端新增统一登录、SQLite 持久化和角色权限控制。

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS、shadcn/ui
- 后端：FastAPI、SQLite、Pydantic
- 认证：bcrypt 密码哈希、服务端会话、HttpOnly Cookie

## 默认账号

| 身份 | 账号 | 姓名 | 初始密码 |
| --- | --- | --- | --- |
| 管理员 | `admin` | 杨老师 | `xzcXZC123` |

登录时，管理员输入管理员账号，学生输入学号。原型中的两名示例学生会保留为临时账号 `p2`、`p3`，但不会保留旧弱密码；管理员登录后需要在“账户管理”中为其填写真实学号并设置新密码。

所有新密码至少 8 位，并且必须同时包含大写字母、小写字母和数字。管理员可以新增学生或管理员账户、修改账号/学号和姓名、重置密码、停用、启用或删除账户。当前登录账户不能停用或删除。

生产部署前可通过环境变量 `GANTT_ADMIN_PASSWORD` 指定首次数据库迁移时的管理员密码；完成迁移后，服务重启不会覆盖管理员后来设置的密码。

## 本地开发

前端：

```bash
npm install
npm run dev
```

后端：

```bash
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.app:app --reload --port 8000
```

Windows PowerShell 使用 `.venv\Scripts\pip.exe` 和 `.venv\Scripts\uvicorn.exe`。Vite 开发服务器运行在 `http://localhost:3000`，并自动把 `/api` 转发到 `http://localhost:8000`。

## 生产运行

```bash
npm run build
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

FastAPI 会直接托管 `dist` 中的前端，访问 `http://localhost:8000` 即可。SQLite 数据默认保存在 `data/gantt.db`，可通过 `GANTT_DATA_DIR` 指定其他目录；HTTPS 部署时设置 `GANTT_SECURE_COOKIE=1`。

## 权限边界

- 管理员可查看并管理全部账户、任务、评价和档案管理字段。
- 学生从后端只能取得自己的任务和自己的公开档案数据。
- 学生保存时，后端只合并该学生名下的任务与公开档案，不接受人员表、其他成员任务或教师专用档案字段的修改。
- 密码不再进入前端业务数据、备份文件或同步码。
