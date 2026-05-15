import { createContext, useContext, type ReactNode } from "react";

export type LanguageCode = "en" | "zh-CN";

export const LANGUAGE_OPTIONS: readonly { code: LanguageCode; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "简体中文" },
];

type TranslationParams = Readonly<Record<string, string | number>>;

const en = {
  "common.appName": "pi-gui",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.workspace": "Workspace",
  "common.worktree": "Worktree",
  "common.local": "Local",
  "common.loadingSessions": "Loading sessions",
  "common.restoreState": "The desktop shell is restoring folder and thread state from the main process.",
  "sidebar.newThread": "New thread",
  "sidebar.threads": "Threads",
  "sidebar.skills": "Skills",
  "sidebar.extensions": "Extensions",
  "sidebar.settings": "Settings",
  "sidebar.openFolder": "Open folder",
  "sidebar.noFoldersTitle": "No folders yet",
  "sidebar.noFoldersBody": "Open a project folder to start building a workspace and session list.",
  "sidebar.openFirstFolder": "Open first folder",
  "sidebar.workspaceActions": "Workspace actions for {name}",
  "sidebar.removeWorktree": "Remove worktree",
  "sidebar.createPermanentWorktree": "Create permanent worktree",
  "sidebar.editName": "Edit name",
  "sidebar.remove": "Remove",
  "sidebar.renameWorkspace": "Rename {name}",
  "sidebar.archived": "Archived",
  "sidebar.restoreThread": "Restore {title}",
  "sidebar.archiveThread": "Archive {title}",
  "topbar.openFolderToBegin": "Open a folder to begin",
  "topbar.toggleTerminal": "Toggle terminal",
  "topbar.toggleChanges": "Toggle changes",
  "topbar.addFolder": "Add folder",
  "settings.title": "Settings",
  "settings.selectWorkspaceTitle": "Select a workspace",
  "settings.selectWorkspaceBody": "Provider and skill settings need a selected workspace.",
  "settings.nav.appearance": "Appearance",
  "settings.nav.general": "General",
  "settings.nav.providers": "Providers",
  "settings.nav.models": "Models",
  "settings.nav.notifications": "Notifications",
  "settings.description.appearance": "Choose between light, dark, or automatic system theme.",
  "settings.description.providers": "Connect providers and manage auth for {workspace}.",
  "settings.description.models": "Choose the default model and which models appear in pickers.",
  "settings.description.notifications": "Manage both macOS notification access and which background events should alert you.",
  "settings.description.general": "Keep the high-value app and runtime controls close to hand.",
  "settings.general.group": "General",
  "settings.general.connectedProviders": "Connected providers",
  "settings.general.none": "None",
  "settings.general.discoveredSkills": "Discovered skills",
  "settings.general.modelScope": "Model settings scope",
  "settings.general.modelScopeDescription": "Choose whether model defaults apply everywhere or per repo.",
  "settings.general.appGlobal": "App global",
  "settings.general.perRepo": "Per repo",
  "settings.general.enableSkillCommands": "Enable skill slash commands",
  "settings.general.enableSkillCommandsDescription": "Keep skill slash commands available in the composer.",
  "settings.general.integratedTerminalShell": "Shell of integrated terminal",
  "settings.general.integratedTerminalShellDescription": "Leave blank to use your default login shell.",
  "settings.general.shortcuts": "Shortcuts",
  "settings.general.shortcutNewThread": "New thread",
  "settings.general.shortcutOpenSettings": "Open settings",
  "settings.general.shortcutToggleTerminal": "Toggle terminal",
  "settings.general.shortcutNewTerminalTab": "New terminal tab",
  "settings.general.shortcutSendMessage": "Send message",
  "settings.general.shortcutNewLine": "New line",
  "settings.appearance.theme": "Theme",
  "settings.appearance.language": "Language",
  "settings.appearance.system": "System",
  "settings.appearance.systemDescription": "Follow your OS appearance setting",
  "settings.appearance.light": "Light",
  "settings.appearance.lightDescription": "Always use the light theme",
  "settings.appearance.dark": "Dark",
  "settings.appearance.darkDescription": "Always use the dark theme",
  "settings.appearance.languageDescription": "Choose the display language for pi.",
  "newThread.title": "New thread",
  "newThread.openFolderTitle": "Open a folder to begin",
  "newThread.openFolderBody": "Select a repository from the sidebar first, then start a local or worktree-backed thread.",
  "newThread.heroTitle": "Let's build",
  "newThread.workspaceLabel": "Workspace",
  "newThread.promptLabel": "New thread prompt",
  "newThread.placeholder": "Ask pi anything, use / for commands and skills",
  "newThread.attachFiles": "Attach files",
  "newThread.startThread": "Start thread",
  "empty.workspaceEyebrow": "Workspace",
  "empty.openFolderTitle": "Open a folder to start",
  "empty.newThreadNoFolderBody": "Add a project folder before creating a new thread.",
  "empty.workspaceBody": "Create a thread for this folder, then jump between sessions from the sidebar.",
  "empty.noWorkspaceBody": "Add project folders, group sessions under them, and jump between threads from the sidebar.",
} as const;

export type TranslationKey = keyof typeof en;
type TranslationTable = Record<TranslationKey, string>;

