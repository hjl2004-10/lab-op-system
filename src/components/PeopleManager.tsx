import { useMemo, useState, useCallback } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  GripVertical,
  KeyRound,
  Save,
  Shield,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Person } from "@/types";

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

function isStrongPassword(password: string) {
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

interface NewAccount {
  username: string;
  name: string;
  role: "admin" | "member";
  password: string;
}

interface PeopleManagerProps {
  open: boolean;
  people: Person[];
  currentUserId: string;
  onOpenChange: (open: boolean) => void;
  onAdd: (account: NewAccount) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateAccount: (personId: string, updates: { username: string; name: string }) => Promise<void>;
  onSetPassword: (personId: string, password: string) => Promise<void>;
  onReorder: (personIds: string[]) => void;
  onArchive: (id: string, status: "active" | "archived") => void;
}

interface AccountRowProps {
  person: Person;
  isCurrent: boolean;
  draggable: boolean;
  draggedId: string | null;
  onDragStart: (event: React.DragEvent, personId: string) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent, personId: string) => void;
  onDragEnd: () => void;
  onUpdateAccount: PeopleManagerProps["onUpdateAccount"];
  onSetPassword: PeopleManagerProps["onSetPassword"];
  onDelete: PeopleManagerProps["onDelete"];
  onArchive: PeopleManagerProps["onArchive"];
}

