import express from "express";
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { get, list, put, remove } from "./store";
import {
  passwordHelp,
  passwordPattern,
  usernamePattern,
  type User,
  type Role,
  type Permission,
  permissionCatalog,
} from "../shared/auth";

interface StoredUser extends User {
  passwordHash: string;
  credentialVersion: number;
}
interface Session {
  id: string;
  userId: string;
  version: number;
  expiresAt: number;
}
class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const SESSION_COOKIE = "studio_session";
const CAPTCHA_COOKIE = "studio_captcha";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const derive = promisify(scrypt);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const users = () => list<StoredUser>("user");
type StoredRole = Omit<Role, "userCount">;
const roles = () => list<StoredRole>("role");
const assignedRole = (user: StoredUser) => get<StoredRole>("role", user.role);
const permissions = (user: StoredUser) => assignedRole(user)?.permissions || [];
function publicRole(role: StoredRole): Role {
  return {
    ...role,
    userCount: users().filter((user) => user.role === role.id).length,
  };
}
function seedRoles() {
  const now = new Date().toISOString();
  for (const role of [
    {
      id: "admin",
      code: "admin",
      name: "管理员",
      description: "维护系统、团队账号与全部业务功能。",
      permissions: permissionCatalog.map((item) => item.id),
    },
    {
      id: "user",
      code: "user",
      name: "普通用户",
      description: "使用体检、流程、记录、报告与模型配置。",
      permissions: ["workspace.use"] as Permission[],
    },
  ]) {
    if (!get("role", role.id))
      put("role", { ...role, builtIn: true, createdAt: now, updatedAt: now });
  }
}
function publicUser(user: StoredUser): User {
  const { passwordHash: _hash, credentialVersion: _version, ...value } = user;
  return {
    ...value,
    roleName: assignedRole(user)?.name || "角色不存在",
    permissions: permissions(user),
  };
}
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
async function matches(password: string, encoded: string) {
  const [salt, value] = encoded.split(":");
  const hash = (await derive(password, salt, 64)) as Buffer;
  const stored = Buffer.from(value, "hex");
  return hash.length === stored.length && timingSafeEqual(hash, stored);
}
function cookie(req: express.Request, name: string) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}
function cookieOptions(req: express.Request, path: string, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: req.secure,
    path,
    maxAge,
  };
}
function sessionUser(req: express.Request) {
  const token = cookie(req, SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const session = get<Session>("auth-session", digest(token));
  if (!session) return;
  const user = get<StoredUser>("user", session.userId);
  if (
    session.expiresAt <= Date.now() ||
    !user?.enabled ||
    !assignedRole(user) ||
    user.credentialVersion !== session.version
  ) {
    remove("auth-session", session.id);
    return;
  }
  return user;
}
function openSession(
  req: express.Request,
  res: express.Response,
  user: StoredUser,
) {
  for (const session of list<Session>("auth-session")) {
    if (session.expiresAt <= Date.now()) remove("auth-session", session.id);
  }
  const old = cookie(req, SESSION_COOKIE);
  if (old) remove("auth-session", digest(old));
  const token = randomBytes(32).toString("hex");
  put("auth-session", {
    id: digest(token),
    userId: user.id,
    version: user.credentialVersion,
    expiresAt: Date.now() + SESSION_TTL,
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(req, "/", SESSION_TTL));
}
function revoke(userId: string) {
  for (const session of list<Session>("auth-session")) {
    if (session.userId === userId) remove("auth-session", session.id);
  }
}
const username = z
  .string()
  .trim()
  .regex(usernamePattern, "账号须为 3–32 位字母、数字、下划线、点或连字符。")
  .transform((v) => v.toLowerCase());
const password = z.string().regex(passwordPattern, passwordHelp);
const profile = z.object({
  username,
  displayName: z.string().trim().min(1, "请输入姓名。").max(50),
  role: z.string().min(1).max(100),
  enabled: z.boolean(),
});
const challenges = new Map<string, { hash: string; expiresAt: number }>();
const limits = new Map<string, { count: number; expiresAt: number }>();
function limit(key: string, maximum: number) {
  for (const [id, item] of limits)
    if (item.expiresAt <= Date.now()) limits.delete(id);
  let item = limits.get(key);
  if (!item) {
    if (limits.size >= 5000)
      throw new AuthError(429, "请求过于频繁，请稍后再试。");
    item = { count: 0, expiresAt: Date.now() + 15 * 60 * 1000 };
    limits.set(key, item);
  }
  if (++item.count > maximum)
    throw new AuthError(429, "尝试次数过多，请在 15 分钟后重试。");
}
function verifyCaptcha(req: express.Request, res: express.Response) {
  const id = cookie(req, CAPTCHA_COOKIE);
  const item = challenges.get(id);
  challenges.delete(id);
  res.clearCookie(CAPTCHA_COOKIE, { path: "/api/auth" });
  const code =
    typeof req.body?.captcha === "string"
      ? req.body.captcha.trim().toUpperCase()
      : "";
  if (!item || item.expiresAt <= Date.now() || item.hash !== digest(code))
    throw new AuthError(400, "验证码错误或已过期，请输入新的验证码。");
}
function protect(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ error: "登录已失效，请重新登录。" });
    return;
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("x-studio-request") !== "1"
  ) {
    res.status(403).json({ error: "请求来源校验失败，请刷新页面后重试。" });
    return;
  }
  res.locals.user = user;
  next();
}
const wrap =
  (fn: (req: express.Request, res: express.Response) => unknown) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof AuthError)
        res.status(error.status).json({ error: error.message });
      else if (error instanceof z.ZodError)
        res
          .status(400)
          .json({ error: error.issues.map((i) => i.message).join("；") });
      else next(error);
    }
  };
