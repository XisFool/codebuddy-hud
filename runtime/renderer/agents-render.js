'use strict';

const { color, dim } = require('./format');
const { sanitizeTerminalText } = require('../sanitize');

function renderToolActivity(activity, glyphs) {
  if (!activity) return '';

  // Aggregated turn activity: { active, completed, totalCompleted }
  if (activity.active || (Array.isArray(activity.completed) && activity.completed.length > 0)) {
    const parts = [];
    if (activity.active && activity.active.tool) {
      const toolStr = sanitizeTerminalText(String(activity.active.tool), 24);
      const detailStr = activity.active.detail ? dim(`: ${sanitizeTerminalText(String(activity.active.detail), 40)}`) : '';
      parts.push(`${glyphs.activeIcon}${color(toolStr, 'cyan')}${detailStr}`);
    }
    if (Array.isArray(activity.completed) && activity.completed.length > 0) {
      const top = activity.completed.slice(0, 3);
      for (const item of top) {
        if (!item || !item.tool) continue;
        const toolStr = sanitizeTerminalText(String(item.tool), 24);
        const countStr = item.count > 1 ? dim(` ×${item.count}`) : '';
        parts.push(`${color(glyphs.doneIcon.trim(), 'green')} ${dim(toolStr)}${countStr}`);
      }
    }
    return parts.join('  ');
  }

  // Legacy single activity: { status, tool, detail }
  if (!activity.tool) return '';
  const toolStr = sanitizeTerminalText(String(activity.tool), 24);
  if (activity.status === 'active') {
    const detailStr = activity.detail ? dim(`: ${sanitizeTerminalText(String(activity.detail), 40)}`) : '';
    return `${glyphs.activeIcon}${color(toolStr, 'cyan')}${detailStr}`;
  }
  return `${color(glyphs.doneIcon.trim(), 'green')} ${dim(toolStr)}`;
}

module.exports = { renderToolActivity };

