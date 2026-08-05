import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from "lucide-react";

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

            <button
              className="login-submit"
              type="submit"
              disabled={loading || !username.trim() || !password}
            >
              {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
              {loading ? "正在验证" : "进入工作台"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