function requirePermission(permission: Permission) {
  return (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (!permissions(res.locals.user).includes(permission)) {
      res.status(403).json({ error: "当前角色没有此功能的访问权限。" });
      return;
    }
    next();
  };
}
function roleTarget(id: string) {
  const role = get<StoredRole>("role", id);
  if (!role) throw new AuthError(404, "角色不存在或已被删除，请刷新后重试。");
  return role;
}
function mayDelegate(actor: StoredUser, desired: Permission[]) {
  if (!desired.every((permission) => permissions(actor).includes(permission)))
    throw new AuthError(403, "不能分配或修改超出自己权限范围的角色。");
}
function editableUser(actor: StoredUser, user: StoredUser) {
  mayDelegate(actor, permissions(user));
}
function requireCurrentPermission(
  req: express.Request,
  permission: Permission,
) {
  const actor = sessionUser(req);
  if (!actor) throw new AuthError(401, "登录已失效，请重新登录。");
  if (!permissions(actor).includes(permission))
    throw new AuthError(403, "当前角色没有此功能的访问权限。");
  return actor;
}
function roleUnique(input: { name: string; code: string }, id?: string) {
  if (
    roles().some(
      (role) =>
        role.id !== id &&
        (role.code === input.code ||
          role.name.toLowerCase() === input.name.toLowerCase()),
    )
  )
    throw new AuthError(409, "角色名称或标识已存在，请使用其他名称和标识。");
}
function target(id: string) {
  const user = get<StoredUser>("user", id);
  if (!user) throw new AuthError(404, "用户不存在或已被删除，请刷新列表。");
  return user;
}
function unique(name: string, id?: string) {
  if (users().some((u) => u.username === name && u.id !== id))
    throw new AuthError(409, "该账号已存在，请使用其他账号。");
}
function preserveAdmin(user: StoredUser) {
  if (
    user.enabled &&
    user.role === "admin" &&
    users().filter((u) => u.enabled && u.role === "admin").length <= 1
  )
    throw new AuthError(409, "系统至少需要一位启用的管理员。");
}