function AccountRow({
  person,
  isCurrent,
  draggable,
  draggedId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onUpdateAccount,
  onSetPassword,
  onDelete,
  onArchive,
}: AccountRowProps) {
  const [username, setUsername] = useState(person.username || person.id);
  const [name, setName] = useState(person.name);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"account" | "password" | "delete" | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const saveAccount = async () => {
    const cleanUsername = username.trim();
    const cleanName = name.trim();
    if (!USERNAME_PATTERN.test(cleanUsername) || !cleanName) {
      setMessage({ type: "error", text: "请检查账号和姓名" });
      return;
    }
    setBusy("account");
    setMessage(null);
    try {
      await onUpdateAccount(person.id, { username: cleanUsername, name: cleanName });
      setMessage({ type: "success", text: "账户信息已保存" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    if (!isStrongPassword(password)) {
      setMessage({ type: "error", text: "密码必须含大小写字母和数字，且至少 8 位" });
      return;
    }
    setBusy("password");
    setMessage(null);
    try {
      await onSetPassword(person.id, password);
      setPassword("");
      setMessage({ type: "success", text: "密码已更新" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "密码更新失败" });
    } finally {
      setBusy(null);
    }
  };

  const removeAccount = async () => {
    if (!window.confirm(`确定删除账户“${person.name}”及其全部任务吗？`)) return;
    setBusy("delete");
    try {
      await onDelete(person.id);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "删除失败" });
      setBusy(null);
    }
  };

  return (
    <div
      draggable={draggable}
      onDragStart={(event) => onDragStart(event, person.id)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, person.id)}
      onDragEnd={onDragEnd}
      className={`account-row ${draggedId === person.id ? "is-dragging" : ""}`}
    >
      <div className="account-identity">
        <span className="account-drag">{draggable ? <GripVertical size={16} /> : null}</span>
        <span className="account-avatar" style={{ backgroundColor: person.color }}>
          {person.role === "admin" ? <Shield size={16} /> : <User size={16} />}
        </span>
        <div>
          <strong>{person.name}</strong>
          <span>
            {person.role === "admin" ? "管理员" : "学生"}
            {isCurrent ? " · 当前账户" : ""}
          </span>
        </div>
        {person.status === "archived" && <Badge variant="outline">已停用</Badge>}
      </div>

      <div className="account-fields">
        <div>
          <label htmlFor={`username-${person.id}`}>账号 / 学号</label>
          <Input id={`username-${person.id}`} value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div>
          <label htmlFor={`name-${person.id}`}>姓名</label>
          <Input id={`name-${person.id}`} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <Button variant="outline" size="icon" onClick={saveAccount} disabled={busy !== null} title="保存账户信息">
          <Save size={16} />
        </Button>
      </div>

      <div className="account-security">
        <div className="account-password">
          <KeyRound size={15} />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="设置新密码"
            autoComplete="new-password"
          />
          <Button variant="outline" size="sm" onClick={resetPassword} disabled={busy !== null || !password}>
            重置密码
          </Button>
        </div>
        <div className="account-actions">
          {!isCurrent && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onArchive(person.id, person.status === "archived" ? "active" : "archived")}
              title={person.status === "archived" ? "启用账户" : "停用账户"}
            >
              {person.status === "archived" ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </Button>
          )}
          {!isCurrent && (
            <Button
              variant="ghost"
              size="icon"
              onClick={removeAccount}
              disabled={busy !== null}
              title="删除账户"
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>

      {message && (
        <div className={`account-message ${message.type}`}>
          {message.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {message.text}
        </div>
      )}
    </div>
  );
}

export default function PeopleManager({
  open,
  people,
  currentUserId,
  onOpenChange,
  onAdd,
  onDelete,
  onUpdateAccount,
  onSetPassword,
  onReorder,
  onArchive,
}: PeopleManagerProps) {
  const [activeTab, setActiveTab] = useState("active");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newAccount, setNewAccount] = useState<NewAccount>({
    username: "",
    name: "",
    role: "member",
    password: "",
  });

  const activePeople = useMemo(
    () => people.filter((person) => person.status !== "archived").sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [people]
  );
  const archivedPeople = useMemo(
    () => people.filter((person) => person.status === "archived"),
    [people]
  );

  const createAccount = async () => {
    const account = {
      ...newAccount,
      username: newAccount.username.trim(),
      name: newAccount.name.trim(),
    };
    if (!USERNAME_PATTERN.test(account.username) || !account.name) {
      setCreateError("请填写有效的账号/学号和姓名");
      return;
    }
    if (!isStrongPassword(account.password)) {
      setCreateError("密码必须含大小写字母和数字，且至少 8 位");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      await onAdd(account);
      setNewAccount({ username: "", name: "", role: "member", password: "" });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "账户创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDragStart = useCallback((event: React.DragEvent, personId: string) => {
    if (personId === currentUserId) {
      event.preventDefault();
      return;
    }
    setDraggedId(personId);
    event.dataTransfer.effectAllowed = "move";
  }, [currentUserId]);

  const handleDrop = useCallback((event: React.DragEvent, targetId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return setDraggedId(null);
    const ids = activePeople.map((person) => person.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from >= 0 && to >= 0) {
      ids.splice(from, 1);
      ids.splice(to, 0, draggedId);
      onReorder(ids);
    }
    setDraggedId(null);
  }, [activePeople, draggedId, onReorder]);

  const renderRows = (rows: Person[]) => rows.length ? rows.map((person) => (
    <AccountRow
      key={person.id}
      person={person}
      isCurrent={person.id === currentUserId}
      draggable={person.status !== "archived" && person.id !== currentUserId}
      draggedId={draggedId}
      onDragStart={handleDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onDragEnd={() => setDraggedId(null)}
      onUpdateAccount={onUpdateAccount}
      onSetPassword={onSetPassword}
      onDelete={onDelete}
      onArchive={onArchive}
    />
  )) : <div className="account-empty">暂无账户</div>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="account-manager sm:max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={19} />账户管理
          </DialogTitle>
        </DialogHeader>

        <section className="account-create">
          <div className="account-create-title"><UserPlus size={16} /><strong>新增账户</strong></div>
          <div className="account-create-grid">
            <Input
              value={newAccount.username}
              onChange={(event) => setNewAccount((value) => ({ ...value, username: event.target.value }))}
              placeholder="管理员账号或学号"
            />
            <Input
              value={newAccount.name}
              onChange={(event) => setNewAccount((value) => ({ ...value, name: event.target.value }))}
              placeholder="姓名"
            />
            <select
              value={newAccount.role}
              onChange={(event) => setNewAccount((value) => ({ ...value, role: event.target.value as NewAccount["role"] }))}
              aria-label="账户角色"
            >
              <option value="member">学生</option>
              <option value="admin">管理员</option>
            </select>
            <Input
              type="password"
              value={newAccount.password}
              onChange={(event) => setNewAccount((value) => ({ ...value, password: event.target.value }))}
              placeholder="初始密码"
              autoComplete="new-password"
            />
            <Button onClick={createAccount} disabled={creating}>
              <UserPlus size={15} />{creating ? "创建中" : "创建账户"}
            </Button>
          </div>
          <div className="password-rules" aria-live="polite">
            <span className={/[a-z]/.test(newAccount.password) ? "met" : ""}>小写</span>
            <span className={/[A-Z]/.test(newAccount.password) ? "met" : ""}>大写</span>
            <span className={/\d/.test(newAccount.password) ? "met" : ""}>数字</span>
            <span className={newAccount.password.length >= 8 ? "met" : ""}>8 位</span>
          </div>
          {createError && <div className="account-message error"><AlertCircle size={14} />{createError}</div>}
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">启用账户 ({activePeople.length})</TabsTrigger>
            <TabsTrigger value="archived">停用账户 ({archivedPeople.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="account-list">{renderRows(activePeople)}</TabsContent>
          <TabsContent value="archived" className="account-list">{renderRows(archivedPeople)}</TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
