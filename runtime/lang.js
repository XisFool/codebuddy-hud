'use strict';

const DICTIONARY = {
  zh: {
    // CLI & Theme
    themeSelectTitle: '请选择 HUD 主题 (Select HUD Theme):',
    themeSelectHint: '[↑/↓ 移动 | 1-5 选择 | Enter 确认 | Esc 取消]',
    themePreviewTitle: '实时效果预览',
    themeSetSuccess: 'HUD 主题已设置为',
    themeSavedTo: '已保存至',
    unknownTheme: '未知主题',
    availableThemes: '可用主题',
    usageTheme: '用法: codebuddy-hud --theme <名称> (例如 codebuddy-hud --theme cyberpunk)',

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
    windowsCodePage: 'Windows 终端代码页 (Codepage)',
    windowsPathNormalization: 'Windows 路径规范化 (大小写一致性)',
    unicodeSupport: 'Unicode 渲染支持',
    gitEnvironment: 'Git 环境与当前仓库',
    transcriptAccess: 'Transcript 日志目录访问',
    hostRefreshProtocol: '宿主刷新架构契约',
    doctorNodeOld: 'Node.js 版本过旧，需要 >= 18.0.0',
    doctorSettingsMissing: '未找到 settings.json，请先运行 codebuddy-hud --setup',
    doctorStatusLineMissing: 'settings.json 中未配置 statusLine.command',
    doctorStatusLineInvalid: 'statusLine 命令指向的可执行文件不存在',
    doctorCodepageWarn: '建议运行 "chcp 65001" 启用 UTF-8 支持以获得最佳渲染效果',
    doctorGitBranchSlow: 'Git 分支查询耗时偏高',
    doctorTranscriptMissing: '未检测到 transcript 日志目录或暂无写入',

    // Uninstall & Setup
    setupComplete: 'codebuddy-cli-hud setup complete.',
    uninstalledTitle: 'codebuddy-cli-hud uninstalled:',
    nothingToUninstall: 'Nothing to uninstall.',
    restoredBackup: 'Restored settings from backup',
    removedStatusLine: 'Removed statusLine from settings.json',
    removedShim: 'Removed Windows shim',
    removedCache: 'Removed cache state',
    removedUsageState: 'Removed transcript usage state',
    removedSessionState: 'Removed session statistics state',
    removedCreditState: 'Removed credit state',
    removedUserConfig: 'Removed user configuration',

    // Update
    updateAvailable: '发现新版本',
    updateTip: '运行安装脚本即可更新',
  },
  en: {
    // CLI & Theme
    themeSelectTitle: 'Select HUD Theme:',
    themeSelectHint: '[↑/↓ Move | 1-5 Select | Enter Confirm | Esc Cancel]',
    themePreviewTitle: 'Live Theme Preview',
    themeSetSuccess: 'HUD theme set to',
    themeSavedTo: 'saved to',
    unknownTheme: 'Unknown theme',
    availableThemes: 'Available themes',
    usageTheme: 'Usage: codebuddy-hud --theme <name> (e.g. codebuddy-hud --theme cyberpunk)',

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
    windowsCodePage: 'Windows Console Codepage',
    windowsPathNormalization: 'Windows Path Normalization',
    unicodeSupport: 'Unicode Support',
    gitEnvironment: 'Git Environment & Active Repo',
    transcriptAccess: 'Transcript Directory Access',
    hostRefreshProtocol: 'Host Refresh Architecture',
    doctorNodeOld: 'Node.js version is too old, requires >= 18.0.0',
    doctorSettingsMissing: 'settings.json not found, run codebuddy-hud --setup first',
    doctorStatusLineMissing: 'statusLine.command not configured in settings.json',
    doctorStatusLineInvalid: 'Target executable in statusLine command does not exist',
    doctorCodepageWarn: 'Recommendation: run "chcp 65001" for optimal UTF-8 rendering',
    doctorGitBranchSlow: 'Git branch resolution latency is high',
    doctorTranscriptMissing: 'Transcript directory not found or empty',

    // Uninstall & Setup
    setupComplete: 'codebuddy-cli-hud setup complete.',
    uninstalledTitle: 'codebuddy-cli-hud uninstalled:',
    nothingToUninstall: 'Nothing to uninstall.',
    restoredBackup: 'Restored settings from backup',
    removedStatusLine: 'Removed statusLine from settings.json',
    removedShim: 'Removed Windows shim',
    removedCache: 'Removed cache state',
    removedUsageState: 'Removed transcript usage state',
    removedSessionState: 'Removed session statistics state',
    removedCreditState: 'Removed credit state',
    removedUserConfig: 'Removed user configuration',

    // Update
    updateAvailable: 'New version available',
    updateTip: 'Run install script to update',
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
