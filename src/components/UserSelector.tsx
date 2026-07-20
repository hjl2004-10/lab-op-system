import { useState, useMemo, useCallback } from "react";
import {
  Users,
  Shield,
  User,
  GraduationCap,
  ArrowLeft,
  KeyRound,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// Password is always required for all users
import type { Person } from "@/types";

type Mode = "select" | "password" | "init-student";

interface UserSelectorProps {
  open: boolean;
  people: Person[];
  onSelect: (personId: string) => void;
  onPasswordCheck: (personId: string, password: string) => boolean;
  onInitStudent?: (name: string, syncCode: string) => { success: boolean; personName?: string };
}

export default function UserSelector({
  open,
  people,
  onSelect,
  onPasswordCheck,
  onInitStudent,
}: UserSelectorProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  // Init student state
  const [initStep, setInitStep] = useState<1 | 2>(1);
  const [studentName, setStudentName] = useState("");
  const [syncCode, setSyncCode] = useState("");
  const [initLoading, setInitLoading] = useState(false);
  const [initError, setInitError] = useState("");

  const activePeople = useMemo(
    () => people.filter((p) => p.status === "active"),
    [people]
  );

  const resetPasswordState = useCallback(() => {
    setPassword("");
    setPasswordError(false);
  }, []);

  const resetInitState = useCallback(() => {
    setInitStep(1);
    setStudentName("");
    setSyncCode("");
    setInitLoading(false);
    setInitError("");
  }, []);

  const goToSelect = useCallback(() => {
    setMode("select");
    setSelectedPerson(null);
    resetPasswordState();
    resetInitState();
  }, [resetPasswordState, resetInitState]);

  const handlePersonClick = useCallback(
    (person: Person) => {
      setSelectedPerson(person);
      resetPasswordState();

      // All users must enter password
      setMode("password");
    },
    [onSelect, resetPasswordState]
  );

  const handlePasswordSubmit = useCallback(() => {
    if (!selectedPerson || !password.trim()) return;
    const ok = onPasswordCheck(selectedPerson.id, password);
    if (ok) {
      onSelect(selectedPerson.id);
      resetPasswordState();
    } else {
      setPasswordError(true);
    }
  }, [selectedPerson, password, onPasswordCheck, onSelect, resetPasswordState]);

  const handleNewStudentClick = useCallback(() => {
    setMode("init-student");
    resetInitState();
  }, [resetInitState]);

  const handleInitNextStep = useCallback(() => {
    if (!studentName.trim()) return;
    setInitStep(2);
    setInitError("");
  }, [studentName]);

  const handleInitSubmit = useCallback(async () => {
    if (!studentName.trim() || !syncCode.trim() || !onInitStudent) return;
    setInitLoading(true);
    setInitError("");

    try {
      const result = onInitStudent(studentName.trim(), syncCode.trim());
      if (!result.success) {
        setInitError("导入失败，请检查同步码是否正确。");
      }
      // On success, parent handles selection — nothing more to do here
    } catch {
      setInitError("导入时发生错误，请重试。");
    } finally {
      setInitLoading(false);
    }
  }, [studentName, syncCode, onInitStudent]);

  const renderAvatar = (person: Person, icon: React.ReactNode) => (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
      style={{ backgroundColor: person.color }}
    >
      <span className="text-white">{icon}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* ====== MODE: SELECT IDENTITY ====== */}
        {mode === "select" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                <Users className="w-5 h-5 text-slate-500" />
                请选择身份
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2 mt-2">
              {/* Active people */}
              {activePeople.map((person) => (
                <button
                  key={person.id}
                  onClick={() => handlePersonClick(person)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
                    "hover:bg-slate-50 dark:hover:bg-slate-800",
                    "border-slate-200 dark:border-slate-700"
                  )}
                >
                  {renderAvatar(
                    person,
                    person.role === "admin" ? (
                      <Shield className="w-5 h-5" />
                    ) : (
                      <User className="w-5 h-5" />
                    )
                  )}
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {person.name}
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full",
                          person.role === "admin"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                        )}
                      >
                        {person.role === "admin" ? "管理员" : "成员"}
                      </span>
                    </span>
                  </div>
                </button>
              ))}

              {/* New student option */}
              <button
                onClick={handleNewStudentClick}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
                  "hover:bg-slate-50 dark:hover:bg-slate-800",
                  "border-slate-200 dark:border-slate-700"
                )}
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    新学生
                  </span>
                  <span className="text-xs text-slate-400">
                    首次登录，请选这里
                  </span>
                </div>
              </button>
            </div>
          </>
        )}

        {/* ====== MODE: PASSWORD ENTRY ====== */}
        {mode === "password" && selectedPerson && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <button
                  onClick={goToSelect}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5 text-slate-500" />
                </button>
                <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                  <KeyRound className="w-5 h-5 text-slate-500" />
                  输入密码
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 mt-2">
              {/* Selected person avatar + name */}
              <div className="flex flex-col items-center gap-2">
                {renderAvatar(
                  selectedPerson,
                  selectedPerson.role === "admin" ? (
                    <Shield className="w-6 h-6" />
                  ) : (
                    <User className="w-6 h-6" />
                  )
                )}
                <span className="text-base font-medium text-slate-900 dark:text-slate-100">
                  {selectedPerson.name}
                </span>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    selectedPerson.role === "admin"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                  )}
                >
                  {selectedPerson.role === "admin" ? "管理员" : "成员"}
                </span>
              </div>

              {/* Password input */}
              <div className="w-full space-y-2">
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handlePasswordSubmit();
                    }
                  }}
                  className="h-10 w-full"
                  autoFocus
                />
                {passwordError && (
                  <p className="text-xs text-red-500 text-center">
                    密码错误或尚未设置，请联系杨老师
                  </p>
                )}
                <Button
                  className="w-full h-10"
                  onClick={handlePasswordSubmit}
                  disabled={!password.trim()}
                >
                  进入
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ====== MODE: INIT STUDENT ====== */}
        {mode === "init-student" && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <button
                  onClick={goToSelect}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5 text-slate-500" />
                </button>
                <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="w-5 h-5 text-emerald-500" />
                  新学生初始化
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Step 1: Student name */}
              {initStep === 1 && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      请输入你的姓名
                    </label>
                    <Input
                      placeholder="例如：王小明"
                      value={studentName}
                      onChange={(e) => {
                        setStudentName(e.target.value);
                        setInitError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleInitNextStep();
                        }
                      }}
                      className="h-10"
                      autoFocus
                    />
                  </div>
                  <Button
                    className="w-full h-10"
                    onClick={handleInitNextStep}
                    disabled={!studentName.trim()}
                  >
                    下一步
                  </Button>
                </div>
              )}

              {/* Step 2: Sync code */}
              {initStep === 2 && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      请输入老师提供的同步码
                    </label>
                    <p className="text-xs text-slate-400">
                      姓名：{studentName}
                    </p>
                  </div>
                  <Textarea
                    placeholder="将同步码粘贴到这里..."
                    value={syncCode}
                    onChange={(e) => {
                      setSyncCode(e.target.value);
                      setInitError("");
                    }}
                    className="min-h-[120px] font-mono text-sm"
                    autoFocus
                  />
                  {initError && (
                    <p className="text-xs text-red-500">{initError}</p>
                  )}
                  <Button
                    className="w-full h-10"
                    onClick={handleInitSubmit}
                    disabled={!syncCode.trim() || initLoading}
                  >
                    {initLoading ? "处理中..." : "导入并创建角色"}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
