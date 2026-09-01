import { useMemo, useState, useCallback } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  GripVertical,
  KeyRound,
  RefreshCw,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Person, Role } from "@/types";

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

function isStrongPassword(password: string) {
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface NewAccount {
  username: string;
  name: string;
  role: Role;
  password: string;
  phone?: string;
}

const ROLE_OPTIONS: { value: Role; label: string; hint: string; icon: typeof User }[] = [
  { value: "student", label: "学生", hint: "用学号登录，可被指派任务", icon: User },
  { value: "teacher", label: "老师", hint: "独立工作台，可创建学生", icon: GraduationCap },
  { value: "admin", label: "管理员", hint: "拥有系统全部管理权限", icon: Shield },
];

function CreateAccountDialog({
  open,
  allowRoles,
  onOpenChange,
  onCreate,
  onCreated,
}: {
  open: boolean;
  allowRoles: Role[];
  onOpenChange: (open: boolean) => void;
  onCreate: (account: NewAccount) => Promise<void>;
  onCreated: () => void;
}) {
  const defaultRole = allowRoles.includes("student") ? "student" : allowRoles[0];
  const [role, setRole] = useState<Role>(defaultRole);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setRole(defaultRole);
    setUsername("");
    setName("");
    setPassword("");
    setPhone("");
    setShowPassword(false);
    setError("");
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    const cleanUsername = username.trim();
    const cleanName = name.trim();
    if (!USERNAME_PATTERN.test(cleanUsername)) {
      setError("登录账号需为 2-32 位字母、数字、下划线或连字符（学生请填学号）");
      return;
    }
    if (!cleanName) {
      setError("请填写姓名");
      return;
    }
    if (!isStrongPassword(password)) {
      setError("初始密码至少 8 位，且需同时包含大写字母、小写字母和数字");
      return;
    }
    const cleanPhone = phone.replace(/[^\d]/g, "");
    if (cleanPhone && cleanPhone.length !== 11) {
      setError("手机号需为大陆 11 位号码");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await onCreate({ username: cleanUsername, name: cleanName, role, password, phone: cleanPhone });
      reset();
      close(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "账户创建失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  };

  const passwordRules = [
    { label: "至少 8 位", met: password.length >= 8 },
    { label: "含大写字母", met: /[A-Z]/.test(password) },
    { label: "含小写字母", met: /[a-z]/.test(password) },
    { label: "含数字", met: /\d/.test(password) },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus size={18} />创建账户
          </DialogTitle>
          <DialogDescription>
            填写以下信息创建新账户，创建后可随时在账户管理中修改。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label>账户身份</Label>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(allowRoles.length, 3)}, 1fr)` }}>
              {ROLE_OPTIONS.filter((option) => allowRoles.includes(option.value)).map((option) => {
                const Icon = option.icon;
                const selected = role === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRole(option.value)}
                    className={`role-card ${selected ? "role-card-selected" : ""}`}
                    aria-pressed={selected}
                  >
                    <Icon size={17} />
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-username">
              登录账号{role === "student" ? "（学号）" : ""}
            </Label>
            <Input
              id="new-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={role === "student" ? "例如 2531062101" : "例如 teacher_liu"}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              2-32 位字母、数字、下划线或连字符，创建后不可与现有账号重复
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">姓名</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="真实姓名，将显示在任务与档案中"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-password">初始密码</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => { setPassword(generatePassword()); setShowPassword(true); }}
              >
                <RefreshCw size={13} />随机生成
              </Button>
            </div>
            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请告知本人，首次登录后可自行修改"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {passwordRules.map((rule) => (
                <span key={rule.label} className={`password-rule ${rule.met ? "met" : ""}`}>
                  {rule.met ? <CheckCircle2 size={12} /> : null}
                  {rule.label}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-phone">手机号（选填）</Label>
            <Input
              id="new-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/[^\d]/g, "").slice(0, 11))}
              placeholder="11 位手机号"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">绑定后可通过短信验证码自助找回密码</p>
          </div>

          {error && (
            <div className="account-message error justify-start">
              <AlertCircle size={14} />{error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={creating}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={creating || !username.trim() || !name.trim() || !password}>
            {creating ? "创建中…" : "创建账户"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PeopleManagerProps {
  open: boolean;
  people: Person[];
  currentUserId: string;
  /** 可创建的角色列表（admin 全部；teacher 仅学生） */
  allowRoles?: Role[];
  /** 仅显示这些 person 的列表（老师只见自己可管理的学生），null=全部 */
  restrictedToIds?: Set<string> | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (account: NewAccount) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateAccount: (
    personId: string,
    updates: { username: string; name: string; phone?: string | null }
  ) => Promise<void>;
  onSetPassword: (personId: string, password: string) => Promise<void>;
  onReorder: (personIds: string[]) => void;
  onArchive: (id: string, status: "active" | "archived") => void;
}

interface AccountRowProps {
  person: Person;
  boundPhone: string;
  onPhonesChanged: () => void;
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
  boundPhone,
  onPhonesChanged,
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
  const [phone, setPhone] = useState(boundPhone);
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
      const cleanPhone = phone.replace(/[^\d]/g, "");
      if (cleanPhone && cleanPhone.length !== 11) {
        setMessage({ type: "error", text: "手机号需为大陆 11 位" });
        return;
      }
      await onUpdateAccount(person.id, {
        username: cleanUsername,
        name: cleanName,
        phone: cleanPhone,
      });
      onPhonesChanged();
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
          {person.role === "admin" ? (
            <Shield size={16} />
          ) : person.role === "teacher" ? (
            <GraduationCap size={16} />
          ) : (
            <User size={16} />
          )}
        </span>
        <div>
          <strong>{person.name}</strong>
          <span>
            {person.role === "admin"
              ? "管理员"
              : person.role === "teacher"
                ? "老师"
                : "学生"}
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
        <div>
          <label htmlFor={`phone-${person.id}`}>手机号（找回密码）</label>
          <Input
            id={`phone-${person.id}`}
            value={phone}
            onChange={(event) => setPhone(event.target.value.replace(/[^\d]/g, "").slice(0, 11))}
            placeholder="选填"
            inputMode="numeric"
          />
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
  allowRoles = ["student", "teacher", "admin"],
  restrictedToIds = null,
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
  const [createOpen, setCreateOpen] = useState(false);
  const [phones, setPhones] = useState<Record<string, string>>({});

  const loadPhones = useCallback(() => {
    api.listUserPhones().then((data) => setPhones(data.phones)).catch(() => undefined);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (next) loadPhones();
    onOpenChange(next);
  };

  const visible = (person: Person) =>
    !restrictedToIds || restrictedToIds.has(person.id);

  const activePeople = useMemo(
    () =>
      people
        .filter((person) => person.status !== "archived" && visible(person))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [people, restrictedToIds]
  );
  const archivedPeople = useMemo(
    () => people.filter((person) => person.status === "archived" && visible(person)),
    [people, restrictedToIds]
  );

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
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      onReorder(ids);
    }
    setDraggedId(null);
  }, [activePeople, draggedId, onReorder]);

  const renderRows = (rows: Person[]) => rows.length ? rows.map((person) => (
    <AccountRow
      key={person.id}
      person={person}
      boundPhone={phones[person.id] || ""}
      onPhonesChanged={loadPhones}
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="account-manager sm:max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={19} />账户管理
          </DialogTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="account-create-btn">
            <UserPlus size={15} />创建账户
          </Button>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">启用账户 ({activePeople.length})</TabsTrigger>
            <TabsTrigger value="archived">停用账户 ({archivedPeople.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="account-list">{renderRows(activePeople)}</TabsContent>
          <TabsContent value="archived" className="account-list">{renderRows(archivedPeople)}</TabsContent>
        </Tabs>

        <CreateAccountDialog
          open={createOpen}
          allowRoles={allowRoles}
          onOpenChange={setCreateOpen}
          onCreate={onAdd}
          onCreated={loadPhones}
        />
      </DialogContent>
    </Dialog>
  );
}
