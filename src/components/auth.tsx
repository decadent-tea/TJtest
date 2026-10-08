import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { App } from "@/App";
import { useUnsavedChanges } from "./unsaved-changes";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  passwordHelp,
  passwordPattern,
  type AuthState,
  type User,
  roleLabel,
  hasPermission,
} from "../../shared/auth";

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "new-password",
  required = true,
  help = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  help?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="password-controls">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          maxLength={128}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {help && <FieldDescription>{passwordHelp}</FieldDescription>}
    </Field>
  );
}

export function AuthRoot() {
  const [state, setState] = useState<AuthState>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const accept = (user: User) => {
    epoch.current++;
    const previous = sessionStorage.getItem("studio-user");
    if (previous && previous !== user.id) sessionStorage.clear();
    sessionStorage.setItem("studio-user", user.id);
    if (
      !hasPermission(user, "workspace.use") &&
      ["", "#overview"].includes(location.hash)
    )
      location.hash = hasPermission(user, "users.manage") ? "users" : "roles";
    setState({ setupRequired: false, user });
    setNotice("");
  };
  const check = useCallback(async () => {
    const version = epoch.current;
    try {
      const next = await api<AuthState>("/auth/session");
      if (version !== epoch.current) return;
      if (next.user) {
        const previous = sessionStorage.getItem("studio-user");
        if (previous && previous !== next.user.id) sessionStorage.clear();
        sessionStorage.setItem("studio-user", next.user.id);
      }
      setState(next);
      setError("");
    } catch (e) {
      if (version === epoch.current)
        setError(e instanceof Error ? e.message : "连接失败，请重试。");
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  useEffect(() => {
    const expired = () => {
      epoch.current++;
      setState({ setupRequired: false, user: null });
      setNotice("登录已失效，请重新登录后继续。");
    };
    window.addEventListener("studio:auth-expired", expired);
    return () => window.removeEventListener("studio:auth-expired", expired);
  }, []);
  useEffect(() => {
    if (!state?.user) return;
    const timer = setInterval(() => void check(), 60_000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [state?.user?.id, check]);
  const endSession = () => {
    epoch.current++;
    sessionStorage.clear();
    location.hash = "overview";
    setState({ setupRequired: false, user: null });
  };
  if (state?.user)
    return (
      <App
        key={state.user.id}
        user={state.user}
        onLogout={async () => {
          await api("/auth/logout", {});
          endSession();
        }}
        onSessionRefresh={check}
        onPasswordChanged={() => {
          endSession();
          setNotice("密码已修改，请使用新密码登录。");
        }}
      />
    );
  if (!state)
    return (
      <div className="auth-loading" role="status">
        <Activity />
        <h1>巡检台</h1>
        {error ? (
          <>
            <p>{error}</p>
            <Button onClick={() => void check()}>重新连接</Button>
          </>
        ) : (
          <>
            <LoaderCircle className="animate-spin" />
            <p>正在连接工作空间…</p>
          </>
        )}
      </div>
    );
  return (
    <LoginPage
      setup={state.setupRequired}
      notice={notice}
      onLogin={accept}
      onRefreshSession={check}
    />
  );
}

function LoginPage({
  setup,
  notice,
  onLogin,
  onRefreshSession,
}: {
  setup: boolean;
  notice: string;
  onLogin: (user: User) => void;
  onRefreshSession: () => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const pending = useRef(false);
  const captchaVersion = useRef(0);
  const captchaStarted = useRef(false);
  const refreshCaptcha = useCallback(async () => {
    const version = ++captchaVersion.current;
    setLoadingCaptcha(true);
    setCaptcha("");
    setCaptchaError("");
    setImage("");
    try {
      const value = await api<{ image: string }>("/auth/captcha");
      if (version === captchaVersion.current) setImage(value.image);
    } catch (e) {
      if (version === captchaVersion.current)
        setCaptchaError(e instanceof Error ? e.message : "验证码加载失败。");
    } finally {
      if (version === captchaVersion.current) setLoadingCaptcha(false);
    }
  }, []);
  useEffect(() => {
    if (!captchaStarted.current) {
      captchaStarted.current = true;
      void refreshCaptcha();
    }
  }, [refreshCaptcha]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    if (setup && !passwordPattern.test(password)) {
      setError(passwordHelp);
      return;
    }
    if (setup && password !== confirm) {
      setError("两次密码输入不一致。");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const user = await api<User>(setup ? "/auth/setup" : "/auth/login", {
        username,
        password,
        captcha,
        ...(setup ? { displayName } : {}),
      });
      onLogin(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败，请重试。");
      await refreshCaptcha();
      if (setup) await onRefreshSession();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="巡检台介绍">
        <a className="auth-brand" href="#overview">
          <span>
            <Activity />
          </span>
          <strong>
            巡检台<small>HEALTH STUDIO</small>
          </strong>
        </a>
        <div className="auth-story-content">
          <div className="eyebrow">北斗天地 · WEB 体检工作空间</div>
          <h1>
            每一次操作，
            <br />
            都有可靠的<span>结论。</span>
          </h1>
          <p>
            记录业务过程，关联执行证据。
            <br />
            让风险可追溯，让复检有依据。
          </p>
          <div className="auth-instrument" aria-hidden="true">
            <div className="auth-orbit">
              <i />
              <i />
              <i />
              <div className="auth-radar-sweep" />
              <span className="auth-radar-dot" />
              <span className="auth-radar-dot second" />
              <div className="auth-orbit-core">
                <Activity />
              </div>
            </div>
            <div className="auth-evidence-strip">
              <span>
                <i />
                操作记录
              </span>
              <b />
              <span>
                <i />
                执行证据
              </span>
              <b />
              <span>
                <i />
                风险结论
              </span>
            </div>
          </div>
        </div>
        <footer>
          <span>操作有记录，结论有证据。</span>
          <span>北斗天地股份有限公司</span>
        </footer>
      </section>
      <section className="auth-form-section">
        <motion.div
          className="auth-form-panel"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="auth-security-label">
            <ShieldCheck /> {setup ? "初始化工作空间" : "账号安全访问"}
          </div>
          <h2>{setup ? "创建管理员" : "欢迎回来"}</h2>
          <p className="auth-form-intro">
            {setup
              ? "首次使用，请设置管理员账号。创建后即可管理团队用户。"
              : "登录巡检台，继续你的 Web 体检。"}
          </p>
          {notice && (
            <Alert className="mb-5">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={busy} className="min-w-0">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="login-username">账号</FieldLabel>
                  <Input
                    id="login-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="请输入账号"
                    required
                    maxLength={32}
                    pattern={setup ? "[a-zA-Z0-9_.\\-]{3,32}" : undefined}
                  />
                  {setup && (
                    <FieldDescription>
                      3–32 位字母、数字、下划线、点或连字符。
                    </FieldDescription>
                  )}
                </Field>
                {setup && (
                  <Field>
                    <FieldLabel htmlFor="login-name">姓名</FieldLabel>
                    <Input
                      id="login-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="你的姓名"
                      autoComplete="name"
                      required
                      maxLength={50}
                    />
                  </Field>
                )}
                <PasswordField
                  id="login-password"
                  label="密码"
                  value={password}
                  onChange={setPassword}
                  autoComplete={setup ? "new-password" : "current-password"}
                  help={setup}
                />
                {setup && (
                  <PasswordField
                    id="login-confirm"
                    label="确认密码"
                    value={confirm}
                    onChange={setConfirm}
                  />
                )}
                <Field>
                  <FieldLabel htmlFor="login-captcha">验证码</FieldLabel>
                  <div className="captcha-controls">
                    <Input
                      id="login-captcha"
                      value={captcha}
                      onChange={(e) => setCaptcha(e.target.value.toUpperCase())}
                      placeholder="输入图中字符"
                      autoComplete="off"
                      required
                      maxLength={4}
                    />
                    <Button
                      variant="outline"
                      type="button"
                      className="captcha-image"
                      disabled={loadingCaptcha}
                      aria-label="刷新验证码"
                      onClick={() => void refreshCaptcha()}
                    >
                      {loadingCaptcha ? (
                        <LoaderCircle className="animate-spin" />
                      ) : image ? (
                        <img src={image} alt="图片验证码" />
                      ) : (
                        <RefreshCw />
                      )}
                    </Button>
                  </div>
                  <FieldDescription>
                    不区分大小写，点击图片可更换。
                  </FieldDescription>
                  {captchaError && (
                    <p role="alert" className="text-destructive text-sm">
                      {captchaError}
                    </p>
                  )}
                </Field>
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>
                      {setup ? "创建未完成" : "登录未完成"}
                    </AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  type="submit"
                  variant="launch"
                  size="lg"
                  className="auth-submit"
                  disabled={busy || loadingCaptcha || !image}
                >
                  {busy ? (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <LockKeyhole data-icon="inline-start" />
                  )}
                  {busy
                    ? setup
                      ? "正在创建…"
                      : "正在登录…"
                    : setup
                      ? "创建并进入工作空间"
                      : "登录工作空间"}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </FieldGroup>
            </fieldset>
          </form>
          <p className="auth-help">
            {setup
              ? "管理员可新增用户、调整权限和重置密码。"
              : "忘记密码？请联系系统管理员重置。"}
          </p>
        </motion.div>
        <span className="auth-form-footer">巡检台 · Web 体检工作室</span>
      </section>
    </main>
  );
}

export function AccountPanel({
  user,
  onLogout,
  onPasswordChanged,
}: {
  user: User;
  onLogout: () => void;
  onPasswordChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const { requestClose, confirmation } = useUnsavedChanges(
    open && changing && (!!currentPassword || !!password || !!confirm),
    busy,
    () => setOpen(false),
  );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    if (!passwordPattern.test(password)) {
      setError(passwordHelp);
      return;
    }
    if (password !== confirm) {
      setError("两次密码输入不一致。");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/auth/password", { currentPassword, password });
      onPasswordChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "密码修改失败。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        className="account-trigger"
        aria-label="账户与安全"
        onClick={() => {
          setOpen(true);
          setChanging(false);
          setError("");
          setCurrentPassword("");
          setPassword("");
          setConfirm("");
        }}
      >
        <span className="top-avatar">{user.displayName.slice(0, 1)}</span>
        <span>{user.displayName}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) requestClose();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{changing ? "修改密码" : "账户与安全"}</DialogTitle>
            <DialogDescription>
              {changing
                ? "修改成功后，所有已登录会话会退出，请使用新密码登录。"
                : `${user.displayName} · ${user.username} · ${roleLabel(user)}`}
            </DialogDescription>
          </DialogHeader>
          {changing ? (
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <FieldGroup>
                  <PasswordField
                    id="account-current"
                    label="当前密码"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    autoComplete="current-password"
                  />
                  <PasswordField
                    id="account-new"
                    label="新密码"
                    value={password}
                    onChange={setPassword}
                    help
                  />
                  <PasswordField
                    id="account-confirm"
                    label="确认新密码"
                    value={confirm}
                    onChange={setConfirm}
                  />
                  {error && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={requestClose}
                    >
                      取消修改
                    </Button>
                    <Button type="submit" disabled={busy}>
                      {busy && <LoaderCircle className="animate-spin" />}
                      保存新密码
                    </Button>
                  </DialogFooter>
                </FieldGroup>
              </fieldset>
            </form>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setChanging(true)}>
                <LockKeyhole data-icon="inline-start" />
                修改密码
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <LogOut data-icon="inline-start" />
                退出登录
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  );
}