const zhCN: TranslationTable = {
  "common.appName": "pi-gui",
  "common.cancel": "取消",
  "common.save": "保存",
  "common.workspace": "工作区",
  "common.worktree": "工作树",
  "common.local": "本地",
  "common.loadingSessions": "正在加载会话",
  "common.restoreState": "桌面外壳正在从主进程恢复文件夹和线程状态。",
  "sidebar.newThread": "新线程",
  "sidebar.threads": "线程",
  "sidebar.skills": "技能",
  "sidebar.extensions": "扩展",
  "sidebar.settings": "设置",
  "sidebar.openFolder": "打开文件夹",
  "sidebar.noFoldersTitle": "还没有文件夹",
  "sidebar.noFoldersBody": "打开一个项目文件夹，开始建立工作区和会话列表。",
  "sidebar.openFirstFolder": "打开第一个文件夹",
  "sidebar.workspaceActions": "{name} 的工作区操作",
  "sidebar.removeWorktree": "移除工作树",
  "sidebar.createPermanentWorktree": "创建永久工作树",
  "sidebar.editName": "编辑名称",
  "sidebar.remove": "移除",
  "sidebar.renameWorkspace": "重命名 {name}",
  "sidebar.archived": "已归档",
  "sidebar.restoreThread": "恢复 {title}",
  "sidebar.archiveThread": "归档 {title}",
  "topbar.openFolderToBegin": "打开文件夹开始",
  "topbar.toggleTerminal": "切换终端",
  "topbar.toggleChanges": "切换变更",
  "topbar.addFolder": "添加文件夹",
  "settings.title": "设置",
  "settings.selectWorkspaceTitle": "选择工作区",
  "settings.selectWorkspaceBody": "提供商和技能设置需要先选择一个工作区。",
  "settings.nav.appearance": "外观",
  "settings.nav.general": "通用",
  "settings.nav.providers": "提供商",
  "settings.nav.models": "模型",
  "settings.nav.notifications": "通知",
  "settings.description.appearance": "选择浅色、深色，或跟随系统主题。",
  "settings.description.providers": "连接提供商并管理 {workspace} 的认证。",
  "settings.description.models": "选择默认模型，以及哪些模型出现在选择器中。",
  "settings.description.notifications": "管理 macOS 通知权限，以及哪些后台事件需要提醒你。",
  "settings.description.general": "把高价值的应用和运行时控制放在手边。",
  "settings.general.group": "通用",
  "settings.general.connectedProviders": "已连接提供商",
  "settings.general.none": "无",
  "settings.general.discoveredSkills": "已发现技能",
  "settings.general.modelScope": "模型设置范围",
  "settings.general.modelScopeDescription": "选择模型默认值应用到整个应用，还是按仓库分别设置。",
  "settings.general.appGlobal": "应用全局",
  "settings.general.perRepo": "按仓库",
  "settings.general.enableSkillCommands": "启用技能斜杠命令",
  "settings.general.enableSkillCommandsDescription": "让技能斜杠命令在输入框中可用。",
  "settings.general.integratedTerminalShell": "集成终端 Shell",
  "settings.general.integratedTerminalShellDescription": "留空则使用默认登录 shell。",
  "settings.general.shortcuts": "快捷键",
  "settings.general.shortcutNewThread": "新线程",
  "settings.general.shortcutOpenSettings": "打开设置",
  "settings.general.shortcutToggleTerminal": "切换终端",
  "settings.general.shortcutNewTerminalTab": "新终端标签",
  "settings.general.shortcutSendMessage": "发送消息",
  "settings.general.shortcutNewLine": "换行",
  "settings.appearance.theme": "主题",
  "settings.appearance.language": "语言",
  "settings.appearance.system": "系统",
  "settings.appearance.systemDescription": "跟随操作系统外观设置",
  "settings.appearance.light": "浅色",
  "settings.appearance.lightDescription": "始终使用浅色主题",
  "settings.appearance.dark": "深色",
  "settings.appearance.darkDescription": "始终使用深色主题",
  "settings.appearance.languageDescription": "选择 pi 的显示语言。",
  "newThread.title": "新线程",
  "newThread.openFolderTitle": "打开文件夹开始",
  "newThread.openFolderBody": "先从侧栏选择一个仓库，然后启动本地或工作树线程。",
  "newThread.heroTitle": "开始构建",
  "newThread.workspaceLabel": "工作区",
  "newThread.promptLabel": "新线程提示词",
  "newThread.placeholder": "向 pi 提问，使用 / 调出命令和技能",
  "newThread.attachFiles": "附加文件",
  "newThread.startThread": "启动线程",
  "empty.workspaceEyebrow": "工作区",
  "empty.openFolderTitle": "打开文件夹开始",
  "empty.newThreadNoFolderBody": "创建新线程前，请先添加一个项目文件夹。",
  "empty.workspaceBody": "为这个文件夹创建线程，然后从侧栏在会话之间切换。",
  "empty.noWorkspaceBody": "添加项目文件夹，把会话归入其中，并从侧栏在线程间跳转。",
};

const translations: Record<LanguageCode, TranslationTable> = {
  en,
  "zh-CN": zhCN,
};

export interface I18nContextValue {
  readonly language: LanguageCode;
  readonly t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue>({
  language: "en",
  t: (key) => en[key],
});

export function normalizeLanguageCode(value: string | undefined | null): LanguageCode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "zh-cn" || normalized === "zh" || normalized?.startsWith("zh-")) {
    return "zh-CN";
  }
  return "en";
}

export function I18nProvider({ language, children }: { readonly language: LanguageCode; readonly children: ReactNode }) {
  const t = (key: TranslationKey, params?: TranslationParams): string => {
    const template = translations[language][key] ?? en[key];
    if (!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, paramKey: string) => {
      const value = params[paramKey];
      return value === undefined ? match : String(value);
    });
  };

  return <I18nContext.Provider value={{ language, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
