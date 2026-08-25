from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import bcrypt
import openpyxl
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from urllib.parse import quote


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("GANTT_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "gantt.db"
ATTACHMENTS_DIR = DATA_DIR / "attachments"
MAX_ATTACHMENT_MB = int(os.getenv("GANTT_MAX_ATTACHMENT_MB", "50"))
ATTACHMENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
DIST_DIR = BASE_DIR / "dist"
SESSION_COOKIE = "yang11_session"
SESSION_DAYS = 7
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$")
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{2,32}$")

# ---- AI（Claude Code CLI）----
AI_SESSIONS_DIR = DATA_DIR / "ai-sessions"
CLAUDE_CLI = shutil.which("claude")
AI_TURN_TIMEOUT = int(os.getenv("GANTT_AI_TIMEOUT", "180"))
AI_MAX_CONCURRENT = int(os.getenv("GANTT_AI_CONCURRENCY", "4"))
AI_MAX_MESSAGE_CHARS = 16000


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_password_strength(password: str) -> str:
    if not PASSWORD_PATTERN.fullmatch(password):
        raise ValueError("密码至少 8 位，且必须包含大写字母、小写字母和数字")
    return password


def validate_username(username: str) -> str:
    value = username.strip()
    if not USERNAME_PATTERN.fullmatch(value):
        raise ValueError("账号或学号需为 2-32 位字母、数字、下划线或连字符")
    return value


@contextmanager
def database() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def merge_duplicate_tasks(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """v4 迁移：合并两个同 id 任务——以记录更全的为底，进展记录与回复按 id 并集。"""
    base, other = (
        (a, b) if len(a.get("progressHistory", [])) >= len(b.get("progressHistory", [])) else (b, a)
    )
    merged = dict(base)
    history: dict[str, dict[str, Any]] = {}
    for record in base.get("progressHistory", []):
        history[record.get("id", "")] = record
    for record in other.get("progressHistory", []):
        record_id = record.get("id", "")
        if record_id not in history:
            history[record_id] = record
            continue
        replies = {r.get("id", ""): r for r in history[record_id].get("replies", [])}
        for reply in record.get("replies", []):
            replies.setdefault(reply.get("id", ""), reply)
        history[record_id] = {**history[record_id], "replies": list(replies.values())}
    merged["progressHistory"] = list(history.values())
    return merged


def initialize_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    AI_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                person_id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
                password_hash TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                person_id TEXT NOT NULL REFERENCES users(person_id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS system_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                size INTEGER NOT NULL,
                uploader TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL DEFAULT 0,
                model TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                person_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '新对话',
                claude_session_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT 'done' CHECK (state IN ('pending', 'done', 'error')),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
                ON ai_messages(conversation_id, id);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
        if "username" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN username TEXT")
        if "created_by" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN created_by TEXT")
        db.execute("UPDATE users SET username = person_id WHERE username IS NULL OR username = ''")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)")

        seed_users = (
            ("p1", "admin", "杨老师", "admin", os.getenv("GANTT_ADMIN_PASSWORD", "xzcXZC123")),
            ("p2", "p2", "杨嘉鑫", "student", secrets.token_urlsafe(24)),
            ("p3", "p3", "蔡雨萱", "student", secrets.token_urlsafe(24)),
        )
        for person_id, username, name, role, password in seed_users:
            db.execute(
                """
                INSERT OR IGNORE INTO users
                    (person_id, username, name, role, password_hash, active, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)
                """,
                (person_id, username, name, role, hash_password(password), now_iso(), now_iso()),
            )

        version_row = db.execute("SELECT value FROM system_meta WHERE key = 'schema_version'").fetchone()
        schema_version = int(version_row["value"]) if version_row else 1
        if schema_version < 2:
            db.execute(
                "UPDATE users SET username = 'admin', password_hash = ?, updated_at = ? WHERE person_id = 'p1'",
                (hash_password(os.getenv("GANTT_ADMIN_PASSWORD", "xzcXZC123")), now_iso()),
            )
            for person_id in ("p2", "p3"):
                db.execute(
                    "UPDATE users SET username = ?, password_hash = ?, updated_at = ? WHERE person_id = ?",
                    (person_id, hash_password(secrets.token_urlsafe(24)), now_iso(), person_id),
                )
            db.execute(
                "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('schema_version', '2')"
            )
            db.execute("DELETE FROM sessions")

        if schema_version < 3:
            # 重建 users 表：role CHECK 加 teacher/student，member→student，新增 created_by 列
            db.execute("PRAGMA foreign_keys = OFF")
            try:
                db.executescript(
                    """
                    BEGIN;
                    CREATE TABLE users_v3 (
                        person_id TEXT PRIMARY KEY,
                        username TEXT UNIQUE,
                        name TEXT NOT NULL,
                        role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
                        password_hash TEXT NOT NULL,
                        active INTEGER NOT NULL DEFAULT 1,
                        created_by TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    INSERT INTO users_v3
                        (person_id, username, name, role, password_hash, active, created_by, created_at, updated_at)
                    SELECT person_id, username, name,
                           CASE WHEN role = 'member' THEN 'student' ELSE role END,
                           password_hash, active, NULL, created_at, updated_at
                    FROM users;
                    DROP TABLE users;
                    ALTER TABLE users_v3 RENAME TO users;
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
                    COMMIT;
                    """
                )
            finally:
                db.execute("PRAGMA foreign_keys = ON")

            # app_state.payload：member→student，初始化 classes
            state_row_v3 = db.execute("SELECT payload FROM app_state WHERE id = 1").fetchone()
            if state_row_v3:
                sp = json.loads(state_row_v3["payload"])
                changed_v3 = False
                for person in sp.get("people", []):
                    if person.get("role") == "member":
                        person["role"] = "student"
                        changed_v3 = True
                if "classes" not in sp:
                    sp["classes"] = []
                    changed_v3 = True
                if changed_v3:
                    db.execute(
                        "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1",
                        (json.dumps(sp, ensure_ascii=False), now_iso()),
                    )

            db.execute(
                "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('schema_version', '3')"
            )
            db.execute("DELETE FROM sessions")

        if schema_version < 4:
            # v4：合并重复 id 的任务（前端 ID 计数器未同步导致同 id 任务并存、记录翻倍）
            state_row_v4 = db.execute("SELECT payload FROM app_state WHERE id = 1").fetchone()
            if state_row_v4:
                shutil.copy2(DB_PATH, DB_PATH.with_name(f"gantt.db.bak-v4-{int(time.time())}"))
                payload_v4 = json.loads(state_row_v4["payload"])
                deduped: dict[str, dict[str, Any]] = {}
                for task in payload_v4.get("tasks", []):
                    task_id = task.get("id")
                    if task_id in deduped:
                        deduped[task_id] = merge_duplicate_tasks(deduped[task_id], task)
                    else:
                        deduped[task_id] = task
                before = len(payload_v4.get("tasks", []))
                payload_v4["tasks"] = list(deduped.values())
                db.execute(
                    "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1",
                    (json.dumps(payload_v4, ensure_ascii=False), now_iso()),
                )
                print(f"[migrate v4] 合并重复任务：{before} -> {len(deduped)}", flush=True)
            db.execute(
                "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('schema_version', '4')"
            )

        state_row = db.execute("SELECT payload FROM app_state WHERE id = 1").fetchone()
        if state_row:
            state_payload = json.loads(state_row["payload"])
            usernames = {
                row["person_id"]: row["username"]
                for row in db.execute("SELECT person_id, username FROM users").fetchall()
            }
            changed = False
            for person in state_payload.get("people", []):
                username = usernames.get(person.get("id"))
                if username and person.get("username") != username:
                    person["username"] = username
                    changed = True
            if changed:
                db.execute(
                    "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = 1",
                    (json.dumps(state_payload, ensure_ascii=False), now_iso()),
                )
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_iso(),))


