# TJtest
用于录制浏览器操作并记录接口及console日志智能分析项目问题

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
