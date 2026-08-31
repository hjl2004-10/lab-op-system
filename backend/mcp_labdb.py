"""YANG11 labdb MCP 服务器：AI 专属的受限数据库通道。

由 backend.app 在每轮 AI 回复时以会话属主身份拉起（stdio JSON-RPC）。
安全模型（AI 的"专用数据库账户"）：
- 数据连接独立且带 authorizer：users / sessions / ai_* / attachments / system_meta 表在连接层即被拒绝，
  密码哈希与会话数据对 AI 永不可见；
- AI 只能调用下列类型化工具（无裸 SQL），每个工具按会话属主的角色与归属范围做服务端强制；
- create_account（仅 admin）通过独立代码路径 INSERT 新账号（bcrypt、查重），绝不 UPDATE 已有行，
  任何工具都不提供修改已有账号密码的能力。
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import sqlite3
import string
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app import (  # noqa: E402
    DB_PATH,
    hash_password,
    manager_person_scope,
    manager_task_scope,
    user_can_see_task,
)

PROTOCOL_VERSION = "2024-11-05"
DENIED_TABLES = {"users", "sessions", "attachments", "system_meta",
                 "ai_conversations", "ai_messages", "ai_settings"}
PERSON_COLORS = [
    ("#2f6db3", "#dbeafe", "#93c5fd"), ("#f59e0b", "#fef3c7", "#fcd34d"),
    ("#10b981", "#d1fae5", "#6ee7b7"), ("#8b5cf6", "#ede9fe", "#c4b5fd"),
    ("#ef4444", "#fee2e2", "#fca5a5"), ("#0ea5e9", "#e0f2fe", "#7dd3fc"),
    ("#d946ef", "#fae8ff", "#f5d0fe"), ("#14b8a6", "#ccfbf1", "#5eead4"),
]


def today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _authorizer(action: int, arg1: str | None, arg2: str | None,
                dbname: str | None, source: str | None) -> int:
    # SQLITE_READ/INSERT/UPDATE/DELETE 的 arg1 均为表名；ATTACH 一律拒绝
    if action in (sqlite3.SQLITE_READ, sqlite3.SQLITE_INSERT,
                  sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE):
        if (arg1 or "").lower() in DENIED_TABLES:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_ALTER_TABLE,
                  sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_CREATE_TABLE):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


class LabDb:
    """受限数据访问层：身份由可信的 backend 进程通过命令行传入。"""

    def __init__(self, person_id: str, name: str, role: str) -> None:
        self.person_id = person_id
        self.name = name
        self.role = role
        self.conn = sqlite3.connect(DB_PATH, timeout=10)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA busy_timeout = 10000")
        self.conn.set_authorizer(_authorizer)

    # ---- payload 读写 ----

    def read_state(self, immediate: bool = False) -> dict[str, Any]:
        if immediate:
            # 写工具专用：取写锁后读最新数据，读-改-写全程原子（防并发丢更新）
            self.conn.execute("BEGIN IMMEDIATE")
        row = self.conn.execute("SELECT payload FROM app_state WHERE id = 1").fetchone()
        if not row:
            raise ToolError("系统尚未初始化，没有可操作的数据")
        return json.loads(row["payload"])

    def write_state(self, payload: dict[str, Any]) -> None:
        self.conn.execute(
            "UPDATE app_state SET payload = ?, revision = revision + 1, "
            "updated_at = ?, updated_by = ? WHERE id = 1",
            (json.dumps(payload, ensure_ascii=False),
             datetime.now(UTC).isoformat(), self.person_id),
        )
        self.conn.commit()

    # ---- scope ----

    def scope(self, payload: dict[str, Any]) -> dict[str, Any]:
        people = payload.get("people", [])
        if self.role == "student":
            task_owners = {self.person_id}
            visible_people = [p for p in people if p.get("id") == self.person_id]
        else:
            task_owners = manager_task_scope(people, {"personId": self.person_id, "role": self.role})
            person_ids = manager_person_scope(people, {"personId": self.person_id, "role": self.role})
            visible_people = [p for p in people if p.get("id") in person_ids]
        return {"task_owners": task_owners, "people": visible_people}

    def viewer(self) -> dict[str, Any]:
        return {"personId": self.person_id, "role": self.role}

    def visible_tasks(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        task_owners = self.scope(payload)["task_owners"]
        return [
            t for t in payload.get("tasks", [])
            if t.get("assigneeId") in task_owners and user_can_see_task(t, self.viewer())
        ]

    def find_visible_task(self, payload: dict[str, Any], task_id: str) -> dict[str, Any]:
        for task in self.visible_tasks(payload):
            if task.get("id") == task_id:
                return task
        raise ToolError(f"任务 {task_id} 不存在或不在你的权限范围内")

    def resolve_assignee(self, payload: dict[str, Any], assignee: str | None) -> dict[str, Any]:
        task_owners = self.scope(payload)["task_owners"]
        candidates = [p for p in self.scope(payload)["people"] if p.get("id") in task_owners]
        if self.role == "student":
            # 学生只能建/改给自己的任务：明确指定了别人则拒绝
            self_person = candidates[0] if candidates else {"id": self.person_id, "name": self.name}
            if assignee and assignee not in (self_person.get("id"), self_person.get("name"),
                                             self_person.get("username")):
                raise ToolError(f"学生只能把任务分配给自己，不能指定「{assignee}」")
            return self_person
        if not assignee:
            return {"id": self.person_id, "name": self.name}  # 默认给当前用户自己
        for person in candidates:
            if assignee in (person.get("id"), person.get("name"), person.get("username")):
                return person
        raise ToolError(f"负责人「{assignee}」不在你的权限范围内（可用成员见 list_students 结果）")


class ToolError(Exception):
    pass


def next_task_id(payload: dict[str, Any]) -> str:
    max_id = 100
    for task in payload.get("tasks", []):
        match = re.fullmatch(r"t(\d+)", str(task.get("id", "")))
        if match:
            max_id = max(max_id, int(match.group(1)))
    return f"t{max_id + 1}"


def valid_date(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ToolError(f"{field} 需为 YYYY-MM-DD 格式，收到：{text or '空'}")
    return text


def task_summary(task: dict[str, Any], people_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    assignee = people_by_id.get(task.get("assigneeId", ""), {})
    return {
        "id": task.get("id"),
        "name": task.get("name"),
        "assignee": assignee.get("name", task.get("assigneeId")),
        "startDate": task.get("startDate"),
        "endDate": task.get("endDate"),
        "progress": task.get("progress", 0),
        "description": task.get("description", ""),
        "isPrivate": bool(task.get("isPrivate")),
        "records": len(task.get("progressHistory", [])),
    }


# ---- 工具实现 ----

def tool_list_students(db: LabDb, args: dict[str, Any]) -> str:
    payload = db.read_state()
    scope = db.scope(payload)
    counts: dict[str, int] = {}
    for task in payload.get("tasks", []):
        counts[task.get("assigneeId", "")] = counts.get(task.get("assigneeId", ""), 0) + 1
    students = [
        {
            "id": p.get("id"), "name": p.get("name"),
            "username": p.get("username", ""), "role": p.get("role"),
            "tasks": counts.get(p.get("id", ""), 0),
        }
        for p in scope["people"]
    ]
    if db.role == "student":
        return json.dumps({"self": students[0] if students else None}, ensure_ascii=False)
    return json.dumps({"students": students}, ensure_ascii=False)


def tool_list_tasks(db: LabDb, args: dict[str, Any]) -> str:
    payload = db.read_state()
    people_by_id = {p.get("id", ""): p for p in payload.get("people", [])}
    tasks = db.visible_tasks(payload)
    assignee = args.get("assignee")
    if assignee:
        tasks = [t for t in tasks if assignee in
                 (t.get("assigneeId"), people_by_id.get(t.get("assigneeId", ""), {}).get("name"),
                  people_by_id.get(t.get("assigneeId", ""), {}).get("username"))]
    keyword = str(args.get("keyword") or "").strip()
    if keyword:
        tasks = [t for t in tasks if keyword in str(t.get("name", "")) or keyword in str(t.get("description", ""))]
    status = args.get("status") or "all"
    if status == "active":
        tasks = [t for t in tasks if t.get("progress", 0) < 100]
    elif status == "completed":
        tasks = [t for t in tasks if t.get("progress", 0) >= 100]
    tasks = sorted(tasks, key=lambda t: str(t.get("startDate", "")))
    return json.dumps(
        {"tasks": [task_summary(t, people_by_id) for t in tasks]}, ensure_ascii=False
    )


def tool_get_task(db: LabDb, args: dict[str, Any]) -> str:
    task_id = str(args.get("task_id") or "").strip()
    if not task_id:
        raise ToolError("缺少 task_id")
    payload = db.read_state()
    task = db.find_visible_task(payload, task_id)
    people_by_id = {p.get("id", ""): p for p in payload.get("people", [])}
    detail = task_summary(task, people_by_id)
    detail["progressHistory"] = [
        {
            "id": r.get("id"), "date": r.get("date"), "author": r.get("author"),
            "currentProgress": r.get("currentProgress"),
            "mainProblems": r.get("mainProblems"),
            "solutions": r.get("solutions"),
            "attachments": [a.get("name") for a in r.get("attachments", [])],
            "replies": [
                {"author": reply.get("author"), "date": reply.get("date"), "content": reply.get("content")}
                for reply in r.get("replies", [])
            ],
        }
        for r in task.get("progressHistory", [])
    ]
    return json.dumps(detail, ensure_ascii=False)


def tool_create_task(db: LabDb, args: dict[str, Any]) -> str:
    name = str(args.get("name") or "").strip()
    if not name:
        raise ToolError("任务名称不能为空")
    payload = db.read_state(immediate=True)
    assignee = db.resolve_assignee(payload, args.get("assignee"))
    is_private = bool(args.get("is_private"))
    if is_private and assignee.get("id") != db.person_id:
        raise ToolError("仅自己名下的任务可设为私有")
    start = valid_date(args.get("start_date") or today(), "开始日期")
    end_default = (datetime.now(UTC) + timedelta(days=7)).strftime("%Y-%m-%d")
    end = valid_date(args.get("end_date") or end_default, "结束日期")
    if end < start:
        raise ToolError(f"结束日期（{end}）不能早于开始日期（{start}）")
    progress = max(0, min(100, int(args.get("progress") or 0)))
    task = {
        "id": next_task_id(payload),
        "name": name,
        "assigneeId": assignee.get("id"),
        "startDate": start,
        "endDate": end,
        "progress": progress,
        "description": str(args.get("description") or ""),
        "detail": {"currentProgress": "", "mainProblems": "", "solutions": ""},
        "rating": 0,
        "order": len(payload.get("tasks", [])),
        "isMilestone": False,
        "progressHistory": [],
    }
    if is_private:
        task["isPrivate"] = True
    if progress >= 100:
        task["archivedAt"] = today()
    payload.setdefault("tasks", []).append(task)
    db.write_state(payload)
    return json.dumps({"created": True, "task": {"id": task["id"], "name": name,
                           "assignee": assignee.get("name"), "startDate": start, "endDate": end}},
                      ensure_ascii=False)


def tool_update_task(db: LabDb, args: dict[str, Any]) -> str:
    task_id = str(args.get("task_id") or "").strip()
    if not task_id:
        raise ToolError("缺少 task_id")
    payload = db.read_state(immediate=True)
    task = db.find_visible_task(payload, task_id)
    updates: dict[str, Any] = {}
    if "name" in args and str(args.get("name") or "").strip():
        updates["name"] = str(args["name"]).strip()
    if args.get("start_date"):
        updates["startDate"] = valid_date(args["start_date"], "开始日期")
    if args.get("end_date"):
        updates["endDate"] = valid_date(args["end_date"], "结束日期")
    start = updates.get("startDate", task.get("startDate"))
    end = updates.get("endDate", task.get("endDate"))
    if end < start:
        raise ToolError(f"结束日期（{end}）不能早于开始日期（{start}）")
    if "description" in args:
        updates["description"] = str(args.get("description") or "")
    if args.get("progress") is not None:
        progress = max(0, min(100, int(args["progress"])))
        updates["progress"] = progress
        updates["archivedAt"] = today() if progress >= 100 else task.get("archivedAt")
    if "is_private" in args:
        is_private = bool(args.get("is_private"))
        if is_private and task.get("assigneeId") != db.person_id:
            raise ToolError("仅自己名下的任务可设为私有")
        updates["isPrivate"] = is_private
    if args.get("assignee"):
        assignee = db.resolve_assignee(payload, args["assignee"])
        updates["assigneeId"] = assignee.get("id")
    if not updates:
        raise ToolError("没有提供任何要修改的字段")
    for task_ in payload["tasks"]:
        if task_.get("id") == task_id:
            task_.update(updates)
            break
    db.write_state(payload)
    return json.dumps({"updated": True, "task_id": task_id, "fields": sorted(updates)},
                      ensure_ascii=False)


def tool_delete_task(db: LabDb, args: dict[str, Any]) -> str:
    task_id = str(args.get("task_id") or "").strip()
    if not task_id:
        raise ToolError("缺少 task_id")
    payload = db.read_state(immediate=True)
    db.find_visible_task(payload, task_id)  # 校验存在与权限
    payload["tasks"] = [t for t in payload.get("tasks", []) if t.get("id") != task_id]
    for index, task in enumerate(payload["tasks"]):
        task["order"] = index
    db.write_state(payload)
    return json.dumps({"deleted": True, "task_id": task_id}, ensure_ascii=False)


def tool_add_progress_record(db: LabDb, args: dict[str, Any]) -> str:
    task_id = str(args.get("task_id") or "").strip()
    current = str(args.get("current_progress") or "").strip()
    if not task_id or not current:
        raise ToolError("缺少 task_id 或 current_progress")
    payload = db.read_state(immediate=True)
    max_record = 1000
    for task in payload.get("tasks", []):
        for record in task.get("progressHistory", []):
            match = re.fullmatch(r"ph(\d+)", str(record.get("id", "")))
            if match:
                max_record = max(max_record, int(match.group(1)))
    record = {
        "id": f"ph{max_record + 1}",
        "date": today(),
        "author": db.name,
        "authorId": db.person_id,
        "currentProgress": current,
        "mainProblems": str(args.get("main_problems") or ""),
        "solutions": str(args.get("solutions") or ""),
        "replies": [],
    }
    for task in payload["tasks"]:
        if task.get("id") == task_id:
            db.find_visible_task(payload, task_id)  # 权限复核
            task.setdefault("progressHistory", []).append(record)
            task["detail"] = {
                "currentProgress": current or task.get("detail", {}).get("currentProgress", ""),
                "mainProblems": str(args.get("main_problems") or "") or task.get("detail", {}).get("mainProblems", ""),
                "solutions": str(args.get("solutions") or "") or task.get("detail", {}).get("solutions", ""),
            }
            break
    else:
        raise ToolError(f"任务 {task_id} 不存在或不在你的权限范围内")
    db.write_state(payload)
    return json.dumps({"added": True, "task_id": task_id, "record_id": record["id"],
                       "date": record["date"]}, ensure_ascii=False)


def generate_password() -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(10))
        if (any(c.isupper() for c in password) and any(c.islower() for c in password)
                and any(c.isdigit() for c in password)):
            return password


def tool_create_account(db: LabDb, args: dict[str, Any]) -> str:
    if db.role != "admin":
        raise ToolError("仅管理员可通过 AI 创建账号")
    name = str(args.get("name") or "").strip()
    username = str(args.get("username") or "").strip()
    role = str(args.get("role") or "student").strip()
    if role not in ("student", "teacher"):
        raise ToolError("role 仅支持 student 或 teacher（管理员账号请在系统的账户管理中创建）")
    if not name or not username:
        raise ToolError("缺少 name 或 username（学号）")
    if not re.fullmatch(r"[A-Za-z0-9_-]{2,32}", username):
        raise ToolError("学号需为 2-32 位字母、数字、下划线或连字符")
    payload = db.read_state()
    if any(p.get("username") == username or p.get("id") == username for p in payload.get("people", [])):
        raise ToolError(f"学号 {username} 已存在")
    password = str(args.get("password") or "").strip() or generate_password()
    if not re.fullmatch(r"(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}", password):
        raise ToolError("初始密码需至少 8 位且含大写、小写字母和数字")
    phone = str(args.get("phone") or "").strip()
    if phone and not re.fullmatch(r"1[3-9]\d{9}", phone):
        raise ToolError("手机号需为大陆 11 位号码")
    # 账号写入走专用路径（独立连接、固定 INSERT，绝不修改已有行）。
    # 必须在数据连接 BEGIN IMMEDIATE 之前完成，否则两个连接互相等锁。
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        existing = conn.execute(
            "SELECT person_id FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
        if existing:
            raise ToolError(f"账号 {username} 已存在（不可覆盖已有账号）")
        conn.execute(
            "INSERT INTO users (person_id, username, name, role, password_hash, active, "
            "created_by, created_at, updated_at, phone) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
            (username, username, name, role, hash_password(password), db.person_id,
             datetime.now(UTC).isoformat(), datetime.now(UTC).isoformat(), phone),
        )
    # 重新以写锁读最新 payload 再追加成员（覆盖上面的临时快照）
    payload = db.read_state(immediate=True)
    if any(p.get("username") == username or p.get("id") == username for p in payload.get("people", [])):
        raise ToolError(f"学号 {username} 已存在")
    colors = PERSON_COLORS[len(payload.get("people", [])) % len(PERSON_COLORS)]
    payload.setdefault("people", []).append({
        "id": username, "username": username, "name": name, "role": role,
        "color": colors[0], "lightColor": colors[1], "borderColor": colors[2],
        "textColor": "#FFFFFF", "order": len(payload["people"]), "status": "active",
        "classIds": [], "createdBy": db.person_id,
    })
    db.write_state(payload)
    role_label = "教师" if role == "teacher" else "学生"
    return json.dumps({"created": True, "name": name, "username": username, "role": role,
                       "initial_password": password,
                       "note": f"{role_label}账号的初始密码仅此一次展示，请转告本人并建议尽快修改"},
                      ensure_ascii=False)


TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_students",
        "description": "列出当前用户权限范围内的成员（管理员/教师=自己与名下学生；学生=自己）",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_tasks",
        "description": "列出权限范围内的任务，可按负责人/关键词/状态过滤",
        "inputSchema": {"type": "object", "properties": {
            "assignee": {"type": "string", "description": "负责人姓名或学号（可选）"},
            "keyword": {"type": "string", "description": "任务名/备注关键词（可选）"},
            "status": {"type": "string", "enum": ["active", "completed", "all"]},
        }},
    },
    {
        "name": "get_task",
        "description": "查看任务详情（含全部进展记录、问题、解决思路与回复）",
        "inputSchema": {"type": "object", "required": ["task_id"], "properties": {
            "task_id": {"type": "string"},
        }},
    },
    {
        "name": "create_task",
        "description": "创建任务（负责人须在权限范围内；学生只能建给自己；日期缺省今天起一周）",
        "inputSchema": {"type": "object", "required": ["name"], "properties": {
            "name": {"type": "string"},
            "assignee": {"type": "string", "description": "负责人姓名或学号，缺省为当前用户"},
            "start_date": {"type": "string", "description": "YYYY-MM-DD"},
            "end_date": {"type": "string", "description": "YYYY-MM-DD"},
            "description": {"type": "string"},
            "progress": {"type": "number", "description": "0-100，缺省 0"},
            "is_private": {"type": "boolean", "description": "仅自己可见（只能用于自己的任务）"},
        }},
    },
    {
        "name": "update_task",
        "description": "修改权限范围内任务的字段（名称/日期/描述/进度/负责人/私有标记）",
        "inputSchema": {"type": "object", "required": ["task_id"], "properties": {
            "task_id": {"type": "string"},
            "name": {"type": "string"}, "assignee": {"type": "string"},
            "start_date": {"type": "string"}, "end_date": {"type": "string"},
            "description": {"type": "string"}, "progress": {"type": "number"},
            "is_private": {"type": "boolean"},
        }},
    },
    {
        "name": "delete_task",
        "description": "删除权限范围内的任务（含其全部进展记录，不可恢复）",
        "inputSchema": {"type": "object", "required": ["task_id"], "properties": {
            "task_id": {"type": "string"},
        }},
    },
    {
        "name": "add_progress_record",
        "description": "以当前用户身份在任务下添加一条进展记录（进展/问题/解决思路）",
        "inputSchema": {"type": "object", "required": ["task_id", "current_progress"], "properties": {
            "task_id": {"type": "string"},
            "current_progress": {"type": "string"},
            "main_problems": {"type": "string"},
            "solutions": {"type": "string"},
        }},
    },
    {
        "name": "create_account",
        "description": "（仅管理员）创建学生或教师账号；初始密码缺省自动生成，仅创建时返回一次。绝不修改已有账号",
        "inputSchema": {"type": "object", "required": ["name", "username"], "properties": {
            "name": {"type": "string"},
            "username": {"type": "string", "description": "学号/账号"},
            "role": {"type": "string", "enum": ["student", "teacher"], "description": "缺省 student"},
            "password": {"type": "string", "description": "初始密码（可选，缺省自动生成）"},
            "phone": {"type": "string", "description": "绑定手机号，大陆 11 位（可选，用于找回密码）"},
        }},
    },
]

TOOL_FUNCTIONS = {
    "list_students": tool_list_students,
    "list_tasks": tool_list_tasks,
    "get_task": tool_get_task,
    "create_task": tool_create_task,
    "update_task": tool_update_task,
    "delete_task": tool_delete_task,
    "add_progress_record": tool_add_progress_record,
    "create_account": tool_create_account,
}


def handle(request: dict[str, Any], db: LabDb) -> dict[str, Any] | None:
    method = request.get("method", "")
    request_id = request.get("id")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": request_id, "result": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "labdb", "version": "1.0.0"},
        }}
    if method == "notifications/initialized" or method.startswith("notifications/"):
        return None
    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        params = request.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}
        function = TOOL_FUNCTIONS.get(tool_name)
        if function is None:
            return {"jsonrpc": "2.0", "id": request_id, "result": {
                "content": [{"type": "text", "text": f"未知工具：{tool_name}"}], "isError": True}}
        try:
            text = function(db, arguments)
            return {"jsonrpc": "2.0", "id": request_id, "result": {
                "content": [{"type": "text", "text": text}]}}
        except ToolError as error:
            try:
                db.conn.rollback()
            except sqlite3.Error:
                pass
            return {"jsonrpc": "2.0", "id": request_id, "result": {
                "content": [{"type": "text", "text": f"操作被拒绝：{error}"}], "isError": True}}
        except Exception as error:  # noqa: BLE001 — 工具层兜底，把错误文本回给 AI
            try:
                db.conn.rollback()
            except sqlite3.Error:
                pass
            return {"jsonrpc": "2.0", "id": request_id, "result": {
                "content": [{"type": "text", "text": f"工具执行出错：{error}"}], "isError": True}}
    if request_id is not None:
        return {"jsonrpc": "2.0", "id": request_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"}}
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True, help="会话属主 personId（由后端传入）")
    parser.add_argument("--name", required=True)
    parser.add_argument("--role", required=True, choices=["admin", "teacher", "student"])
    args = parser.parse_args()
    db = LabDb(args.user, args.name, args.role)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        response = handle(request, db)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