class LoginRequest(BaseModel):
    username: str
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def username_is_valid(cls, value: str) -> str:
        return validate_username(value)


class PasswordResetRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_is_strong(cls, value: str) -> str:
        return validate_password_strength(value)


class UserCreateRequest(BaseModel):
    person_id: str = Field(min_length=2, max_length=64)
    username: str
    name: str = Field(min_length=1, max_length=40)
    role: str = "student"
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def username_is_valid(cls, value: str) -> str:
        return validate_username(value)

    @field_validator("password")
    @classmethod
    def password_is_strong(cls, value: str) -> str:
        return validate_password_strength(value)

    @field_validator("role")
    @classmethod
    def role_is_valid(cls, value: str) -> str:
        if value not in {"admin", "teacher", "student"}:
            raise ValueError("账户角色无效")
        return value


class UserUpdateRequest(BaseModel):
    username: str
    name: str = Field(min_length=1, max_length=40)

    @field_validator("username")
    @classmethod
    def username_is_valid(cls, value: str) -> str:
        return validate_username(value)


class StatePayload(BaseModel):
    people: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    studentProfiles: list[dict[str, Any]] = Field(default_factory=list)
    profileFieldDefs: list[dict[str, Any]] = Field(default_factory=list)
    classes: list[dict[str, Any]] = Field(default_factory=list)


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "personId": row["person_id"],
        "username": row["username"],
        "name": row["name"],
        "role": row["role"],
        # 停用账户可登录进入离线模式（只读），删除后级联清会话彻底锁定
        "active": bool(row["active"]),
    }


def sanitize_person(person: dict[str, Any]) -> dict[str, Any]:
    clean = dict(person)
    clean.pop("passwordHash", None)
    return clean


def sanitize_state(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "people": [sanitize_person(person) for person in payload.get("people", [])],
        "tasks": payload.get("tasks", []),
        "studentProfiles": payload.get("studentProfiles", []),
        "profileFieldDefs": payload.get("profileFieldDefs", []),
        "classes": payload.get("classes", []),
    }


def user_can_see_task(task: dict[str, Any], user: dict[str, Any]) -> bool:
    """任务可见性：学生只看自己的任务；admin/teacher 看不到他人标记为私有的任务。"""
    if user["role"] == "student":
        return task.get("assigneeId") == user["personId"]
    if task.get("isPrivate") and task.get("assigneeId") != user["personId"]:
        return False
    return True


def manager_person_scope(people: list[dict[str, Any]], user: dict[str, Any]) -> set[str]:
    """成员可见范围：自己 + 自己创建的成员；admin 额外继承历史无归属的学生（p2/p3 等）。"""
    ids = {user["personId"]}
    for person in people:
        creator = person.get("createdBy")
        if creator == user["personId"]:
            ids.add(person["id"])
        elif user["role"] == "admin" and person.get("role") == "student" and not creator:
            ids.add(person["id"])
    return ids


def manager_task_scope(people: list[dict[str, Any]], user: dict[str, Any]) -> set[str]:
    """任务可见范围：自己 + 自己创建的学生（教师名下的任务只有本人可见，教师之间互不可见）。"""
    ids = {user["personId"]}
    for person in people:
        creator = person.get("createdBy")
        if person.get("role") == "student" and (
            creator == user["personId"]
            or (user["role"] == "admin" and not creator)
        ):
            ids.add(person["id"])
    return ids


