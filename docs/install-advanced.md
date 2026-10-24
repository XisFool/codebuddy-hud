# Advanced install: mirror · local · fork

> For the standard install see the [README](../README_en.md#install). This page only covers setups where direct GitHub access is unavailable, offline installs, and self-hosted release sources. 中文：[install-advanced_zh.md](install-advanced_zh.md).

## 1. China mirror accelerated install

If direct GitHub connections are slow or unreliable, point `CODEBUDDY_HUD_MIRROR` at a mirror domain. Install scripts, `bootstrap.js` and `--update` prefix every GitHub URL they request as `https://mirror-domain/original-GitHub-URL`: `raw.githubusercontent.com` (runtime files), `github.com/releases/latest` (release-tag lookup) and `api.github.com` (lookup fallback).

**Windows (PowerShell)**

```powershell
$env:CODEBUDDY_HUD_MIRROR='https://your-mirror'
irm "$env:CODEBUDDY_HUD_MIRROR/https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1" | iex
```

**macOS / Linux (Bash)**

```bash
export CODEBUDDY_HUD_MIRROR=https://your-mirror
curl -fsSL "$CODEBUDDY_HUD_MIRROR/https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh" | bash
```

Notes:

- The mirror prefix appears twice: the first one is requested by your own shell (the install script does not exist yet, so nothing can prefix it for you); everything after that — runtime downloads and the release-tag lookup — is prefixed by the script itself.
- Release-tag lookup and API fallback fall back to direct requests if unmirrored; runtime files are always downloaded via the mirror.
- A mirror that only proxies `raw.githubusercontent.com` must also pin the download source via `CODEBUDDY_HUD_VERSION` (or `CODEBUDDY_HUD_RAW_BASE`) to complete; otherwise tag resolution still needs github.com / api.github.com.
- This repository does not endorse any particular public proxy; pick one you trust.

## 2. Git clone local install (zero network risk)

```bash
git clone https://github.com/XisFool/codebuddy-hud.git   # or via a mirror: git clone https://your-mirror/https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud
node scripts/bootstrap.js
```

Local install copies files directly from the repository, with zero remote HTTP requests. It only deploys the runtime and configures the host; it does not modify the system PATH. For global CLI access, run `npm link`, invoke via the absolute path, or use the one-command installer.

## 3. Fork / self-hosted mirror

**macOS / Linux**

```bash
export CODEBUDDY_HUD_BOOTSTRAP_URL=https://your-mirror/scripts/bootstrap.js
export CODEBUDDY_HUD_RAW_BASE=https://your-mirror/codebuddy-hud/vX.Y.Z
curl -fsSL https://your-mirror/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
$env:CODEBUDDY_HUD_BOOTSTRAP_URL = 'https://your-mirror/scripts/bootstrap.js'
$env:CODEBUDDY_HUD_RAW_BASE = 'https://your-mirror/codebuddy-hud/vX.Y.Z'
irm https://your-mirror/scripts/install.ps1 | iex
```

- `CODEBUDDY_HUD_BOOTSTRAP_URL`: used by the install script to download `bootstrap.js`; must point directly to `scripts/bootstrap.js` on your mirror, not the mirror root.
- `CODEBUDDY_HUD_RAW_BASE`: used by `bootstrap.js` to fetch runtime files. **Setting this skips the GitHub Latest Release lookup**, so the example pins a tag path (`vX.Y.Z`) to keep the runtime on an immutable release; the installer script itself still fetches `bootstrap.js` from master.
- `GITHUB_TOKEN` / `GH_TOKEN`: optional; passes authentication only to direct `api.github.com` requests (never forwarded to mirrors), raising the rate limit from 60/h to 5000/h.
- Under Bash, environment variables must be exported (so child `bash` processes inherit them), not just prepended to `curl`.

All environment variables are listed in the [README "Environment variables"](../README_en.md#environment-variables).
