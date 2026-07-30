import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
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

const previewRows = [
  { name: "论文实验复现", owner: "杨嘉鑫", start: 7, width: 43, color: "#236b5a", progress: "68%" },
  { name: "数据集清洗", owner: "蔡雨萱", start: 20, width: 32, color: "#c26a3b", progress: "45%" },
  { name: "组会材料整理", owner: "杨老师", start: 2, width: 56, color: "#3e5d7a", progress: "82%" },
  { name: "阶段报告提交", owner: "杨嘉鑫", start: 48, width: 24, color: "#7d6a37", progress: "20%" },
];

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
      <header className="login-brand">
        <div className="login-mark" aria-hidden="true">
          <CalendarDays size={19} strokeWidth={2} />
        </div>
        <div>
          <strong>YANG11 LAB</strong>
          <span>进度协作台</span>
        </div>
      </header>

      <section className="login-preview" aria-label="甘特图工作区预览">
        <div className="preview-heading">
          <span>2026 / SUMMER</span>
          <h1>把实验进度放在同一条时间线上</h1>
        </div>
        <div className="preview-board">
          <div className="preview-toolbar">
            <span>课题组总览</span>
            <div>
              <span>周视图</span>
              <CheckCircle2 size={14} />
            </div>
          </div>
          <div className="preview-grid">
            <div className="preview-dates">
              <span>07.13</span><span>07.20</span><span>07.27</span><span>08.03</span>
            </div>
            {previewRows.map((row) => (
              <div className="preview-row" key={row.name}>
                <div className="preview-label">
                  <strong>{row.name}</strong>
                  <span>{row.owner}</span>
                </div>
                <div className="preview-track">
                  <div
                    className="preview-task"
                    style={{ left: `${row.start}%`, width: `${row.width}%`, background: row.color }}
                  >
                    <span>{row.progress}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-kicker"><LockKeyhole size={15} /> 安全工作区</div>
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

            <button className="login-submit" type="submit" disabled={loading || !username.trim() || !password}>
              {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
              {loading ? "正在验证" : "进入工作台"}
            </button>
          </form>
        </div>
        <footer>YANG11 Laboratory · Gantt Workspace</footer>
      </section>
    </main>
  );
}
