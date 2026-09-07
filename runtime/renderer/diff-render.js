'use strict';

const { color, dim, formatTokens, formatDurationMs, getThemeColor, RESET } = require('./format');

function formatCreditSpend(creditSpend) {
  if (!Number.isFinite(creditSpend) || creditSpend < 0) return '';
  return `${creditSpend.toFixed(2)} credits`;
}

function renderDiffSegment(diffStats, costData, config, glyphs, creditSpend, toolSegment) {
  const parts = [];
  const display = (config && config.display) || {};
  const actualCreditSpend = typeof creditSpend === 'number' ? creditSpend : null;

  const added = (diffStats && diffStats.linesAdded) || 0;
  const removed = (diffStats && diffStats.linesRemoved) || 0;
  const hasDiff = added > 0 || removed > 0;
  const totalCostUsd = (costData && costData.totalCostUsd) || 0;
  const totalMs = (costData && costData.totalDurationMs) || 0;
  const hasCost = Boolean(costData && (totalCostUsd > 0 || totalMs > 0));
  const hasCreditSpend = Number.isFinite(actualCreditSpend) && actualCreditSpend >= 0;
  const hasToolSegment = Boolean(toolSegment && typeof toolSegment === 'string' && toolSegment.trim().length > 0);

  // If there's no diff, cost/duration data, and no tool activity, omit Line 3 completely
  if (!hasDiff && !hasCost && !hasCreditSpend && !hasToolSegment) {
    return '';
  }

  // 1. Diff stats (+added -removed)
  if (display.showDiffStats !== false && hasDiff) {
    const addColor = getThemeColor(config, 'diffAdd', 'green');
    const remColor = getThemeColor(config, 'diffRemove', 'red');
    const addStr = added > 0 ? `${addColor}+${formatTokens(added)}${RESET}` : '';
    const remStr = removed > 0 ? `${remColor}-${formatTokens(removed)}${RESET}` : '';
    const diffStr = [addStr, remStr].filter(Boolean).join(' ');
    if (diffStr) parts.push(`${dim((glyphs && glyphs.diffIcon) || '')}${diffStr}`);
  }

  // 2. Cost / Credits
  if (display.showCost !== false) {
    if (hasCreditSpend) {
      parts.push(color(formatCreditSpend(actualCreditSpend), 'yellow'));
    } else if (totalCostUsd > 0) {
      parts.push(color(`$${totalCostUsd.toFixed(2)}`, 'yellow'));
    }
  }

  // 3. Duration
  if (display.showDuration !== false && totalMs > 0) {
    const timeStr = `${glyphs.clockIcon}${formatDurationMs(totalMs)}`;
    parts.push(color(timeStr, 'gray'));
  }

  // 4. Tool activity
  if (display.showToolActivity !== false && hasToolSegment) {
    parts.push(toolSegment.trim());
  }

  if (parts.length === 0) return '';
  return parts.join(`  \x1b[90m${glyphs.vbar}\x1b[0m  `);
}

module.exports = { renderDiffSegment, formatCreditSpend };
