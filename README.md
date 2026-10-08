# TJtest
用于录制浏览器操作并记录接口及console日志智能分析项目问题

<section style="font-family: SimSun, '宋体', serif; color: #000;">
<h2>账号与用户管理</h2>
<p>首次打开系统时，页面会引导创建管理员账号，没有预置账号或默认密码。账号为 3–32 位字母、数字、下划线、点或连字符，密码为 8–128 位且须包含英文字母和数字。后续使用账号、密码与图片验证码登录，验证码不区分大小写，5 分钟有效且只能使用一次。</p>
<p>管理员可在“用户管理”中新增、搜索、查看、编辑、停用、启用、删除用户及重置密码。普通用户可使用现有体检、流程和报告功能。右上角“账户与安全”提供本人修改密码及退出登录入口。账号数据保存在现有 SQLite 数据库中。</p>
<p>“系统管理”为一级菜单，下设“用户管理”“角色管理”“模型与设置”三个二级入口，按当前角色权限显示。角色管理支持新增、查询、详情、编辑和删除；用户管理可分配自定义角色。内置管理员和普通用户角色会自动建立，兼容已有账号归属。</p>
<p>角色权限分为业务工作空间、用户管理、角色管理。内置角色的基础权限不可修改、不可删除；已关联用户的角色不可删除，需先调整用户归属。权限变更会撤销关联用户的已有会话。不能分配超出自身权限的角色，也不能通过角色编辑更改自己的权限。角色专项回归命令为 <code>npm run verify:roles</code>，使用独立测试数据。</p>
<p>登录会话有效期为 8 小时。账号、角色或启用状态变更，以及密码重置或本人修改密码，都会使该用户的旧会话失效。删除账号不会删除体检记录或流程。当前账号不可删除、停用或自行移除管理员权限；系统至少保留一位启用的管理员。</p>
<p>回归验证命令：<code>npm run verify:auth</code>。该脚本使用独立测试库，不修改实际工作空间的账号和记录。真实流程验证脚本需要通过 <code>STUDIO_SESSION_COOKIE</code> 提供有效会话 Cookie，并继续通过标准输入提供流程运行变量。</p>
</section>

## 后台启动

使用 PowerShell 7 在项目根目录执行：

```powershell
pwsh -File .\scripts\start-local.ps1
```

默认以开发模式后台启动，启动命令返回后即可关闭终端，页面地址为 `http://127.0.0.1:5173/`：

```powershell
pwsh -File .\scripts\start-local.ps1
```

需要生产式启动时显式指定 `-Production`，页面地址为 `http://127.0.0.1:4318/`：

```powershell
pwsh -File .\scripts\start-local.ps1 -Production
```

后台进程的日志和 PID 文件位于 `.runtime`。管理命令如下：

```powershell
pwsh -File .\scripts\status-local.ps1
pwsh -File .\scripts\stop-local.ps1
pwsh -File .\scripts\restart-local.ps1
```
