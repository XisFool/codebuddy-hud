'use strict';

const DICTIONARY = {
  zh: {
    contextPending: '压缩后待更新',
    contextReported: '最近报告',
    // CLI & Theme
    themeSelectTitle: '请选择 HUD 主题 (Select HUD Theme):',
    themeSelectHint: '[↑/↓ 移动 | 1-5 选择 | Enter 确认 | Esc 取消]',
    themePreviewTitle: '实时效果预览',
    themeSetSuccess: 'HUD 主题已设置为',
    themeSavedTo: '已保存至',
    unknownTheme: '未知主题',
    availableThemes: '可用主题',
    usageTheme: '用法: codebuddy-hud --theme <名称> (例如 codebuddy-hud --theme cyberpunk)',

    // Footer Mode
    footerSelectTitle: '请选择 CodeBuddy 官方第 4 行底栏模式 (Host Footer Mode):',
    footerSelectHint: '[↑/↓ 移动 | 1-3 选择 | Enter 确认 | Esc 取消]',
    footerPreviewTitle: '实时效果预览',
    footerSetSuccess: '官方底栏模式已设置为',
    footerSavedTo: '已保存至',
    unknownFooterMode: '未知底栏模式',
    availableFooterModes: '可用底栏模式',
    usageFooterMode: '用法: codebuddy-hud --footer <模式> (可选 full | clean | off，例如 codebuddy-hud --footer clean)',
    footerModeFullLabel: '默认完整 4 行 (3 行 HUD + 完整官方第 4 行；移除 HUD 托管的 tui.statusLine)',
    footerModeCleanLabel: '推荐去重 4 行 (隐藏重复的 model / reasoning，保留快捷键、agents 与权限提示)',
    footerModeOffLabel: '纯 3 行 HUD (隐藏全部可配置官方底栏片段，仅显示 3 行 HUD)',
    footerPreviewOffLine: '官方第 4 行已隐藏 — 仅显示 3 行 HUD',
    footerCustomNote: '当前 settings.json 中的 tui.statusLine 为自定义配置 (custom)',

    // Doctor
    doctorTitle: 'CodeBuddy HUD 环境诊断报告',
    doctorSummaryPass: '环境检查全部通过，HUD 运行良好！',
    doctorSummaryWarn: '发现部分环境警告，请查看建议修复项。',
    doctorSummaryFail: '发现环境严重错误，状态栏可能无法正常显示。',
    nodeVersion: 'Node.js 版本',
    nodeExecPath: 'Node 可执行文件路径',
    platformArch: '操作系统与架构',
    codeBuddyHome: 'CodeBuddy 根目录 (CODEBUDDY_HOME)',
    settingsConfig: 'CodeBuddy 配置文件 (settings.json)',
    statusLineCommand: '状态栏命令 (statusLine.command)',
    hostFooterMode: '宿主底栏模式',
    windowsCodePage: 'Windows 终端代码页 (Codepage)',
    windowsPathNormalization: 'Windows 路径规范化 (大小写一致性)',
    unicodeSupport: 'Unicode 渲染支持',
    gitEnvironment: 'Git 环境与当前仓库',
    transcriptAccess: 'Transcript 日志目录访问',
    retainedBackups: '卸载残留的配置恢复副本',
    hostRefreshProtocol: '宿主刷新架构契约',
    doctorNodeOld: 'Node.js 版本过旧，需要 >= 18.0.0',
    doctorSettingsMissing: '未找到 settings.json，请先运行 codebuddy-hud --setup',
    doctorStatusLineMissing: 'settings.json 中未配置 statusLine.command',
    doctorStatusLineInvalid: 'statusLine 命令指向的可执行文件不存在',
    doctorFooterInvalidTui: 'settings.json 中的 "tui" 必须是 JSON 对象',
    doctorFooterInvalidStatusLine: 'settings.json 中的 "tui.statusLine" 应为字符串数组',
    doctorCodepageWarn: '建议运行 "chcp 65001" 启用 UTF-8 支持以获得最佳渲染效果',
    doctorGitBranchSlow: 'Git 分支查询耗时偏高',
    doctorTranscriptMissing: '未检测到 transcript 日志目录或暂无写入',
    doctorRetainedBackups: '卸载时保留了 settings 原文副本，确认无误后可手动删除',

    // Uninstall & Setup
    setupComplete: 'codebuddy-hud setup complete.',
    uninstalledTitle: 'codebuddy-hud uninstalled:',
    nothingToUninstall: 'Nothing to uninstall.',
    restoredBackup: 'Restored settings from backup',
    removedStatusLine: 'Removed statusLine from settings.json',
    removedShim: 'Removed Windows shim',
    removedCache: 'Removed cache state',
    removedUsageState: 'Removed transcript usage state',
    removedSessionState: 'Removed session statistics state',
    removedCreditState: 'Removed credit state',
    removedUserConfig: 'Removed user configuration',
  },
  en: {
    contextPending: 'awaiting usage after compact',
    contextReported: 'last reported',
    // CLI & Theme
    themeSelectTitle: 'Select HUD Theme:',
    themeSelectHint: '[↑/↓ Move | 1-5 Select | Enter Confirm | Esc Cancel]',
    themePreviewTitle: 'Live Theme Preview',
    themeSetSuccess: 'HUD theme set to',
    themeSavedTo: 'saved to',
    unknownTheme: 'Unknown theme',
    availableThemes: 'Available themes',
    usageTheme: 'Usage: codebuddy-hud --theme <name> (e.g. codebuddy-hud --theme cyberpunk)',

    // Footer Mode
    footerSelectTitle: 'Select CodeBuddy Official Footer Mode (4th Line):',
    footerSelectHint: '[↑/↓ Move | 1-3 Select | Enter Confirm | Esc Cancel]',
    footerPreviewTitle: 'Live Footer Preview',
    footerSetSuccess: 'Host footer mode set to',
    footerSavedTo: 'saved to',
    unknownFooterMode: 'Unknown footer mode',
    availableFooterModes: 'Available footer modes',
    usageFooterMode: 'Usage: codebuddy-hud --footer <mode> (options: full | clean | off, e.g. codebuddy-hud --footer clean)',
    footerModeFullLabel: 'Default 4 lines (3-line HUD + full official 4th line; unsets HUD-managed tui.statusLine)',
    footerModeCleanLabel: 'Recommended clean 4 lines (hides duplicate model/reasoning, keeps shortcuts, agents & permission hints)',
    footerModeOffLabel: 'Pure 3-line HUD (hides all configurable official footer segments; 3 lines only)',
    footerPreviewOffLine: 'Official 4th line hidden — 3-line HUD only',
    footerCustomNote: 'Current tui.statusLine in settings.json is custom',

    // Doctor
    doctorTitle: 'CodeBuddy HUD Environment Doctor Report',
    doctorSummaryPass: 'All environment checks passed! HUD is ready.',
    doctorSummaryWarn: 'Some warnings detected, please review recommendations.',
    doctorSummaryFail: 'Critical issues detected. StatusLine may not function properly.',
    nodeVersion: 'Node.js Version',
    nodeExecPath: 'Node Executable Path',
    platformArch: 'Platform & Architecture',
    codeBuddyHome: 'CodeBuddy Home Directory (CODEBUDDY_HOME)',
    settingsConfig: 'CodeBuddy Settings (settings.json)',
    statusLineCommand: 'StatusLine Command (statusLine.command)',
    hostFooterMode: 'Host Footer Mode',
    windowsCodePage: 'Windows Console Codepage',
    windowsPathNormalization: 'Windows Path Normalization',
    unicodeSupport: 'Unicode Support',
    gitEnvironment: 'Git Environment & Active Repo',
    transcriptAccess: 'Transcript Directory Access',
    retainedBackups: 'Retained settings recovery copies',
    hostRefreshProtocol: 'Host Refresh Architecture',
    doctorNodeOld: 'Node.js version is too old, requires >= 18.0.0',
    doctorSettingsMissing: 'settings.json not found, run codebuddy-hud --setup first',
    doctorStatusLineMissing: 'statusLine.command not configured in settings.json',
    doctorStatusLineInvalid: 'Target executable in statusLine command does not exist',
    doctorFooterInvalidTui: 'settings.json "tui" property must be a JSON object',
    doctorFooterInvalidStatusLine: 'settings.json "tui.statusLine" should be an array of strings',
    doctorCodepageWarn: 'Recommendation: run "chcp 65001" for optimal UTF-8 rendering',
    doctorGitBranchSlow: 'Git branch resolution latency is high',
    doctorTranscriptMissing: 'Transcript directory not found or empty',
    doctorRetainedBackups: 'Uninstall left original-settings copies behind; delete them manually once confirmed unneeded',

    // Uninstall & Setup
    setupComplete: 'codebuddy-hud setup complete.',
    uninstalledTitle: 'codebuddy-hud uninstalled:',
    nothingToUninstall: 'Nothing to uninstall.',
    restoredBackup: 'Restored settings from backup',
    removedStatusLine: 'Removed statusLine from settings.json',
    removedShim: 'Removed Windows shim',
    removedCache: 'Removed cache state',
    removedUsageState: 'Removed transcript usage state',
    removedSessionState: 'Removed session statistics state',
    removedCreditState: 'Removed credit state',
    removedUserConfig: 'Removed user configuration',
  },
};

function detectLanguage(config) {
  if (config && (config.language === 'zh' || config.language === 'en')) {
    return config.language;
  }
  const envLang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE || '';
  if (envLang.toLowerCase().includes('zh') || envLang.toLowerCase().includes('chinese')) {
    return 'zh';
  }
  return 'en';
}

function getI18n(config) {
  const lang = detectLanguage(config);
  const dict = DICTIONARY[lang] || DICTIONARY.en;
  return {
    lang,
    t: (key, fallback) => dict[key] || fallback || DICTIONARY.en[key] || key,
    dict,
  };
}

module.exports = { DICTIONARY, detectLanguage, getI18n };
