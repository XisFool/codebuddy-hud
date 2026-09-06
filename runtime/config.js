'use strict';

const fs = require('fs');
const path = require('path');
const { getSettingsPath, getUserConfigPath } = require('./paths');

const THEME_PRESETS = {
  ocean: {
    name: 'ocean',
    label: '深海青蓝 (Ocean)',
    dark: {
      primary: 'cyan',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'cyan',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'cyan',
      gitBranch: 'cyan',
    },
    light: {
      primary: 'blue',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'blue',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'blue',
      gitBranch: 'blue',
    },
  },
  emerald: {
    name: 'emerald',
    label: '翡翠绿 (Emerald)',
    dark: {
      primary: 'green',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'cyan',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'green',
      gitBranch: 'green',
    },
    light: {
      primary: 'green',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'blue',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'green',
      gitBranch: 'green',
    },
  },
  cyberpunk: {
    name: 'cyberpunk',
    label: '赛博朋克 (Cyberpunk)',
    dark: {
      primary: 'magenta',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'cyan',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'magenta',
      gitBranch: 'cyan',
    },
    light: {
      primary: 'magenta',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'blue',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'magenta',
      gitBranch: 'blue',
    },
  },
  amber: {
    name: 'amber',
    label: '琥珀金 (Amber)',
    dark: {
      primary: 'yellow',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'yellow',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'yellow',
      gitBranch: 'yellow',
    },
    light: {
      primary: 'yellow',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'yellow',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'yellow',
      gitBranch: 'yellow',
    },
  },
  monochrome: {
    name: 'monochrome',
    label: '黑白极简 (Monochrome)',
    dark: {
      primary: 'gray',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'gray',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'gray',
      gitBranch: 'gray',
    },
    light: {
      primary: 'gray',
      secondary: 'gray',
      warning: 'yellow',
      critical: 'red',
      accent: 'gray',
      diffAdd: 'green',
      diffRemove: 'red',
      model: 'gray',
      gitBranch: 'gray',
    },
  },
};

const DEFAULT_CONFIG = {
  theme: 'ocean',
  themeMode: 'auto',
  display: {
    showTokenBar: true,
    showDiffStats: true,
    showAgentStatus: true,
    showCost: true,
    showDuration: true,
    showCurrentDir: true,
    showGitBranch: true,
    showVersion: false,
    showPermissionMode: true,
    useNerdFonts: false,
    unicode: 'auto',
    maxLines: 4,
    progressBarWidth: 10,
    showCacheHitRate: true,
    showToolActivity: true,
    toolActivityTailBytes: 16384,
  },
  thresholds: {
    warning: 0.7,
    critical: 0.9,
  },
  cacheHitThresholds: {
    excellent: 80,
    partial: 50,
  },
  defaultEffortLevel: 'medium',
  language: 'en',
};

// Deep-merge `source` over `target`. Nested objects from BOTH sides are always
// cloned: the old version aliased `target`'s nested objects when `source` did
// not mention them, so mutating the merged config silently mutated the
// module-level DEFAULT_CONFIG (proven leak: merged.thresholds === DEFAULT_CONFIG.thresholds).
//
// `__proto__` keys are skipped: a hostile project config like
// {"__proto__":{...}} must not swap the merged object's [[Prototype]].
// Beyond MAX_MERGE_DEPTH the source subtree is taken as-is, so a pathologically
// deep config cannot blow the stack (degrades to that subtree replacing, not
// merging, the default — caught by design).
const MAX_MERGE_DEPTH = 64;

function deepMerge(target, source, depth) {
  const level = depth || 0;
  if (level > MAX_MERGE_DEPTH) return source;
  const result = {};
  const keys = new Set(Object.keys(target).concat(Object.keys(source)));
  for (const key of keys) {
    if (key === '__proto__') continue;
    const t = target[key];
    const s = source[key];
    const tObj = t !== null && typeof t === 'object' && !Array.isArray(t);
    const sObj = s !== null && typeof s === 'object' && !Array.isArray(s);
    if (tObj && sObj) {
      result[key] = deepMerge(t, s, level + 1);
    } else if (s !== undefined) {
      result[key] = Array.isArray(s) ? s.slice() : (sObj ? deepMerge({}, s, level + 1) : s);
    } else if (Array.isArray(t)) {
      result[key] = t.slice();
    } else {
      result[key] = tObj ? deepMerge({}, t, level + 1) : t;
    }
  }
  return result;
}

function loadJsonFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  } catch {
    return null;
  }
}

function detectThemeMode(config) {
  if (config && (config.themeMode === 'dark' || config.themeMode === 'light')) {
    return config.themeMode;
  }
  const colorfgbg = process.env.COLORFGBG;
  if (typeof colorfgbg === 'string' && colorfgbg.trim()) {
    const parts = colorfgbg.trim().split(';');
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) {
      if (last === 7 || (last >= 9 && last <= 15)) {
        return 'light';
      }
      if ((last >= 0 && last <= 6) || last === 8) {
        return 'dark';
      }
    }
  }
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings && typeof settings.theme === 'string') {
        const lower = settings.theme.toLowerCase();
        if (lower.includes('light')) return 'light';
        if (lower.includes('dark')) return 'dark';
      }
    }
  } catch {
    // ignore
  }
  return 'dark';
}

function resolveTheme(config) {
  const mode = detectThemeMode(config);
  let themeVal = config && config.theme;
  let presetName = 'ocean';
  let overrides = {};

  if (typeof themeVal === 'string') {
    if (THEME_PRESETS[themeVal]) {
      presetName = themeVal;
    }
  } else if (themeVal && typeof themeVal === 'object') {
    if (typeof themeVal.name === 'string' && THEME_PRESETS[themeVal.name]) {
      presetName = themeVal.name;
    }
    overrides = themeVal;
  }

  const preset = THEME_PRESETS[presetName] || THEME_PRESETS.ocean;
  const palette = preset[mode] || preset.dark;

  return {
    ...palette,
    ...overrides,
    name: presetName,
    mode,
  };
}

function loadConfig(cwd) {
  // deepMerge({}, …) clones DEFAULT_CONFIG deeply so a partial override can
  // never alias module-level defaults back to the caller
  let config = deepMerge({}, DEFAULT_CONFIG);

  const shippedConfigPath = path.join(__dirname, 'codebuddy-hud.config.json');
  const shipped = loadJsonFile(shippedConfigPath);
  if (shipped) config = deepMerge(config, shipped);

  const userConfigPath = getUserConfigPath();
  const userConfig = loadJsonFile(userConfigPath);
  if (userConfig) config = deepMerge(config, userConfig);

  if (typeof cwd === 'string' && cwd) {
    const projectConfigPath = path.join(cwd, 'codebuddy-hud.config.json');
    const project = loadJsonFile(projectConfigPath);
    if (project) config = deepMerge(config, project);
  }

  config.theme = resolveTheme(config);

  return config;
}

module.exports = { loadConfig, deepMerge, DEFAULT_CONFIG, THEME_PRESETS, resolveTheme, detectThemeMode };

