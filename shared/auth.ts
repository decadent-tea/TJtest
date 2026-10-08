export type UserRole = string;
export const permissionCatalog = [
  {
    id: "workspace.use",
    name: "业务工作空间",
    description: "使用体检、流程、记录、报告和模型配置。",
  },
  {
    id: "users.manage",
    name: "用户管理",
    description: "维护用户账号、分配角色及重置密码。",
  },
  {
    id: "roles.manage",
    name: "角色管理",
    description: "维护角色及其权限范围。",
  },
] as const;
export type Permission = (typeof permissionCatalog)[number]["id"];
export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
  userCount: number;
}
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  roleName?: string;
  permissions?: Permission[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}
export interface AuthState {
  setupRequired: boolean;
  user: User | null;
}
export const usernamePattern = /^[a-zA-Z0-9_.-]{3,32}$/;
export const passwordPattern = /^(?=.*[a-zA-Z])(?=.*\d)[\s\S]{8,128}$/;
export const passwordHelp = "8–128 位，至少包含英文字母和数字。";
export function hasPermission(user: User, permission: Permission) {
  return (
    user.permissions?.includes(permission) ??
    (user.role === "admin" ||
      (user.role === "user" && permission === "workspace.use"))
  );
}
export function roleLabel(user: User) {
  return (
    user.roleName ||
    (user.role === "admin"
      ? "管理员"
      : user.role === "user"
        ? "普通用户"
        : "自定义角色")
  );
}
