import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageTitle, Blank } from "./studio";
import { PasswordField } from "./auth";
import { Pagination, currentPage } from "./pagination";
import { useUnsavedChanges } from "./unsaved-changes";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "./ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";
import {
  passwordHelp,
  passwordPattern,
  type User,
  type UserRole,
  type Role,
  hasPermission,
  permissionCatalog,
  roleLabel,
} from "../../shared/auth";

const dateTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未登录";
type Confirmation = { kind: "delete" | "status"; user: User };
export function UserManagement({
  currentUser,
  onSessionRefresh,
  initialRole,
}: {
  currentUser: User;
  onSessionRefresh: () => Promise<void>;
  initialRole?: string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(initialRole || "all");
  useEffect(() => {
    setRole(initialRole || "all");
    setPage(0);
  }, [initialRole]);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [editor, setEditor] = useState<User | "new">();
  const [view, setView] = useState<User>();
  const [resetUser, setResetUser] = useState<User>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const pending = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextUsers, nextRoles] = await Promise.all([
        api<User[]>("/users"),
        api<Role[]>("/roles/options"),
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "用户列表读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const filtered = users.filter(
    (user) =>
      `${user.username} ${user.displayName}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (role === "all" || user.role === role) &&
      (status === "all" || String(user.enabled) === status),
  );
  const shownPage = currentPage(page, filtered.length, size);
  const lastAdmin =
    users.filter((user) => user.enabled && user.role === "admin").length === 1;
  const protectedUser = (user: User) =>
    user.id === currentUser.id ||
    (lastAdmin && user.enabled && user.role === "admin");
  const canEdit = (user: User) =>
    permissionCatalog.every(
      (permission) =>
        !hasPermission(user, permission.id) ||
        hasPermission(currentUser, permission.id),
    );
  const filterRoles = [
    ...roles.map((role) => ({ id: role.id, name: role.name })),
  ];
  for (const user of users)
    if (!filterRoles.some((role) => role.id === user.role))
      filterRoles.push({ id: user.role, name: roleLabel(user) });
  const confirmAction = async () => {
    if (!confirmation || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError("");
    try {
      const { kind, user } = confirmation;
      if (kind === "delete")
        await api(`/users/${user.id}`, undefined, "DELETE");
      else
        await api(
          `/users/${user.id}`,
          {
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            enabled: !user.enabled,
          },
          "PUT",
        );
      toast.success(
        kind === "delete"
          ? "用户已删除。"
          : user.enabled
            ? "用户已停用，已有登录会话已失效。"
            : "用户已启用。",
      );
      setConfirmation(undefined);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const openConfirmation = (kind: Confirmation["kind"], user: User) => {
    setActionError("");
    setConfirmation({ kind, user });
  };
  return (
    <>
      <PageTitle
        eyebrow="ACCESS / TEAM"
        title="用户管理"
        description="管理团队账号、访问权限与登录状态。"
        actions={
          <Button variant="launch" onClick={() => setEditor("new")}>
            <Plus data-icon="inline-start" />
            新增用户
          </Button>
        }
      />
      <div className="user-summary">
        <div>
          <Users />
          <span>
            团队用户<strong>{users.length}</strong>
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            管理权限
            <strong>
              {
                users.filter(
                  (u) =>
                    hasPermission(u, "users.manage") ||
                    hasPermission(u, "roles.manage"),
                ).length
              }
            </strong>
          </span>
        </div>
        <div>
          <UserRound />
          <span>
            已启用<strong>{users.filter((u) => u.enabled).length}</strong>
          </span>
        </div>
        <p>用户通过角色获得功能权限。新增或编辑用户时可分配已创建的角色。</p>
      </div>
      <Card className="user-list-card">
        <CardHeader>
          <CardTitle>团队账号</CardTitle>
          <CardDescription>
            密码不会在列表中显示。需要恢复访问时，请使用密码重置。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="user-toolbar">
            <div className="search-wrap">
              <Search />
              <Input
                aria-label="搜索用户"
                placeholder="搜索账号或姓名"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              value={role}
              onValueChange={(value) => {
                setRole(value);
                setPage(0);
              }}
            >
              <SelectTrigger aria-label="筛选角色">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部角色</SelectItem>
                  {filterRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(0);
              }}
            >
              <SelectTrigger aria-label="筛选用户状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="true">已启用</SelectItem>
                  <SelectItem value="false">已停用</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw
                data-icon="inline-start"
                className={loading ? "animate-spin" : undefined}
              />
              刷新
            </Button>
          </div>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>用户列表读取失败</AlertTitle>
              <AlertDescription>
                {error}
                <Button variant="outline" onClick={() => void load()}>
                  重新读取
                </Button>
              </AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="user-list-loading" role="status">
              <LoaderCircle className="animate-spin" />
              正在读取用户…
            </div>
          ) : filtered.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>最近登录</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered
                    .slice(shownPage * size, (shownPage + 1) * size)
                    .map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="user-identity">
                            <span className="user-avatar">
                              {user.displayName.slice(0, 1)}
                            </span>
                            <div>
                              <Button
                                variant="link"
                                aria-label={`查看用户 ${user.username}`}
                                onClick={() => setView(user)}
                              >
                                {user.displayName}
                              </Button>
                              <small>{user.username}</small>
                            </div>
                            {user.id === currentUser.id && (
                              <Badge variant="outline">当前账号</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              hasPermission(user, "users.manage") ||
                              hasPermission(user, "roles.manage")
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {(hasPermission(user, "users.manage") ||
                              hasPermission(user, "roles.manage")) && (
                              <ShieldCheck data-icon="inline-start" />
                            )}
                            {roleLabel(user)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={user.enabled ? "secondary" : "outline"}
                          >
                            {user.enabled ? "已启用" : "已停用"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {dateTime(user.lastLoginAt)}
                        </TableCell>
                        <TableCell>
                          <div className="user-row-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit(user)}
                              onClick={() => setEditor(user)}
                            >
                              <Pencil data-icon="inline-start" />
                              编辑
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                user.id === currentUser.id || !canEdit(user)
                              }
                              title={
                                user.id === currentUser.id
                                  ? "当前账号请从右上角账户与安全修改密码"
                                  : undefined
                              }
                              onClick={() => setResetUser(user)}
                            >
                              <KeyRound data-icon="inline-start" />
                              重置密码
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={
                                !canEdit(user) ||
                                (user.enabled && protectedUser(user))
                              }
                              title={
                                protectedUser(user)
                                  ? "不能停用当前账号或最后一位启用的管理员"
                                  : undefined
                              }
                              onClick={() => openConfirmation("status", user)}
                            >
                              {user.enabled ? "停用" : "启用"}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={protectedUser(user) || !canEdit(user)}
                              title={
                                protectedUser(user)
                                  ? "不能删除当前账号或最后一位启用的管理员"
                                  : undefined
                              }
                              onClick={() => openConfirmation("delete", user)}
                            >
                              <Trash2 data-icon="inline-start" />
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <Pagination
                total={filtered.length}
                page={shownPage}
                pageSize={size}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setSize(value);
                  setPage(0);
                }}
              />
            </>
          ) : (
            <Blank
              title="没有匹配的用户"
              description="调整搜索条件或筛选条件后再试。"
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setRole("all");
                    setStatus("all");
                  }}
                >
                  清除筛选
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
      {editor && (
        <UserEditor
          key={editor === "new" ? "new" : editor.id}
          user={editor === "new" ? undefined : editor}
          currentUser={currentUser}
          roles={roles}
          onClose={() => setEditor(undefined)}
          onSaved={async () => {
            setEditor(undefined);
            await load();
            await onSessionRefresh();
          }}
        />
      )}
      {resetUser && (
        <ResetPassword
          user={resetUser}
          onClose={() => setResetUser(undefined)}
        />
      )}
      <Dialog
        open={!!view}
        onOpenChange={(open) => {
          if (!open) setView(undefined);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>用户详情</DialogTitle>
            <DialogDescription>查看账号信息与登录情况。</DialogDescription>
          </DialogHeader>
          {view && (
            <dl className="user-detail">
              <dt>姓名</dt>
              <dd>{view.displayName}</dd>
              <dt>账号</dt>
              <dd>{view.username}</dd>
              <dt>角色</dt>
              <dd>{roleLabel(view)}</dd>
              <dt>状态</dt>
              <dd>{view.enabled ? "已启用" : "已停用"}</dd>
              <dt>创建时间</dt>
              <dd>{dateTime(view.createdAt)}</dd>
              <dt>更新时间</dt>
              <dd>{dateTime(view.updatedAt)}</dd>
              <dt>最近登录</dt>
              <dd>{dateTime(view.lastLoginAt)}</dd>
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(undefined)}>
              关闭
            </Button>
            <Button
              disabled={!!view && !canEdit(view)}
              onClick={() => {
                if (view) setEditor(view);
                setView(undefined);
              }}
            >
              编辑用户
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation?.kind === "delete"
                ? "删除用户？"
                : confirmation?.user.enabled
                  ? "停用用户？"
                  : "启用用户？"}
            </DialogTitle>
            <DialogDescription>
              {confirmation &&
                `${confirmation.user.displayName}（${confirmation.user.username}）`}
              {confirmation?.kind === "delete"
                ? "将无法继续登录，已有会话会立即失效。删除账号不会删除已保存的体检记录和流程。此操作无法撤销。"
                : confirmation?.user.enabled
                  ? "将无法登录，已有会话会立即失效。后续可以重新启用账号。"
                  : "启用后，该用户可使用现有账号和密码登录。"}
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(undefined)}
            >
              取消
            </Button>
            <Button
              variant={
                confirmation?.kind === "delete" || confirmation?.user.enabled
                  ? "destructive"
                  : "default"
              }
              disabled={busy}
              onClick={() => void confirmAction()}
            >
              {busy && <LoaderCircle className="animate-spin" />}
              {confirmation?.kind === "delete"
                ? "确认删除用户"
                : confirmation?.user.enabled
                  ? "确认停用"
                  : "确认启用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserEditor({
  user,
  currentUser,
  roles,
  onClose,
  onSaved,
}: {
  user?: User;
  currentUser: User;
  roles: Role[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initial = {
    username: user?.username || "",
    displayName: user?.displayName || "",
    role:
      user?.role ||
      roles.find((role) => role.id === "user")?.id ||
      roles[0]?.id ||
      "",
    enabled: user?.enabled ?? true,
  };
  const [form, setForm] = useState(initial);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) || !!password || !!confirm;
  const { requestClose, confirmation } = useUnsavedChanges(
    dirty,
    busy,
    onClose,
  );
  const self = user?.id === currentUser.id;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    if (!user && !passwordPattern.test(password)) {
      setError(passwordHelp);
      return;
    }
    if (!user && password !== confirm) {
      setError("两次密码输入不一致。");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        user ? `/users/${user.id}` : "/users",
        { ...form, ...(!user ? { password } : {}) },
        user ? "PUT" : "POST",
      );
      toast.success(user ? "用户信息已保存。" : "用户已创建。");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{user ? "编辑用户" : "新增用户"}</DialogTitle>
            <DialogDescription>
              {user
                ? "调整姓名、账号和权限。变更账号、角色或状态后，该用户需重新登录。"
                : "设置账号与初始密码，并将登录信息告知用户。"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="user-username">账号</FieldLabel>
                  <Input
                    id="user-username"
                    value={form.username}
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                    autoComplete="off"
                    required
                    maxLength={32}
                    pattern="[a-zA-Z0-9_.\-]{3,32}"
                    disabled={self}
                  />
                  <FieldDescription>
                    {self
                      ? "当前登录账号不可在此更名。"
                      : "3–32 位字母、数字、下划线、点或连字符，不区分大小写。"}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="user-name">姓名</FieldLabel>
                  <Input
                    id="user-name"
                    value={form.displayName}
                    onChange={(e) =>
                      setForm({ ...form, displayName: e.target.value })
                    }
                    required
                    maxLength={50}
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="user-role">角色</FieldLabel>
                  <Select
                    value={form.role}
                    disabled={self}
                    onValueChange={(role) =>
                      setForm({ ...form, role: role as UserRole })
                    }
                  >
                    <SelectTrigger id="user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {roles.find((role) => role.id === form.role)?.description ||
                      "选择角色后，用户将获得该角色对应的功能权限。"}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="user-status">状态</FieldLabel>
                  <Select
                    value={String(form.enabled)}
                    disabled={self}
                    onValueChange={(value) =>
                      setForm({ ...form, enabled: value === "true" })
                    }
                  >
                    <SelectTrigger id="user-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="true">已启用</SelectItem>
                        <SelectItem value="false">已停用</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {!form.enabled && (
                    <FieldDescription>
                      停用后无法登录，已有会话会立即失效。
                    </FieldDescription>
                  )}
                </Field>
                {!user && (
                  <>
                    <PasswordField
                      id="user-password"
                      label="初始密码"
                      value={password}
                      onChange={setPassword}
                      help
                    />
                    <PasswordField
                      id="user-confirm"
                      label="确认密码"
                      value={confirm}
                      onChange={setConfirm}
                    />
                  </>
                )}
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>保存未完成</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <DialogFooter>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={requestClose}
                  >
                    取消
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy && <LoaderCircle className="animate-spin" />}
                    {user ? "保存用户" : "创建用户"}
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  );
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const { requestClose, confirmation } = useUnsavedChanges(
    !!password || !!confirm,
    busy,
    onClose,
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
      await api(`/users/${user.id}/reset-password`, { password });
      toast.success("密码已重置，旧会话已失效。请将新密码告知用户。");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "密码重置失败。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              {user.displayName}（{user.username}
              ）的旧密码将立即失效，所有登录会话会退出。请设置新密码后告知用户。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <FieldGroup>
                <PasswordField
                  id="reset-password"
                  label="新密码"
                  value={password}
                  onChange={setPassword}
                  help
                />
                <PasswordField
                  id="reset-confirm"
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
                    disabled={busy}
                    onClick={requestClose}
                  >
                    取消
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy && <LoaderCircle className="animate-spin" />}
                    确认重置密码
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  );
}
