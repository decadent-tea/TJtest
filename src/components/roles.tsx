import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  ArrowUpRight,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageTitle, Blank } from "./studio";
import { Pagination, currentPage } from "./pagination";
import { useUnsavedChanges } from "./unsaved-changes";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "./ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";
import {
  hasPermission,
  permissionCatalog,
  type Permission,
  type Role,
  type User,
} from "../../shared/auth";

const dateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export function RoleManagement({
  currentUser,
  onSessionRefresh,
  onUsers,
}: {
  currentUser: User;
  onSessionRefresh: () => Promise<void>;
  onUsers: (roleId: string) => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [editor, setEditor] = useState<Role | "new">();
  const [view, setView] = useState<Role>();
  const [deleting, setDeleting] = useState<Role>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const pending = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRoles(await api<Role[]>("/roles"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "角色读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const canEdit = (role: Role) =>
    role.permissions.every((permission) =>
      hasPermission(currentUser, permission),
    );
  const filtered = roles.filter((role) =>
    `${role.name} ${role.code} ${role.description}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const shownPage = currentPage(page, filtered.length, size);
  const remove = async () => {
    if (!deleting || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError("");
    try {
      await api(`/roles/${deleting.id}`, undefined, "DELETE");
      toast.success("角色已删除。");
      setDeleting(undefined);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "删除失败，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="ACCESS / ROLES"
        title="角色管理"
        description="按职责定义功能权限，再将角色分配给团队用户。"
        actions={
          <Button variant="launch" onClick={() => setEditor("new")}>
            <Plus data-icon="inline-start" />
            新增角色
          </Button>
        }
      />
      <div className="role-access-note">
        <ShieldCheck />
        <div>
          <strong>先定义职责，再分配权限</strong>
          <p>
            内置角色保留基础权限；自定义角色可组合业务工作空间、用户管理和角色管理权限。
          </p>
        </div>
        <Badge variant="outline">{roles.length} 个角色</Badge>
      </div>
      <Card className="role-list-card">
        <CardHeader>
          <CardTitle>角色与权限</CardTitle>
          <CardDescription>
            权限由后端校验。权限变更后，关联用户需要重新登录。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="user-toolbar">
            <div className="search-wrap">
              <Search />
              <Input
                aria-label="搜索角色"
                placeholder="搜索角色名称、标识或说明"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
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
              <AlertTitle>角色列表读取失败</AlertTitle>
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
              正在读取角色…
            </div>
          ) : filtered.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>角色</TableHead>
                    <TableHead>功能权限</TableHead>
                    <TableHead>关联用户</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered
                    .slice(shownPage * size, (shownPage + 1) * size)
                    .map((role) => (
                      <TableRow key={role.id}>
                        <TableCell>
                          <div className="role-identity">
                            <span className="user-avatar">
                              <ShieldCheck />
                            </span>
                            <div>
                              <Button
                                variant="link"
                                aria-label={`查看角色 ${role.name}`}
                                onClick={() => setView(role)}
                              >
                                {role.name}
                              </Button>
                              <small>{role.code}</small>
                            </div>
                            {role.builtIn && (
                              <Badge variant="outline">内置</Badge>
                            )}
                          </div>
                          {role.description && (
                            <p className="role-description">
                              {role.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="role-permission-tags">
                            {permissionCatalog
                              .filter((permission) =>
                                role.permissions.includes(permission.id),
                              )
                              .map((permission) => (
                                <Badge key={permission.id} variant="secondary">
                                  {permission.name}
                                </Badge>
                              ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`查看 ${role.name} 的关联用户`}
                            onClick={() => setView(role)}
                          >
                            <Users data-icon="inline-start" />
                            {role.userCount} 人
                          </Button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {dateTime(role.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="user-row-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit(role)}
                              onClick={() => setEditor(role)}
                            >
                              <Pencil data-icon="inline-start" />
                              编辑
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={
                                role.builtIn ||
                                role.userCount > 0 ||
                                !canEdit(role)
                              }
                              title={
                                role.builtIn
                                  ? "内置角色不可删除"
                                  : role.userCount
                                    ? "请先为关联用户分配其他角色"
                                    : undefined
                              }
                              onClick={() => {
                                setActionError("");
                                setDeleting(role);
                              }}
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
              title="没有匹配的角色"
              description="调整搜索条件，或为新的团队职责创建角色。"
              action={
                <Button variant="outline" onClick={() => setSearch("")}>
                  清除搜索
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
      {editor && (
        <RoleEditor
          key={editor === "new" ? "new" : editor.id}
          role={editor === "new" ? undefined : editor}
          currentUser={currentUser}
          onClose={() => setEditor(undefined)}
          onSaved={async () => {
            setEditor(undefined);
            await load();
            await onSessionRefresh();
          }}
        />
      )}
      {view && (
        <RoleDetail
          role={view}
          currentUser={currentUser}
          onClose={() => setView(undefined)}
          onEdit={
            canEdit(view)
              ? () => {
                  setEditor(view);
                  setView(undefined);
                }
              : undefined
          }
          onUsers={onUsers}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除角色？</DialogTitle>
            <DialogDescription>
              {deleting?.name}（{deleting?.code}
              ）将从可分配角色中移除。此操作无法撤销。
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
              onClick={() => setDeleting(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy && <LoaderCircle className="animate-spin" />}确认删除角色
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoleEditor({
  role,
  currentUser,
  onClose,
  onSaved,
}: {
  role?: Role;
  currentUser: User;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initial = {
    code: role?.code || "",
    name: role?.name || "",
    description: role?.description || "",
    permissions:
      role?.permissions ||
      ([
        hasPermission(currentUser, "workspace.use")
          ? "workspace.use"
          : "roles.manage",
      ] as Permission[]),
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const locked = !!role?.builtIn || role?.id === currentUser.role;
  const changedPermissions =
    [...form.permissions].sort().join() !==
    [...initial.permissions].sort().join();
  const { requestClose, confirmation } = useUnsavedChanges(
    JSON.stringify(form) !== JSON.stringify(initial),
    busy,
    onClose,
  );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    if (!form.permissions.length) {
      setError("至少选择一项权限。");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        role ? `/roles/${role.id}` : "/roles",
        form,
        role ? "PUT" : "POST",
      );
      toast.success(role ? "角色已保存。" : "角色已创建，可在用户管理中分配。");
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
        <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{role ? "编辑角色" : "新增角色"}</DialogTitle>
            <DialogDescription>
              {locked
                ? "可以编辑名称与说明。内置角色或本人角色的权限受保护。"
                : "选择该职责需要的功能权限。只能分配自己已拥有的权限。"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="role-name">角色名称</FieldLabel>
                  <Input
                    id="role-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    maxLength={50}
                    placeholder="例如：测试工程师"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="role-code">角色标识</FieldLabel>
                  <Input
                    id="role-code"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    required
                    maxLength={32}
                    pattern="[a-zA-Z0-9_.\-]{3,32}"
                    readOnly={!!role}
                    placeholder="例如：qa_engineer"
                  />
                  <FieldDescription>
                    {role
                      ? "唯一标识，创建后不可更改。"
                      : "3–32 位字母、数字、下划线、点或连字符。"}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="role-description">角色说明</FieldLabel>
                  <Textarea
                    id="role-description"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    maxLength={300}
                    placeholder="说明这个角色的工作职责（选填）"
                  />
                </Field>
                <FieldSet>
                  <FieldLegend>功能权限</FieldLegend>
                  <FieldDescription>
                    至少选择一项。用户获得所分配角色的全部权限。
                  </FieldDescription>
                  <FieldGroup className="role-permission-fields">
                    {permissionCatalog.map((permission) => (
                      <Field
                        key={permission.id}
                        orientation="horizontal"
                        className="role-permission-choice"
                      >
                        <Checkbox
                          id={`role-permission-${permission.id}`}
                          checked={form.permissions.includes(permission.id)}
                          disabled={
                            locked || !hasPermission(currentUser, permission.id)
                          }
                          onCheckedChange={(checked) =>
                            setForm({
                              ...form,
                              permissions: checked
                                ? [...form.permissions, permission.id]
                                : form.permissions.filter(
                                    (value) => value !== permission.id,
                                  ),
                            })
                          }
                        />
                        <div>
                          <FieldLabel
                            htmlFor={`role-permission-${permission.id}`}
                          >
                            {permission.name}
                          </FieldLabel>
                          <FieldDescription>
                            {permission.description}
                          </FieldDescription>
                        </div>
                      </Field>
                    ))}
                  </FieldGroup>
                </FieldSet>
                {changedPermissions && !!role?.userCount && (
                  <Alert>
                    <LockKeyhole />
                    <AlertTitle>影响 {role.userCount} 位关联用户</AlertTitle>
                    <AlertDescription>
                      保存权限变更后，这些用户的已有会话会退出，需要重新登录。
                    </AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>保存未完成</AlertTitle>
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
                    {role ? "保存角色" : "创建角色"}
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

type RoleWithMembers = Role & {
  members: Pick<User, "id" | "username" | "displayName" | "enabled">[];
};
function RoleDetail({
  role,
  currentUser,
  onClose,
  onEdit,
  onUsers,
}: {
  role: Role;
  currentUser: User;
  onClose: () => void;
  onEdit?: () => void;
  onUsers: (roleId: string) => void;
}) {
  const [detail, setDetail] = useState<RoleWithMembers>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setDetail(undefined);
    setError("");
    api<RoleWithMembers>(`/roles/${role.id}`)
      .then((value) => {
        if (!disposed) setDetail(value);
      })
      .catch((e) => {
        if (!disposed)
          setError(e instanceof Error ? e.message : "角色读取失败。");
      });
    return () => {
      disposed = true;
    };
  }, [role.id, retry]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>角色详情</DialogTitle>
          <DialogDescription>
            {role.name} · {role.code}
            {role.builtIn ? " · 内置角色" : ""}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                重新读取
              </Button>
            </AlertDescription>
          </Alert>
        ) : !detail ? (
          <div className="user-list-loading" role="status">
            <LoaderCircle className="animate-spin" />
            正在读取角色…
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {detail.description || "暂无角色说明。"}
            </p>
            <div className="role-permission-tags">
              {permissionCatalog
                .filter((permission) =>
                  detail.permissions.includes(permission.id),
                )
                .map((permission) => (
                  <Badge variant="secondary" key={permission.id}>
                    {permission.name}
                  </Badge>
                ))}
            </div>
            <div className="role-member-heading">
              <strong>关联用户 · {detail.members.length}</strong>
              {hasPermission(currentUser, "users.manage") && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onUsers(role.id);
                  }}
                >
                  管理关联用户
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              )}
            </div>
            {detail.members.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>账号</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.members.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.displayName}</TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>
                        {user.enabled ? "已启用" : "已停用"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                暂未分配给用户，可在用户管理中选择此角色。
              </p>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {onEdit && <Button onClick={onEdit}>编辑角色</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
