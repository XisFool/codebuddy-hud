# 高级安装：镜像 · 本地 · Fork

> 常规安装见 [README](../README.md#安装)。本文只覆盖直连 GitHub 不可用、需要离线安装或自建发行源的场景。English: [install-advanced.md](install-advanced.md)。

## 1. 国内镜像加速

直连 GitHub 超时或不稳定时，把镜像域名设为 `CODEBUDDY_HUD_MIRROR`。安装脚本、`bootstrap.js` 与 `--update` 会用 `https://镜像域名/原始GitHub URL` 的形式，为它们请求的所有 GitHub URL 加前缀：`raw.githubusercontent.com`（runtime 文件）、`github.com/releases/latest`（release tag 查询）与 `api.github.com`（查询兜底）。

**Windows（PowerShell）**

```powershell
$env:CODEBUDDY_HUD_MIRROR='https://your-mirror'
irm "$env:CODEBUDDY_HUD_MIRROR/https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1" | iex
```

**macOS / Linux（Bash）**

```bash
export CODEBUDDY_HUD_MIRROR=https://your-mirror
curl -fsSL "$CODEBUDDY_HUD_MIRROR/https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh" | bash
```

要点：

- 命令里镜像前缀出现两次：第一次由你的 shell 直接请求（安装脚本本身还不存在，无法自动加前缀），此后的 runtime 下载与 release tag 查询由脚本自动加前缀。
- release tag 查询与 API 兜底在镜像未覆盖时自动回退直连；runtime 文件始终经镜像下载。
- 只代理 `raw.githubusercontent.com` 的镜像需配合 `CODEBUDDY_HUD_VERSION`（或 `CODEBUDDY_HUD_RAW_BASE`）固定下载源才能装完；否则 tag 解析仍需能访问 github.com / api.github.com。
- 本仓库不背书任何具体公共代理，请自行选择可信镜像。

## 2. Git Clone 本地安装（零网络风险）

```bash
git clone https://github.com/XisFool/codebuddy-hud.git   # 或经镜像：git clone https://your-mirror/https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud
node scripts/bootstrap.js
```

本地安装直接从仓库复制文件，全程无远程 HTTP 请求。该方式仅部署 runtime 并配置宿主，不修改系统 PATH；需要全局命令时，执行 `npm link`、使用绝对路径运行，或改用一键安装脚本。

## 3. Fork / 自建镜像

**macOS / Linux**

```bash
export CODEBUDDY_HUD_BOOTSTRAP_URL=https://your-mirror/scripts/bootstrap.js
export CODEBUDDY_HUD_RAW_BASE=https://your-mirror/codebuddy-hud/vX.Y.Z
curl -fsSL https://your-mirror/scripts/install.sh | bash
```

**Windows（PowerShell）**

```powershell
$env:CODEBUDDY_HUD_BOOTSTRAP_URL = 'https://your-mirror/scripts/bootstrap.js'
$env:CODEBUDDY_HUD_RAW_BASE = 'https://your-mirror/codebuddy-hud/vX.Y.Z'
irm https://your-mirror/scripts/install.ps1 | iex
```

- `CODEBUDDY_HUD_BOOTSTRAP_URL`：供安装脚本下载 `bootstrap.js`，必须指向镜像上的 `scripts/bootstrap.js` 本体，不是镜像根目录。
- `CODEBUDDY_HUD_RAW_BASE`：供 `bootstrap.js` 拉取 runtime 文件。**一旦设置会跳过 GitHub Latest Release 查询**，示例锁定 tag 路径（`vX.Y.Z`），确保 runtime 安装到不可变 release；安装脚本自身仍从 master 拉取 `bootstrap.js`。
- `GITHUB_TOKEN` / `GH_TOKEN`：可选，仅随直连 `api.github.com` 的请求携带认证（不随镜像转发），rate limit 从 60/h 提升至 5000/h。
- Bash 下环境变量必须 `export`（作用于 `bash` 进程），不能只前缀给 `curl`。

全部环境变量一览见 [README「环境变量」](../README.md#环境变量)。
