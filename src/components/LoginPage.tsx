import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Smartphone,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<void>;
}

type Page = "login" | "forgot-step1" | "forgot-step2";

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [page, setPage] = useState<Page>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // 忘记密码流程状态
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotPhone, setForgotPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      await onLogin(username.trim(), password);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!forgotUsername.trim() || !forgotPhone.trim() || loading || cooldown > 0) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api.forgotSend(forgotUsername.trim(), forgotPhone.trim());
      setCooldown(60);
      setNotice("验证码已发送，请查收短信（5 分钟内有效）");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发送失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api.forgotReset(
        forgotUsername.trim(),
        forgotPhone.trim(),
        code.trim(),
        newPassword
      );
      setNotice("密码重置成功，请使用新密码登录");
      setPage("login");
      setUsername(forgotUsername.trim());
      setPassword("");
      setCode("");
      setNewPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重置失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <header className="login-brand" aria-hidden="true">
        <div className="login-mark">
          <CalendarDays size={19} strokeWidth={2} />
        </div>
        <div>
          <strong>YANG11 LAB</strong>
          <span>进度协作台</span>
        </div>
      </header>

      <section className="login-panel">
        <div className="login-form-wrap">
          {page === "login" && (
            <>
              <div className="login-kicker">
                <LockKeyhole size={15} /> 安全工作区
              </div>
              <h2>登录实验室</h2>
              <p>使用分配给你的身份与密码进入。</p>

              <form onSubmit={handleSubmit}>
                <label htmlFor="login-user">管理员账号 / 学号</label>
                <div className="login-control">
                  <UserRound size={18} />
                  <input
                    id="login-user"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setError("");
                      setNotice("");
                    }}
                    placeholder="输入账号或学号"
                    autoComplete="username"
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <label htmlFor="login-password">密码</label>
                <div className="login-control">
                  <KeyRound size={18} />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                      setNotice("");
                    }}
                    placeholder="输入登录密码"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <div className="login-meta">
                  <span className="role-dot" />
                  统一身份认证
                </div>

                {error && <div className="login-error" role="alert">{error}</div>}
                {notice && !error && (
                  <div className="login-notice" role="status">{notice}</div>
                )}

                <button
                  className="login-submit"
                  type="submit"
                  disabled={loading || !username.trim() || !password}
                >
                  {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
                  {loading ? "正在验证" : "进入工作台"}
                </button>

                <button
                  type="button"
                  className="login-forgot-link"
                  onClick={() => {
                    setPage("forgot-step1");
                    setError("");
                    setNotice("");
                  }}
                >
                  忘记密码？
                </button>
              </form>
            </>
          )}

          {page === "forgot-step1" && (
            <>
              <div className="login-kicker">
                <Smartphone size={15} /> 找回密码
              </div>
              <h2>验证身份</h2>
              <p>输入学号与绑定的手机号，接收短信验证码。</p>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSendCode();
                }}
              >
                <label htmlFor="forgot-user">学号 / 账号</label>
                <div className="login-control">
                  <UserRound size={18} />
                  <input
                    id="forgot-user"
                    value={forgotUsername}
                    onChange={(event) => {
                      setForgotUsername(event.target.value);
                      setError("");
                    }}
                    placeholder="输入学号或账号"
                    autoComplete="username"
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <label htmlFor="forgot-phone">绑定手机号</label>
                <div className="login-control">
                  <Smartphone size={18} />
                  <input
                    id="forgot-phone"
                    value={forgotPhone}
                    onChange={(event) => {
                      setForgotPhone(event.target.value.replace(/[^\d]/g, "").slice(0, 11));
                      setError("");
                    }}
                    placeholder="11 位手机号"
                    inputMode="numeric"
                    disabled={loading}
                  />
                </div>

                {error && <div className="login-error" role="alert">{error}</div>}
                {notice && !error && (
                  <div className="login-notice" role="status">{notice}</div>
                )}

                <button
                  className="login-submit"
                  type="submit"
                  disabled={loading || !forgotUsername.trim() || forgotPhone.length !== 11 || cooldown > 0}
                >
                  {loading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <MessageSquareText size={18} />
                  )}
                  {cooldown > 0 ? `重新发送（${cooldown}s）` : "获取短信验证码"}
                </button>

                {notice && !error && (
                  <button
                    type="button"
                    className="login-submit login-submit-secondary"
                    onClick={() => setPage("forgot-step2")}
                  >
                    已收到验证码，下一步 <ArrowRight size={16} />
                  </button>
                )}

                <button
                  type="button"
                  className="login-forgot-link"
                  onClick={() => {
                    setPage("login");
                    setError("");
                    setNotice("");
                  }}
                >
                  <ArrowLeft size={14} /> 返回登录
                </button>
              </form>
            </>
          )}

          {page === "forgot-step2" && (
            <>
              <div className="login-kicker">
                <KeyRound size={15} /> 重置密码
              </div>
              <h2>设置新密码</h2>
              <p>
                验证码已发送至 {forgotPhone.slice(0, 3)}****{forgotPhone.slice(7)}（5 分钟内有效）。
              </p>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleReset();
                }}
              >
                <label htmlFor="forgot-code">短信验证码</label>
                <div className="login-control">
                  <MessageSquareText size={18} />
                  <input
                    id="forgot-code"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6));
                      setError("");
                    }}
                    placeholder="6 位数字"
                    inputMode="numeric"
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <label htmlFor="forgot-new-password">新密码</label>
                <div className="login-control">
                  <KeyRound size={18} />
                  <input
                    id="forgot-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      setError("");
                    }}
                    placeholder="至少 8 位，含大写、小写字母和数字"
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>

                {error && <div className="login-error" role="alert">{error}</div>}

                <button
                  className="login-submit"
                  type="submit"
                  disabled={loading || code.length !== 6 || !newPassword}
                >
                  {loading ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
                  {loading ? "正在重置" : "重置密码"}
                </button>

                <button
                  type="button"
                  className="login-forgot-link"
                  onClick={() => {
                    setPage("forgot-step1");
                    setError("");
                  }}
                >
                  <ArrowLeft size={14} /> 上一步
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
