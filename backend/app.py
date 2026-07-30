from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import bcrypt
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("GANTT_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "gantt.db"
DIST_DIR = BASE_DIR / "dist"
SESSION_COOKIE = "yang11_session"
SESSION_DAYS = 7
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$")
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{2,32}$")


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


def initialize_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                person_id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
                password_hash TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
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
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
        if "username" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN username TEXT")
        db.execute("UPDATE users SET username = person_id WHERE username IS NULL OR username = ''")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)")

        seed_users = (
            ("p1", "admin", "杨老师", "admin", os.getenv("GANTT_ADMIN_PASSWORD", "xzcXZC123")),
            ("p2", "p2", "杨嘉鑫", "member", secrets.token_urlsafe(24)),
            ("p3", "p3", "蔡雨萱", "member", secrets.token_urlsafe(24)),
        )
        for person_id, username, name, role, password in seed_users:
            db.execute(
                """
                INSERT OR IGNORE INTO users
                    (person_id, username, name, role, password_hash, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
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
    role: str = "member"
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
        if value not in {"admin", "member"}:
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


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "personId": row["person_id"],
        "username": row["username"],
        "name": row["name"],
        "role": row["role"],
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
    }


def state_for_user(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    clean = sanitize_state(payload)
    if user["role"] == "admin":
        return clean

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
        visible_people.append(visible_person)
    return {
        "people": visible_people,
        "tasks": [task for task in clean["tasks"] if task.get("assigneeId") == person_id],
        "studentProfiles": profiles,
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
    }


def sync_users(db: sqlite3.Connection, people: list[dict[str, Any]]) -> None:
    active_ids: set[str] = set()
    for person in people:
        person_id = str(person.get("id", "")).strip()
        username = str(person.get("username", "")).strip()
        name = str(person.get("name", "")).strip()
        role = person.get("role")
        if not person_id or not name or role not in {"admin", "member"}:
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
                        (person_id, username, name, role, password_hash, active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (person_id, username, name, role, hash_password(secrets.token_urlsafe(24)), active, now_iso(), now_iso()),
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
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
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
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1",
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
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
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


@app.post("/api/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可新增账户")
    with database() as db:
        try:
            db.execute(
                """
                INSERT INTO users
                    (person_id, username, name, role, password_hash, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    payload.person_id,
                    payload.username,
                    payload.name.strip(),
                    payload.role,
                    hash_password(payload.password),
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
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可修改账户")
    with database() as db:
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
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可删除账户")
    if person_id == user["personId"]:
        raise HTTPException(status_code=422, detail="不能删除当前登录账户")
    with database() as db:
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
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅教师可重置成员密码")
    with database() as db:
        result = db.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE person_id = ?",
            (hash_password(payload.password), now_iso(), person_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="成员不存在")
        if person_id != user["personId"]:
            db.execute("DELETE FROM sessions WHERE person_id = ?", (person_id,))
    return Response(status_code=204)


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
    incoming = sanitize_state(payload.model_dump())
    with database() as db:
        row = db.execute("SELECT * FROM app_state WHERE id = 1").fetchone()
        if not row and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="请先由教师初始化系统")

        if user["role"] == "admin":
            next_state = incoming
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