export function installAuth(app: express.Express) {
  seedRoles();
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/auth/session", (req, res) => {
    const user = sessionUser(req);
    res.json({
      setupRequired: users().length === 0,
      user: user ? publicUser(user) : null,
    });
  });
  app.get(
    "/api/auth/captcha",
    wrap((req, res) => {
      limit(`captcha:${req.ip}`, 120);
      for (const [id, item] of challenges)
        if (item.expiresAt <= Date.now()) challenges.delete(id);
      if (challenges.size >= 1000)
        throw new AuthError(429, "验证码请求过多，请稍后再试。");
      challenges.delete(cookie(req, CAPTCHA_COOKIE));
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      const code = Array.from(
        { length: 4 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
      const id = randomBytes(32).toString("hex");
      const expiresAt = Date.now() + 5 * 60 * 1000;
      challenges.set(id, { hash: digest(code), expiresAt });
      const noise = Array.from(
        { length: 8 },
        () =>
          `<path d="M${randomInt(160)} ${randomInt(50)} L${randomInt(160)} ${randomInt(50)}" stroke="#8ea9a0" stroke-width="1" opacity=".5"/>`,
      ).join("");
      const letters = [...code]
        .map(
          (c, i) =>
            `<text x="${20 + i * 35}" y="${34 + randomInt(-3, 4)}" transform="rotate(${randomInt(-18, 19)} ${20 + i * 35} 28)" fill="#236c61" font-family="monospace" font-size="28" font-weight="bold">${c}</text>`,
        )
        .join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50" viewBox="0 0 160 50"><rect width="160" height="50" rx="8" fill="#edf3ef"/>${noise}${letters}</svg>`;
      res.cookie(
        CAPTCHA_COOKIE,
        id,
        cookieOptions(req, "/api/auth", 5 * 60 * 1000),
      );
      res.json({
        image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        expiresAt,
      });
    }),
  );
  const authInput = z.object({
    username,
    password: z.string().min(1).max(128),
    captcha: z.string().min(1).max(10),
  });
  app.post(
    "/api/auth/setup",
    wrap(async (req, res) => {
      if (users().length)
        throw new AuthError(409, "管理员已创建，请直接登录。");
      limit(`setup:${req.ip}`, 10);
      verifyCaptcha(req, res);
      const input = authInput
        .extend({ password, displayName: z.string().trim().min(1).max(50) })
        .parse(req.body);
      const passwordHash = await hashPassword(input.password);
      // Recheck after password derivation so concurrent setup requests cannot create two initial administrators.
      if (users().length)
        throw new AuthError(409, "管理员已创建，请直接登录。");
      const now = new Date().toISOString();
      const user = put("user", {
        id: randomUUID(),
        username: input.username,
        displayName: input.displayName,
        role: "admin" as const,
        enabled: true,
        passwordHash,
        credentialVersion: 1,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
      openSession(req, res, user);
      res.status(201).json(publicUser(user));
    }),
  );
  app.post(
    "/api/auth/login",
    wrap(async (req, res) => {
      const key = `login:${req.ip}:${String(req.body?.username || "")
        .trim()
        .toLowerCase()
        .slice(0, 32)}`;
      limit(`login-ip:${req.ip}`, 100);
      limit(key, 10);
      verifyCaptcha(req, res);
      const input = authInput.parse(req.body);
      const user = users().find((u) => u.username === input.username);
      // Derive even for an unknown account to avoid a cheap account-enumeration timing signal.
      const valid = await matches(
        input.password,
        user?.passwordHash || `${"0".repeat(32)}:${"0".repeat(128)}`,
      );
      const current = user && get<StoredUser>("user", user.id);
      if (
        !valid ||
        !current?.enabled ||
        current.passwordHash !== user?.passwordHash
      )
        throw new AuthError(401, "账号或密码错误，或账号已停用。");
      current.lastLoginAt = new Date().toISOString();
      put("user", current);
      limits.delete(key);
      openSession(req, res, current);
      res.json(publicUser(current));
    }),
  );
  app.use("/api", protect);
  app.use("/artifacts", protect);
  app.post("/api/auth/logout", (req, res) => {
    remove("auth-session", digest(cookie(req, SESSION_COOKIE)));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });
  app.post(
    "/api/auth/password",
    wrap(async (req, res) => {
      const input = z
        .object({ currentPassword: z.string().min(1).max(128), password })
        .parse(req.body);
      const actor = res.locals.user as StoredUser;
      limit(`password:${actor.id}`, 10);
      if (!(await matches(input.currentPassword, actor.passwordHash)))
        throw new AuthError(400, "当前密码不正确。");
      const passwordHash = await hashPassword(input.password);
      const current = target(actor.id);
      if (
        !current.enabled ||
        current.credentialVersion !== actor.credentialVersion
      )
        throw new AuthError(401, "账号状态已变化，请重新登录。");
      put("user", {
        ...current,
        passwordHash,
        credentialVersion: current.credentialVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      revoke(current.id);
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      limits.delete(`password:${actor.id}`);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/roles/options",
    wrap((_req, res) => {
      const actor = res.locals.user as StoredUser;
      if (
        !permissions(actor).some(
          (permission) =>
            permission === "users.manage" || permission === "roles.manage",
        )
      )
        throw new AuthError(403, "当前角色没有此功能的访问权限。");
      res.json(
        roles()
          .filter((role) =>
            role.permissions.every((permission) =>
              permissions(actor).includes(permission),
            ),
          )
          .map(publicRole),
      );
    }),
  );
  app.use("/api/users", requirePermission("users.manage"));
  app.get("/api/users", (_req, res) => res.json(users().map(publicUser)));
  app.get(
    "/api/users/:id",
    wrap((req, res) => res.json(publicUser(target(req.params.id as string)))),
  );
  app.post(
    "/api/users",
    wrap(async (req, res) => {
      const input = profile.extend({ password }).parse(req.body);
      unique(input.username);
      const desiredRole = roleTarget(input.role);
      mayDelegate(res.locals.user, desiredRole.permissions);
      const passwordHash = await hashPassword(input.password);
      unique(input.username);
      // The actor may have been disabled while hashing.
      const actor = requireCurrentPermission(req, "users.manage");
      mayDelegate(actor, roleTarget(input.role).permissions);
      const now = new Date().toISOString();
      const user = put("user", {
        id: randomUUID(),
        username: input.username,
        displayName: input.displayName,
        role: input.role,
        enabled: input.enabled,
        passwordHash,
        credentialVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      res.status(201).json(publicUser(user));
    }),
  );
  app.put(
    "/api/users/:id",
    wrap((req, res) => {
      const input = profile.parse(req.body);
      const user = target(req.params.id as string);
      editableUser(res.locals.user, user);
      mayDelegate(res.locals.user, roleTarget(input.role).permissions);
      unique(input.username, user.id);
      if (
        user.id === res.locals.user.id &&
        (!input.enabled || input.role !== user.role)
      )
        throw new AuthError(409, "不能停用当前账号或更改自己的角色。");
      if (!input.enabled || input.role !== "admin") preserveAdmin(user);
      const securityChanged =
        input.enabled !== user.enabled ||
        input.role !== user.role ||
        input.username !== user.username;
      const updated = put("user", {
        ...user,
        ...input,
        updatedAt: new Date().toISOString(),
        credentialVersion: user.credentialVersion + Number(securityChanged),
      });
      if (securityChanged) revoke(user.id);
      res.json(publicUser(updated));
    }),
  );
  app.delete(
    "/api/users/:id",
    wrap((req, res) => {
      const user = target(req.params.id as string);
      editableUser(res.locals.user, user);
      if (user.id === res.locals.user.id)
        throw new AuthError(409, "不能删除当前登录账号。");
      preserveAdmin(user);
      revoke(user.id);
      remove("user", user.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/users/:id/reset-password",
    wrap(async (req, res) => {
      const input = z.object({ password }).parse(req.body);
      const id = req.params.id as string;
      target(id);
      const passwordHash = await hashPassword(input.password);
      const actor = requireCurrentPermission(req, "users.manage");
      const user = target(id);
      editableUser(actor, user);
      put("user", {
        ...user,
        passwordHash,
        credentialVersion: user.credentialVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      revoke(id);
      if (id === res.locals.user.id)
        res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.json({ ok: true });
    }),
  );
  const roleSchema = z.object({
    code: z
      .string()
      .trim()
      .regex(
        usernamePattern,
        "角色标识须为 3–32 位字母、数字、下划线、点或连字符。",
      )
      .transform((value) => value.toLowerCase()),
    name: z.string().trim().min(1, "请输入角色名称。").max(50),
    description: z.string().trim().max(300).default(""),
    permissions: z
      .array(z.enum(["workspace.use", "users.manage", "roles.manage"]))
      .min(1, "至少选择一项权限。")
      .transform((value) => [...new Set(value)]),
  });
  app.use("/api/roles", requirePermission("roles.manage"));
  app.get("/api/roles", (_req, res) => res.json(roles().map(publicRole)));
  app.get(
    "/api/roles/:id",
    wrap((req, res) => {
      const role = roleTarget(req.params.id as string);
      res.json({
        ...publicRole(role),
        members: users()
          .filter((user) => user.role === role.id)
          .map((user) => ({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            enabled: user.enabled,
          })),
      });
    }),
  );
  app.post(
    "/api/roles",
    wrap((req, res) => {
      const input = roleSchema.parse(req.body);
      roleUnique(input);
      mayDelegate(res.locals.user, input.permissions);
      const now = new Date().toISOString();
      const role = put("role", {
        ...input,
        id: randomUUID(),
        builtIn: false,
        createdAt: now,
        updatedAt: now,
      });
      res.status(201).json(publicRole(role));
    }),
  );
  app.put(
    "/api/roles/:id",
    wrap((req, res) => {
      const role = roleTarget(req.params.id as string);
      const input = roleSchema.parse(req.body);
      roleUnique(input, role.id);
      mayDelegate(res.locals.user, role.permissions);
      mayDelegate(res.locals.user, input.permissions);
      const changed =
        [...role.permissions].sort().join() !==
        [...input.permissions].sort().join();
      if (input.code !== role.code)
        throw new AuthError(409, "角色标识创建后不可更改。");
      if (role.builtIn && changed)
        throw new AuthError(
          409,
          "内置角色的基础权限不可更改，请创建自定义角色。",
        );
      if (changed && res.locals.user.role === role.id)
        throw new AuthError(
          409,
          "不能修改自己当前角色的权限，请由其他管理员操作。",
        );
      const updated = put("role", {
        ...role,
        ...input,
        updatedAt: new Date().toISOString(),
      });
      if (changed) {
        for (const user of users().filter((user) => user.role === role.id)) {
          put("user", {
            ...user,
            credentialVersion: user.credentialVersion + 1,
            updatedAt: updated.updatedAt,
          });
          revoke(user.id);
        }
      }
      res.json(publicRole(updated));
    }),
  );
  app.delete(
    "/api/roles/:id",
    wrap((req, res) => {
      const role = roleTarget(req.params.id as string);
      mayDelegate(res.locals.user, role.permissions);
      if (role.builtIn) throw new AuthError(409, "内置角色不可删除。");
      if (users().some((user) => user.role === role.id))
        throw new AuthError(
          409,
          "此角色仍有关联用户，请先为这些用户分配其他角色。",
        );
      remove("role", role.id);
      res.json({ ok: true });
    }),
  );
  app.use("/api", requirePermission("workspace.use"));
  app.use("/artifacts", requirePermission("workspace.use"));
}