def state_for_user(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    clean = sanitize_state(payload)
    role = user["role"]
    if role in ("admin", "teacher"):
        # 工作区按归属隔离：只看自己 + 自己创建的学生；其他教师与其学生不可见
        everyone = clean["people"]
        person_ids = manager_person_scope(everyone, user)
        task_owner_ids = manager_task_scope(everyone, user)
        student_ids = task_owner_ids - {user["personId"]}
        return {
            "people": [p for p in everyone if p.get("id") in person_ids],
            "tasks": [
                t
                for t in clean["tasks"]
                if t.get("assigneeId") in task_owner_ids and user_can_see_task(t, user)
            ],
            "studentProfiles": [
                p for p in clean["studentProfiles"] if p.get("personId") in student_ids
            ],
            # 预设字段对所有角色可见（学生/教师填档案需要用到可选项）
            "profileFieldDefs": clean["profileFieldDefs"],
            "classes": [c for c in clean["classes"] if c.get("teacherId") == user["personId"]],
        }

    # student 分支（沿用原 member 逻辑）
    person_id = user["personId"]
    profiles: list[dict[str, Any]] = []
    for profile in clean["studentProfiles"]:
        if profile.get("personId") == person_id:
            profiles.append(
                {
                    **profile,
                    "adminOnlyData": {"fields": [], "values": {}, "note": ""},
                }
            )
    visible_people: list[dict[str, Any]] = []
    for person in clean["people"]:
        visible_person = dict(person)
        if visible_person.get("id") != person_id:
            visible_person.pop("username", None)
            visible_person.pop("classIds", None)
            visible_person.pop("createdBy", None)
        visible_people.append(visible_person)
    return {
        "people": visible_people,
        "tasks": [task for task in clean["tasks"] if task.get("assigneeId") == person_id],
        "studentProfiles": profiles,
        # 预设字段对所有角色可见（学生填档案需要用到可选项）
        "profileFieldDefs": clean["profileFieldDefs"],
        "classes": [],
    }


def merge_member_state(
    stored: dict[str, Any], incoming: dict[str, Any], person_id: str
) -> dict[str, Any]:
    member_tasks = incoming.get("tasks", [])
    if any(task.get("assigneeId") != person_id for task in member_tasks):
        raise HTTPException(status_code=403, detail="学生只能修改自己的任务")

    tasks = [task for task in stored.get("tasks", []) if task.get("assigneeId") != person_id]
    tasks.extend(member_tasks)

    incoming_profile = next(
        (p for p in incoming.get("studentProfiles", []) if p.get("personId") == person_id),
        None,
    )
    profiles: list[dict[str, Any]] = []
    found = False
    for profile in stored.get("studentProfiles", []):
        if profile.get("personId") == person_id and incoming_profile:
            profiles.append(
                {
                    **profile,
                    "personName": incoming_profile.get("personName", profile.get("personName", "")),
                    "data": incoming_profile.get("data", {}),
                }
            )
            found = True
        else:
            profiles.append(profile)
    if incoming_profile and not found:
        profiles.append(
            {
                **incoming_profile,
                "adminOnlyData": {"fields": [], "values": {}, "note": ""},
            }
        )
    return {
        "people": stored.get("people", []),
        "tasks": tasks,
        "studentProfiles": profiles,
        # 忽略学生传入的预设字段，永远保留服务端定义，防止学生篡改
        "profileFieldDefs": stored.get("profileFieldDefs", []),
        "classes": stored.get("classes", []),
    }


def teacher_can_manage(db: sqlite3.Connection, teacher_id: str, target_id: str) -> bool:
    """老师只能管理自己创建的学生账号"""
    row = db.execute(
        "SELECT role, created_by FROM users WHERE person_id = ?", (target_id,)
    ).fetchone()
    if not row or row["role"] != "student":
        return False
    return row["created_by"] == teacher_id


def merge_manager_state(
    stored: dict[str, Any],
    incoming: dict[str, Any],
    user: dict[str, Any],
    admin_fields: bool,
) -> dict[str, Any]:
    """admin/teacher 统一的 scoped 保存合并：只接受自己范围内的数据，
    范围外（其他教师与其学生、学生私有任务）原样保留，防越权、防误删。"""
    user_id = user["personId"]
    is_admin = user["role"] == "admin"
    stored_people = stored.get("people", [])
    incoming_people = incoming.get("people", [])
    scope_ids = manager_person_scope(stored_people + incoming_people, user)
    task_owner_ids = manager_task_scope(stored_people + incoming_people, user)

    # people：范围内以 incoming 为准（保护 id/role/createdBy/username/配色），缺失=删除；
    # 范围外原样保留；范围内新增的成员 createdBy/role 由服务端裁定
    incoming_by_id = {p.get("id"): p for p in incoming_people}
    stored_ids = {p.get("id") for p in stored_people}
    people: list[dict[str, Any]] = []
    protected = {"id", "role", "createdBy", "username", "color", "lightColor", "borderColor", "textColor"}
    for person in stored_people:
        pid = person.get("id")
        if pid not in scope_ids:
            people.append(person)  # 他人数据
            continue
        inc = incoming_by_id.get(pid)
        if inc is None:
            continue  # 用户删除了该成员
        merged = dict(person)
        for key, value in inc.items():
            if key not in protected:
                merged[key] = value
        people.append(merged)
    for pid, inc in incoming_by_id.items():
        if pid in stored_ids or pid not in scope_ids:
            continue
        new_person = dict(inc)
        new_person["createdBy"] = user_id  # 归属由服务端裁定
        # 自己的条目保持原角色；老师新建的成员只能是学生（admin 可建教师）；防提权
        allowed_roles = {"student", "teacher", "admin"} if is_admin else {"student"}
        if pid != user_id and new_person.get("role") not in allowed_roles:
            new_person["role"] = "student"
        people.append(new_person)

    # tasks：范围内以 incoming 为准（支持删除），学生私有任务保留，范围外不动
    incoming_tasks = incoming.get("tasks", [])
    for task in incoming_tasks:
        if task.get("assigneeId") not in task_owner_ids:
            raise HTTPException(status_code=403, detail="任务负责人超出你的管理范围")
    incoming_task_ids = {t.get("id") for t in incoming_tasks}
    tasks: list[dict[str, Any]] = []
    for task in stored.get("tasks", []):
        if task.get("assigneeId") not in task_owner_ids:
            tasks.append(task)  # 他人数据
        elif task.get("id") in incoming_task_ids:
            continue  # 由 incoming 覆盖
        elif not user_can_see_task(task, user):
            tasks.append(task)  # 学生私有任务：看不见但不可删
        # 范围内可见但 incoming 没有 = 用户已删除 → 丢弃
    tasks.extend(incoming_tasks)

    # classes：自己的班以 incoming 为准（含删除），他人班级原样保留
    classes = [c for c in stored.get("classes", []) if c.get("teacherId") != user_id]
    classes += [c for c in incoming.get("classes", []) if c.get("teacherId") == user_id]

    # studentProfiles：只接受范围内学生的档案（缺失=删除），他人档案保留
    scope_students = task_owner_ids - {user_id}
    incoming_profiles = {p.get("personId"): p for p in incoming.get("studentProfiles", [])}
    kept_profile_ids = set()
    profiles: list[dict[str, Any]] = []
    for profile in stored.get("studentProfiles", []):
        pid = profile.get("personId")
        if pid in scope_students:
            inc = incoming_profiles.get(pid)
            if inc is not None:
                profiles.append(inc)
                kept_profile_ids.add(pid)
            # incoming 没有 = 用户删除了该学生（档案随成员一起删）
        else:
            profiles.append(profile)  # 他人学生的档案
    for pid, inc in incoming_profiles.items():
        if pid in scope_students and pid not in kept_profile_ids:
            profiles.append(inc)

    return {
        "people": people,
        "tasks": tasks,
        "classes": classes,
        "studentProfiles": profiles,
        # 预设字段：admin 可写，teacher 只读（永远保留服务端定义，防篡改）
        "profileFieldDefs": (
            incoming.get("profileFieldDefs", [])
            if admin_fields
            else stored.get("profileFieldDefs", [])
        ),
    }


def sync_users(db: sqlite3.Connection, people: list[dict[str, Any]]) -> None:
    active_ids: set[str] = set()
    for person in people:
        person_id = str(person.get("id", "")).strip()
        username = str(person.get("username", "")).strip()
        name = str(person.get("name", "")).strip()
        role = person.get("role")
        if not person_id or not name or role not in {"admin", "teacher", "student"}:
            raise HTTPException(status_code=422, detail="成员数据不完整")
        active = 0 if person.get("status") == "archived" else 1
        active_ids.add(person_id)
        existing = db.execute(
            "SELECT person_id, username FROM users WHERE person_id = ?", (person_id,)
        ).fetchone()
        username = username or (existing["username"] if existing else person_id)
        try:
            username = validate_username(username)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        if existing:
            try:
                db.execute(
                    "UPDATE users SET username = ?, name = ?, role = ?, active = ?, updated_at = ? WHERE person_id = ?",
                    (username, name, role, active, now_iso(), person_id),
                )
            except sqlite3.IntegrityError as error:
                raise HTTPException(status_code=409, detail="账号或学号已被使用") from error
        else:
            try:
                db.execute(
                    """
                    INSERT INTO users
                        (person_id, username, name, role, password_hash, active, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (person_id, username, name, role, hash_password(secrets.token_urlsafe(24)), active, person.get("createdBy"), now_iso(), now_iso()),
                )
            except sqlite3.IntegrityError as error:
                raise HTTPException(status_code=409, detail="账号或学号已被使用") from error
    for row in db.execute("SELECT person_id FROM users").fetchall():
        if row["person_id"] not in active_ids:
            db.execute(
                "UPDATE users SET active = 0, updated_at = ? WHERE person_id = ?",
                (now_iso(), row["person_id"]),
            )


async def current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    if not session_token:
        raise HTTPException(status_code=401, detail="请先登录")
    with database() as db:
        row = db.execute(
            """
            SELECT u.* FROM sessions s
            JOIN users u ON u.person_id = s.person_id
            WHERE s.token_hash = ? AND s.expires_at > ?
            """,
            (hash_token(session_token), now_iso()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    return public_user(row)


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="YANG11 Lab Gantt API", version="1.0.0", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    with database() as db:
        row = db.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
            (payload.username,),
        ).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="账号或密码错误")
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).isoformat()
        db.execute(
            "INSERT INTO sessions (token_hash, person_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (hash_token(token), row["person_id"], expires_at, now_iso()),
        )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=os.getenv("GANTT_SECURE_COOKIE", "0") == "1",
        path="/",
    )
    return {"user": public_user(row)}


@app.get("/api/auth/me")
def me(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    if not session_token:
        return {"user": None}
    with database() as db:
        row = db.execute(
            """
            SELECT u.* FROM sessions s
            JOIN users u ON u.person_id = s.person_id
            WHERE s.token_hash = ? AND s.expires_at > ?
            """,
            (hash_token(session_token), now_iso()),
        ).fetchone()
    return {"user": public_user(row) if row else None}


@app.post("/api/auth/logout")
def logout(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> Response:
    if session_token:
        with database() as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(session_token),))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


class OwnPasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_is_strong(cls, value: str) -> str:
        return validate_password_strength(value)


@app.put("/api/auth/password", status_code=status.HTTP_204_NO_CONTENT)
def change_own_password(
    payload: OwnPasswordRequest,
    user: dict[str, Any] = Depends(current_user),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> Response:
    """自助修改密码：校验旧密码，更新后注销其他会话、保留当前会话。"""
    with database() as db:
        row = db.execute(
            "SELECT password_hash FROM users WHERE person_id = ?", (user["personId"],)
        ).fetchone()
        if not row or not verify_password(payload.old_password, row["password_hash"]):
            raise HTTPException(status_code=403, detail="旧密码不正确")
        db.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE person_id = ?",
            (hash_password(payload.password), now_iso(), user["personId"]),
        )
        if session_token:
            db.execute(
                "DELETE FROM sessions WHERE person_id = ? AND token_hash != ?",
                (user["personId"], hash_token(session_token)),
            )
    return Response(status_code=204)


@app.post("/api/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if user["role"] == "student":
        raise HTTPException(status_code=403, detail="仅管理员或老师可新增账户")
    if user["role"] == "teacher" and payload.role != "student":
        raise HTTPException(status_code=403, detail="老师只能创建学生账户")
    with database() as db:
        try:
            db.execute(
                """
                INSERT INTO users
                    (person_id, username, name, role, password_hash, active, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    payload.person_id,
                    payload.username,
                    payload.name.strip(),
                    payload.role,
                    hash_password(payload.password),
                    user["personId"],
                    now_iso(),
                    now_iso(),
                ),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="账号或学号已被使用") from error
        row = db.execute("SELECT * FROM users WHERE person_id = ?", (payload.person_id,)).fetchone()
    return {"user": public_user(row)}


@app.put("/api/users/{person_id}")
def update_user(
    person_id: str,
    payload: UserUpdateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if user["role"] == "student":
        raise HTTPException(status_code=403, detail="仅管理员或老师可修改账户")
    with database() as db:
        if user["role"] == "teacher" and not teacher_can_manage(db, user["personId"], person_id):
            raise HTTPException(status_code=403, detail="只能管理自己创建的学生账户")
        try:
            result = db.execute(
                "UPDATE users SET username = ?, name = ?, updated_at = ? WHERE person_id = ?",
                (payload.username, payload.name.strip(), now_iso(), person_id),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="账号或学号已被使用") from error
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="账户不存在")
        row = db.execute("SELECT * FROM users WHERE person_id = ?", (person_id,)).fetchone()
    return {"user": public_user(row)}


@app.delete("/api/users/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    person_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> Response:
    if user["role"] == "student":
        raise HTTPException(status_code=403, detail="仅管理员或老师可删除账户")
    if person_id == user["personId"]:
        raise HTTPException(status_code=422, detail="不能删除当前登录账户")
    with database() as db:
        if user["role"] == "teacher" and not teacher_can_manage(db, user["personId"], person_id):
            raise HTTPException(status_code=403, detail="只能管理自己创建的学生账户")
        result = db.execute("DELETE FROM users WHERE person_id = ?", (person_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="账户不存在")
    return Response(status_code=204)


@app.put("/api/users/{person_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    person_id: str,
    payload: PasswordResetRequest,
    user: dict[str, Any] = Depends(current_user),
) -> Response:
    if user["role"] == "student":
        raise HTTPException(status_code=403, detail="仅管理员或老师可重置密码")
    with database() as db:
        if user["role"] == "teacher" and not teacher_can_manage(db, user["personId"], person_id):
            raise HTTPException(status_code=403, detail="只能管理自己创建的学生账户")
        result = db.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE person_id = ?",
            (hash_password(payload.password), now_iso(), person_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="成员不存在")
        if person_id != user["personId"]:
            db.execute("DELETE FROM sessions WHERE person_id = ?", (person_id,))
    return Response(status_code=204)


def attachment_path(attachment_id: str) -> Path:
    if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
        raise HTTPException(status_code=404, detail="附件不存在")
    return ATTACHMENTS_DIR / attachment_id


def find_attachment_task(payload: dict[str, Any], attachment_id: str) -> dict[str, Any] | None:
    """在 state 中定位附件所属的任务（附件可挂在进展记录或记录下的回复上）。"""
    for task in payload.get("tasks", []):
        for record in task.get("progressHistory", []):
            if any(a.get("id") == attachment_id for a in record.get("attachments", [])):
                return task
            for reply in record.get("replies", []):
                if any(a.get("id") == attachment_id for a in reply.get("attachments", [])):
                    return task
    return None


@app.post("/api/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    attachment_id = secrets.token_urlsafe(16)
    destination = ATTACHMENTS_DIR / attachment_id
    max_bytes = MAX_ATTACHMENT_MB * 1024 * 1024
    size = 0
    try:
        with destination.open("wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    buffer.close()
                    destination.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"单个附件不能超过 {MAX_ATTACHMENT_MB}MB",
                    )
                buffer.write(chunk)
        with database() as db:
            db.execute(
                "INSERT INTO attachments (id, name, size, uploader, created_at) VALUES (?, ?, ?, ?, ?)",
                (attachment_id, file.filename or "未命名文件", size, user["personId"], now_iso()),
            )
    except HTTPException:
        raise
    except OSError as error:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="附件保存失败") from error
    finally:
        await file.close()
    return {
        "id": attachment_id,
        "name": file.filename or "未命名文件",
        "size": size,
        "uploadedBy": user["personId"],
        "uploadedAt": now_iso(),
    }


@app.get("/api/attachments/{attachment_id}")
def download_attachment(
    attachment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> FileResponse:
    path = attachment_path(attachment_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="附件不存在或已删除")
    with database() as db:
        row = db.execute(
            "SELECT * FROM attachments WHERE id = ?", (attachment_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="附件不存在或已删除")
    with database() as db:
        state_row = db.execute("SELECT payload FROM app_state WHERE id = 1").fetchone()
    task = find_attachment_task(json.loads(state_row["payload"]), attachment_id) if state_row else None
    if task is not None:
        # 已挂进某条记录：按该任务的可见性判定（私有任务的附件教师不可下载）
        if not user_can_see_task(task, user):
            raise HTTPException(status_code=404, detail="附件不存在或已删除")
    elif row["uploader"] != user["personId"]:
        # 尚未挂进任何任务（刚上传、自动保存有延迟，或所在记录已被删除）：仅上传者可访问
        raise HTTPException(status_code=404, detail="附件不存在或已删除")
    filename = quote(row["name"])
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
        },
    )


# ===================== AI 助手（服务器 Claude Code CLI） =====================

def read_ai_settings() -> dict[str, Any]:
    with database() as db:
        row = db.execute("SELECT enabled, model FROM ai_settings WHERE id = 1").fetchone()
    return {
        "enabled": bool(row["enabled"]) if row else False,
        "model": row["model"] if row else "",
    }


class AiTurn:
    """一轮 AI 回复：后台任务执行 claude CLI，事件带自增 seq 写入缓冲，支持断线重连重放。"""

    def __init__(
        self,
        message_id: int,
        conversation_id: str,
        person_id: str,
        prompt: str,
        model: str,
        resume_session: str | None,
    ) -> None:
        self.message_id = message_id
        self.conversation_id = conversation_id
        self.person_id = person_id
        self.prompt = prompt
        self.model = model
        self.resume_session = resume_session
        self.events: list[dict[str, Any]] = []
        self.seq = 0
        self.finished = False
        self.wakeups: list[asyncio.Event] = []
        self.created = time.monotonic()

    def emit(self, event_type: str, **fields: Any) -> None:
        self.seq += 1
        event = {"seq": self.seq, "type": event_type, **fields}
        self.events.append(event)
        if event_type in ("done", "error"):
            self.finished = True
        for wakeup in self.wakeups:
            wakeup.set()


ai_active_turns: dict[int, AiTurn] = {}
ai_busy_conversations: set[str] = set()


def prune_finished_turns() -> None:
    for message_id in [
        mid
        for mid, turn in ai_active_turns.items()
        if turn.finished and time.monotonic() - turn.created > 600
    ]:
        ai_active_turns.pop(message_id, None)


async def run_claude_process(
    workdir: Path,
    prompt: str,
    model: str,
    resume_session: str | None,
    on_delta: Any = None,
) -> tuple[str, str | None, str | None]:
    """执行一次 claude -p，返回 (完整回复文本, claude session id, 错误信息)。"""
    command = [CLAUDE_CLI, "-p", "--output-format", "stream-json", "--verbose", "--allowedTools", ""]
    if model:
        command += ["--model", model]
    if resume_session:
        command += ["--resume", resume_session]
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=workdir,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert process.stdin and process.stdout and process.stderr

    async def drain_stderr() -> None:
        while await process.stderr.readline():
            pass

    stderr_task = asyncio.create_task(drain_stderr())
    try:
        process.stdin.write(prompt.encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()

        streamed: list[str] = []
        session_id: str | None = None
        result_text: str | None = None
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), timeout=AI_TURN_TIMEOUT)
            if not line:
                break
            text_line = line.decode("utf-8", errors="replace").strip()
            if not text_line:
                continue
            try:
                event = json.loads(text_line)
            except json.JSONDecodeError:
                continue
            event_type = event.get("type")
            if event_type == "system" and event.get("subtype") == "init":
                session_id = event.get("session_id") or session_id
            elif event_type == "assistant":
                for block in event.get("message", {}).get("content", []):
                    if isinstance(block, dict) and block.get("type") == "text":
                        chunk = block.get("text", "")
                        if chunk:
                            streamed.append(chunk)
                            if on_delta:
                                on_delta(chunk)
            elif event_type == "result":
                session_id = event.get("session_id") or session_id
                result_text = event.get("result")
        await process.wait()
        full_text = result_text if result_text is not None else "".join(streamed)
        if process.returncode != 0 and not full_text:
            return ("", session_id, f"AI 进程退出（code {process.returncode}），请稍后重试")
        # result 与已流出的增量可能重复/不一致：以 result 为准补齐未发出的尾巴
        if on_delta and full_text:
            emitted = "".join(streamed)
            if full_text.startswith(emitted) and len(full_text) > len(emitted):
                on_delta(full_text[len(emitted):])
        return (full_text, session_id, None)
    except asyncio.TimeoutError:
        process.kill()
        return ("", None, "AI 响应超时，请稍后重试")
    except OSError as error:
        process.kill()
        return ("", None, f"AI 进程启动失败：{error}")
    finally:
        stderr_task.cancel()


def build_fallback_prompt(conversation_id: str, prompt: str) -> str:
    """resume 失效时，把最近历史拼进 prompt 重发，保证对话连续性优雅退化。"""
    with database() as db:
        rows = db.execute(
            "SELECT role, content FROM ai_messages WHERE conversation_id = ? AND state = 'done' "
            "ORDER BY id DESC LIMIT 10",
            (conversation_id,),
        ).fetchall()
    history = "\n".join(
        f"{'用户' if row['role'] == 'user' else '助手'}：{row['content']}" for row in reversed(rows)
    )
    return (
        "（此前会话已过期，以下是最近的对话记录，请在此基础上继续）\n"
        f"{history}\n\n用户最新消息：{prompt}"
    )


async def execute_ai_turn(turn: AiTurn) -> None:
    workdir = AI_SESSIONS_DIR / turn.conversation_id
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        text, session_id, error = await run_claude_process(
            workdir, turn.prompt, turn.model, turn.resume_session,
            on_delta=lambda chunk: turn.emit("delta", text=chunk),
        )
        if error and not text and turn.resume_session:
            # resume 的 session 已失效（被清理/换端），降级为新会话带历史重发
            text, session_id, error = await run_claude_process(
                workdir, build_fallback_prompt(turn.conversation_id, turn.prompt), turn.model, None,
                on_delta=lambda chunk: turn.emit("delta", text=chunk),
            )
        if error and not text:
            with database() as db:
                db.execute(
                    "UPDATE ai_messages SET state = 'error' WHERE id = ?", (turn.message_id,)
                )
                db.execute(
                    "UPDATE ai_conversations SET updated_at = ? WHERE id = ?",
                    (now_iso(), turn.conversation_id),
                )
            turn.emit("error", message=error)
            return
        with database() as db:
            db.execute(
                "UPDATE ai_messages SET content = ?, state = 'done' WHERE id = ?",
                (text, turn.message_id),
            )
            db.execute(
                "UPDATE ai_conversations SET claude_session_id = ?, updated_at = ? WHERE id = ?",
                (session_id or turn.resume_session, now_iso(), turn.conversation_id),
            )
        turn.emit("done")
    except Exception as error:  # noqa: BLE001 — 后台任务兜底，任何异常都要反馈给前端
        with database() as db:
            db.execute(
                "UPDATE ai_messages SET state = 'error' WHERE id = ?", (turn.message_id,)
            )
        turn.emit("error", message=f"AI 内部错误：{error}")
    finally:
        ai_busy_conversations.discard(turn.conversation_id)


class AiSettingsRequest(BaseModel):
    enabled: bool
    model: str = Field(default="", max_length=64)


class AiConversationCreateRequest(BaseModel):
    title: str = Field(default="", max_length=60)


class AiChatRequest(BaseModel):
    conversation_id: str = Field(min_length=8, max_length=64)
    content: str = Field(min_length=1, max_length=AI_MAX_MESSAGE_CHARS)


def get_owned_conversation(conversation_id: str, person_id: str) -> sqlite3.Row:
    with database() as db:
        row = db.execute(
            "SELECT * FROM ai_conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
    if not row or row["person_id"] != person_id:
        raise HTTPException(status_code=404, detail="对话不存在")
    return row


@app.get("/api/ai/status")
def ai_status(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    settings = read_ai_settings()
    return {"available": CLAUDE_CLI is not None, "enabled": settings["enabled"]}


@app.get("/api/ai/settings")
def get_ai_settings(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可配置 AI")
    settings = read_ai_settings()
    return {**settings, "available": CLAUDE_CLI is not None}


@app.put("/api/ai/settings")
def put_ai_settings(
    payload: AiSettingsRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可配置 AI")
    with database() as db:
        db.execute(
            "INSERT INTO ai_settings (id, enabled, model, updated_at) VALUES (1, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, "
            "model = excluded.model, updated_at = excluded.updated_at",
            (1 if payload.enabled else 0, payload.model.strip(), now_iso()),
        )
    return {"ok": True}


@app.get("/api/ai/conversations")
def list_ai_conversations(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    with database() as db:
        rows = db.execute(
            "SELECT id, title, updated_at FROM ai_conversations WHERE person_id = ? "
            "ORDER BY updated_at DESC LIMIT 50",
            (user["personId"],),
        ).fetchall()
    return {
        "conversations": [
            {"id": row["id"], "title": row["title"], "updatedAt": row["updated_at"]}
            for row in rows
        ]
    }


@app.post("/api/ai/conversations", status_code=status.HTTP_201_CREATED)
def create_ai_conversation(
    payload: AiConversationCreateRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    conversation_id = uuid.uuid4().hex
    title = payload.title.strip() or "新对话"
    with database() as db:
        db.execute(
            "INSERT INTO ai_conversations (id, person_id, title, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (conversation_id, user["personId"], title, now_iso(), now_iso()),
        )
    return {"id": conversation_id, "title": title}


@app.delete("/api/ai/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ai_conversation(
    conversation_id: str, user: dict[str, Any] = Depends(current_user)
) -> Response:
    get_owned_conversation(conversation_id, user["personId"])
    if conversation_id in ai_busy_conversations:
        raise HTTPException(status_code=409, detail="AI 正在回复，请等待结束后再删除")
    with database() as db:
        db.execute("DELETE FROM ai_messages WHERE conversation_id = ?", (conversation_id,))
        db.execute("DELETE FROM ai_conversations WHERE id = ?", (conversation_id,))
    shutil.rmtree(AI_SESSIONS_DIR / conversation_id, ignore_errors=True)
    return Response(status_code=204)


@app.get("/api/ai/conversations/{conversation_id}/messages")
def list_ai_messages(
    conversation_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    get_owned_conversation(conversation_id, user["personId"])
    with database() as db:
        rows = db.execute(
            "SELECT id, role, content, state, created_at FROM ai_messages "
            "WHERE conversation_id = ? ORDER BY id ASC LIMIT 500",
            (conversation_id,),
        ).fetchall()
    return {
        "messages": [
            {
                "id": row["id"],
                "role": row["role"],
                "content": row["content"],
                "state": row["state"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ]
    }


@app.post("/api/ai/chat", status_code=status.HTTP_202_ACCEPTED)
async def send_ai_chat(
    payload: AiChatRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="账号已停用，AI 功能不可用")
    if not CLAUDE_CLI:
        raise HTTPException(status_code=400, detail="服务器未安装 Claude Code CLI")
    settings = read_ai_settings()
    if not settings["enabled"]:
        raise HTTPException(status_code=400, detail="AI 功能未开启，请联系管理员")
    conversation = get_owned_conversation(payload.conversation_id, user["personId"])
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="消息内容不能为空")

    prune_finished_turns()
    if payload.conversation_id in ai_busy_conversations:
        raise HTTPException(status_code=409, detail="AI 正在回复上一条消息，请稍候")
    active_count = sum(1 for turn in ai_active_turns.values() if not turn.finished)
    if active_count >= AI_MAX_CONCURRENT:
        raise HTTPException(status_code=503, detail="AI 并发已满，请稍后再试")

    title = content[:18].replace("\n", " ")
    with database() as db:
        db.execute(
            "INSERT INTO ai_messages (conversation_id, role, content, state, created_at) "
            "VALUES (?, 'user', ?, 'done', ?)",
            (payload.conversation_id, content, now_iso()),
        )
        if not conversation["title"] or conversation["title"] == "新对话":
            db.execute(
                "UPDATE ai_conversations SET title = ? WHERE id = ?",
                (title, payload.conversation_id),
            )
        cursor = db.execute(
            "INSERT INTO ai_messages (conversation_id, role, content, state, created_at) "
            "VALUES (?, 'assistant', '', 'pending', ?)",
            (payload.conversation_id, now_iso()),
        )
        assistant_message_id = int(cursor.lastrowid or 0)

    turn = AiTurn(
        message_id=assistant_message_id,
        conversation_id=payload.conversation_id,
        person_id=user["personId"],
        prompt=content,
        model=settings["model"],
        resume_session=conversation["claude_session_id"],
    )
    ai_active_turns[assistant_message_id] = turn
    ai_busy_conversations.add(payload.conversation_id)
    asyncio.create_task(execute_ai_turn(turn))
    return {"assistantMessageId": assistant_message_id}


@app.get("/api/ai/stream/{message_id}")
async def stream_ai_reply(
    message_id: int, from_seq: int = 0, user: dict[str, Any] = Depends(current_user)
) -> StreamingResponse:
    turn = ai_active_turns.get(message_id)
    if turn is None:
        # 进程重启等原因导致任务不在内存：从数据库回放终态
        with database() as db:
            row = db.execute(
                """
                SELECT m.role, m.content, m.state, c.person_id
                FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
                WHERE m.id = ?
                """,
                (message_id,),
            ).fetchone()
        if not row or row["person_id"] != user["personId"]:
            raise HTTPException(status_code=404, detail="消息不存在")
        if row["state"] == "done" and row["content"]:
            events = [
                {"seq": 1, "type": "delta", "text": row["content"]},
                {"seq": 2, "type": "done"},
            ]
        else:
            with database() as db:
                db.execute("UPDATE ai_messages SET state = 'error' WHERE id = ?", (message_id,))
            events = [{"seq": 1, "type": "error", "message": "回复已中断，请重新发送"}]

        async def replay() -> Any:
            for event in events:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        return _sse_response(replay())

    if turn.person_id != user["personId"]:
        raise HTTPException(status_code=404, detail="消息不存在")

    async def event_stream() -> Any:
        last = from_seq
        wakeup = asyncio.Event()
        while True:
            while last < turn.seq:
                last += 1
                event = turn.events[last - 1]
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event["type"] in ("done", "error"):
                    return
            if turn.finished:
                return
            wakeup.clear()
            turn.wakeups.append(wakeup)
            try:
                if last < turn.seq:  # 注册唤醒后再查一次，避免竞态漏事件
                    continue
                await asyncio.wait_for(wakeup.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                yield ": ping\n\n"  # SSE 心跳，防止代理断开空闲连接
            finally:
                if wakeup in turn.wakeups:
                    turn.wakeups.remove(wakeup)

    return _sse_response(event_stream())


def _sse_response(generator: Any) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


AI_TEXT_SUFFIXES = {".txt", ".csv", ".md", ".json", ".log"}
AI_FILE_MAX_BYTES = 2 * 1024 * 1024


@app.post("/api/ai/file-text")
async def ai_file_text(
    file: UploadFile = File(...), user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    data = await file.read()
    if len(data) > AI_FILE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件不能超过 2MB")
    name = file.filename or "未命名文件"
    suffix = Path(name).suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        try:
            workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as error:
            raise HTTPException(status_code=400, detail="Excel 文件解析失败") from error
        lines: list[str] = []
        for sheet in workbook.worksheets:
            lines.append(f"## 工作表：{sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                cells = ["" if cell is None else str(cell).strip() for cell in row]
                if any(cells):
                    lines.append("\t".join(cells))
        text = "\n".join(lines)
    elif suffix in AI_TEXT_SUFFIXES or suffix == "":
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = data.decode("gbk")
            except UnicodeDecodeError as error:
                raise HTTPException(
                    status_code=400, detail="仅支持文本文件（txt/csv/md/json）与 xlsx"
                ) from error
    else:
        raise HTTPException(status_code=400, detail="仅支持文本文件（txt/csv/md/json）与 xlsx")
    return {"name": name, "text": text}


@app.get("/api/state")
def get_state(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    with database() as db:
        row = db.execute("SELECT * FROM app_state WHERE id = 1").fetchone()
    if not row:
        return {"state": None, "revision": 0, "updatedAt": None}
    payload = json.loads(row["payload"])
    return {
        "state": state_for_user(payload, user),
        "revision": row["revision"],
        "updatedAt": row["updated_at"],
    }


@app.put("/api/state")
def save_state(
    payload: StatePayload,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="账号已停用，仅可离线查看，修改不会保存")
    incoming = sanitize_state(payload.model_dump())
    with database() as db:
        row = db.execute("SELECT * FROM app_state WHERE id = 1").fetchone()
        if not row and user["role"] not in ("admin", "teacher"):
            raise HTTPException(status_code=403, detail="请先由教师初始化系统")

        if user["role"] in ("admin", "teacher"):
            stored = json.loads(row["payload"]) if row else {"people": [], "tasks": [], "studentProfiles": [], "profileFieldDefs": [], "classes": []}
            next_state = merge_manager_state(
                stored, incoming, user, admin_fields=(user["role"] == "admin")
            )
            # 防注入：合并结果中的成员必须已存在于 users 表（通过 create_user 建的）
            existing_ids = {
                r["person_id"] for r in db.execute("SELECT person_id FROM users").fetchall()
            }
            for person in next_state["people"]:
                if person.get("id") not in existing_ids:
                    raise HTTPException(status_code=422, detail="存在未注册账户")
            sync_users(db, next_state["people"])
        else:
            stored = json.loads(row["payload"])
            next_state = merge_member_state(stored, incoming, user["personId"])

        revision = (row["revision"] + 1) if row else 1
        db.execute(
            """
            INSERT INTO app_state (id, payload, revision, updated_at, updated_by)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                payload = excluded.payload,
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (json.dumps(next_state, ensure_ascii=False), revision, now_iso(), user["personId"]),
        )
    return {"revision": revision, "updatedAt": now_iso()}


if DIST_DIR.exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        candidate = (DIST_DIR / path).resolve()
        if candidate.is_file() and DIST_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")
