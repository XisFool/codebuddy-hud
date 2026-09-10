'use strict';

const path = require('path');
const { color, bold, dim, formatTokens, createProgressBar, getThemeColor, RESET, formatTurnCacheBadge, metricsFromPromptCache } = require('./renderer/format');
const { renderDiffSegment } = require('./renderer/diff-render');
const { renderToolActivity } = require('./renderer/agents-render');
const { sanitizeTerminalText } = require('./sanitize');
const { selectGlyphs, supportsUnicode } = require('./encoding');
const { extractTokenData, extractDiffStats, extractCostData } = require('./parser');
const { getGitStatus } = require('./git');
const { resolveEffortLevel, resolveCreditSpend } = require('./model-info');
const { getRecentToolActivity, getTurnToolActivity, getTurnUsageMetrics, getSessionUsageMetrics, getTurnMetricsAndActivity } = require('./transcript');
const { getLogicalSessionCostData } = require('./session-stats');
const { readUpdateStatus } = require('./update-checker');

function renderHUD(cbData, config) {
  if (!cbData || !config) return '';

  // Normalize partial/hand-built configs: config.display and config.theme may be
  // absent (the bin always supplies them via loadConfig, but renderHUD is the
  // exported public surface and is also documented as accepting an optional
  // ResolvedConfig). Defaulting to {} lets the renderer degrade instead of
  // throwing "Cannot read properties of undefined (reading 'unicode')".
  const disp = config.display || {};
  const theme = config.theme || {};

  const rawCwd = (cbData && (cbData.cwd || (cbData.workspace && cbData.workspace.current_dir))) || process.cwd();
  const isSafeCwd = typeof rawCwd === 'string' && !rawCwd.includes('\0') && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawCwd);
  const cwd = isSafeCwd ? path.resolve(rawCwd) : process.cwd();
  const useUnicode = disp.unicode === 'auto' ? supportsUnicode() : disp.unicode !== false;
  const glyphs = selectGlyphs(disp.useNerdFonts, useUnicode);
  const divider = `  \x1b[90m${glyphs.vbar}\x1b[0m  `;
  const lines = [];
  const tokenData = extractTokenData(cbData);

  const themePrimary = theme.primary || 'cyan';
  const themeAccent = theme.accent || themePrimary;
  const themeModel = theme.model || themePrimary;
  const themeBranch = theme.gitBranch || themePrimary;

  // The tail scan supplies the current-turn cache badge and recent tool activity.
  const needsTurnUsage = Boolean(cbData.transcript_path) && (
    (tokenData && disp.showCacheHitRate !== false)
    || disp.showCost !== false
  );
  const needsToolActivity = Boolean(cbData.transcript_path) && disp.showToolActivity !== false;

  let turnUsage = null;
  let turnActivity = null;
  if (needsTurnUsage || needsToolActivity) {
    const combined = getTurnMetricsAndActivity(cbData.transcript_path, {
      cwd,
      tailBytes: disp.toolActivityTailBytes,
    });
    turnUsage = combined.turnUsage;
    turnActivity = combined.toolActivity;
  }

  const sessionUsage = (cbData.transcript_path && disp.showCost !== false)
    ? getSessionUsageMetrics(cbData.transcript_path, {
      cwd,
    }) : null;

  // Line 1: Identity & Environment (Clean English layout)
  const line1Parts = [];
  const rawModelName = (cbData.model && (cbData.model.display_name || cbData.model.id)) || 'unknown';
  const modelName = sanitizeTerminalText(rawModelName, 30);
  const effortLevel = resolveEffortLevel(cbData, config);
  // Belt-and-braces on top of the whitelist in resolveEffortLevel: hard
  // constraint 5 says every external string is sanitized before it reaches
  // stdout, and the effort label is the last unsanitized payload-derived value.
  const effortLabel = sanitizeTerminalText(effortLevel || '--', 12);
  const effortIcon = (effortLevel && glyphs.effortIcons && glyphs.effortIcons[effortLevel])
    ? glyphs.effortIcons[effortLevel]
    : (glyphs.effortIcons && glyphs.effortIcons.medium) || '';
  const effortColorMap = {
    low: 'gray',
    medium: 'blue',
    high: 'yellow',
    xhigh: 'magenta',
    max: 'red',
    ultracode: 'gold',
  };
  const effortColor = effortColorMap[effortLevel] || 'gray';

  let modelSegment = bold(color(modelName, themeModel));
  modelSegment += ` ${color(`${effortIcon}${effortLabel}`, effortColor)}`;
  line1Parts.push(modelSegment);

  if (disp.showGitBranch !== false) {
    const gitStatus = getGitStatus(cwd);
    if (gitStatus && gitStatus.branch) {
      const cleanBranch = sanitizeTerminalText(gitStatus.branch, 30);
      const dirtyMark = gitStatus.dirty ? color('*', 'yellow') : '';
      line1Parts.push(`${color(cleanBranch, themeBranch)}${dirtyMark}`);
    }
  }

  if (disp.showCurrentDir !== false) {
    const dirName = sanitizeTerminalText(path.basename(cwd), 20);
    line1Parts.push(color(dirName, themeAccent));
  }

  if (disp.showPermissionMode !== false && cbData.permission_mode) {
    // 22 chars fits `bypassPermissions` (17) plus headroom for future modes
    // without re-introducing the truncation that produced `bypassPermissio`.
    // Bright magenta instead of dimmed magenta: dim purple is near-illegible
    // on dark backgrounds (user-reported).
    line1Parts.push(color(sanitizeTerminalText(cbData.permission_mode, 22), 'brightMagenta'));
  }

  if (disp.showVersion === true && cbData.version) {
    line1Parts.push(dim('v' + sanitizeTerminalText(cbData.version, 10)));
  }

  const updateStatus = readUpdateStatus();
  if (updateStatus && updateStatus.updateAvailable && updateStatus.latestVersion) {
    line1Parts.push(color(`[↑ v${sanitizeTerminalText(updateStatus.latestVersion, 10)}]`, 'yellow'));
  }

  lines.push(line1Parts.join(divider));

  // Line 2: Context Window & Tokens (Hollow Progress Bar + Dimmed Breakdown)
  if (tokenData && disp.showTokenBar !== false) {
    const line2Parts = [];
    const totalTokens = tokenData.inTokens + tokenData.outTokens;
    const dot = color(` ${glyphs.dot} `, 'gray');

    const tokenDetail = [
      `${color('in: ', 'gray')}${color(formatTokens(tokenData.inTokens), themeAccent)}`,
      `${color('out: ', 'gray')}${color(formatTokens(tokenData.outTokens), themeAccent)}`,
    ];

    const tokenStr = `${bold(color('Token ', themePrimary))}${bold(color(formatTokens(totalTokens), themePrimary))} ${color('(', 'gray')}${tokenDetail.join(dot)}${color(')', 'gray')}`;
    line2Parts.push(tokenStr);

    const barWidth = disp.progressBarWidth || 10;
    const bar = createProgressBar(tokenData.ctxPercent, barWidth, config.thresholds, glyphs);
    // Numerator must match the denominator semantics used by used_percentage
    // (current_usage based). Previously we used totalInput (session-cumulative)
    // while the bar/percent used current_usage, producing wildly inconsistent
    // displays like `1.1M/1M [█░░░░░░░░░]6%`.
    const ctxLabel = `${color(formatTokens(tokenData.inTokens), themeAccent)}${color('/', 'gray')}${color(formatTokens(tokenData.ctxSize), themePrimary)}`;

    const clampedPct = Number.isFinite(tokenData.ctxPercent) ? Math.max(0, Math.min(100, tokenData.ctxPercent)) : 0;
    let pctColor = 'green';
    const warnPct = ((config.thresholds && config.thresholds.warning) || 0.7) * 100;
    const critPct = ((config.thresholds && config.thresholds.critical) || 0.9) * 100;
    if (clampedPct >= critPct) pctColor = 'red';
    else if (clampedPct >= warnPct) pctColor = 'yellow';

    const ctxPercentStr = color(`${Math.round(clampedPct)}%`, pctColor);
    line2Parts.push(`${ctxLabel} ${color('[', 'gray')}${bar}${color(']', 'gray')} ${ctxPercentStr}`);

    if (disp.showCacheHitRate !== false) {
      // Real cache telemetry lives in the transcript's providerData, NOT in the
      // statusLine payload (whose cache_read_input_tokens is hard-zero on this
      // provider). A conversation turn spans many API calls (avg 19.3), so the
      // badge aggregates the whole current turn — sampling only the newest call
      // swings between ~0% (cold start) and ~99%.
      // No payload fallback: cache_read_input_tokens is hard-zero on this
      // provider, so re-reading it would fake a `cache 0.0%` readout. With no
      // usable transcript telemetry the badge degrades to `cache --`.
      let cacheMetrics = turnUsage
        ? metricsFromPromptCache(turnUsage.hitTokens, turnUsage.promptTokens)
        : null;
      if (cacheMetrics === null) {
        cacheMetrics = { available: false };
      }
      const cacheThresholds = config.cacheHitThresholds || {};
      const cacheBadge = formatTurnCacheBadge(cacheMetrics, 'cache', false, cacheThresholds);
      line2Parts.push(cacheBadge);
    }

    lines.push(line2Parts.join(divider));
  }

  // Line 3: Diff Stats, Credits & Duration
  const rawDiffStats = extractDiffStats(cbData);
  const rawCostData = extractCostData(cbData);
  const sessionCostData = getLogicalSessionCostData(cbData, {
    ...rawDiffStats,
    ...(rawCostData || {}),
  }, { cwd });
  const diffStats = sessionCostData;
  const costData = rawCostData ? {
    ...rawCostData,
    totalDurationMs: sessionCostData.totalDurationMs,
    apiDurationMs: sessionCostData.apiDurationMs,
  } : null;
  // A resumable transcript scan may have only a prefix of the session. Hide
  // credits for that frame rather than replacing the partial value with an
  // unrelated payload total.
  const sessionUsageIncomplete = sessionUsage && sessionUsage.complete === false;
  const transcriptCredits = !sessionUsageIncomplete && sessionUsage && Number.isFinite(sessionUsage.credits)
    ? sessionUsage.credits
    : null;
  const creditSpend = sessionUsageIncomplete
    ? null
    : (transcriptCredits === null ? resolveCreditSpend(cbData) : transcriptCredits);

  let toolSegment = '';
  if (disp.showToolActivity !== false) {
    const tailBytes = disp.toolActivityTailBytes;
    const activity = turnActivity
      || getRecentToolActivity(cbData.transcript_path, { cwd, tailBytes });
    toolSegment = renderToolActivity(activity, glyphs);
  }

  const line3 = renderDiffSegment(diffStats, costData, config, glyphs, creditSpend, toolSegment);
  if (line3) lines.push(line3);

  const maxLines = disp.maxLines || 3;
  return lines.slice(0, maxLines).join('\n');
}

module.exports = { renderHUD };
