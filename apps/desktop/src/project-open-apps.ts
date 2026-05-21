export const PROJECT_OPEN_APPS = [
  {
    id: "vscode",
    label: "VS Code",
    macAppName: "Visual Studio Code",
    macAppPaths: ["/Applications/Visual Studio Code.app"],
  },
  {
    id: "cursor",
    label: "Cursor",
    macAppName: "Cursor",
    macAppPaths: ["/Applications/Cursor.app"],
  },
  {
    id: "finder",
    label: "Finder",
    macAppName: "Finder",
    macAppPaths: ["/System/Library/CoreServices/Finder.app"],
  },
  {
    id: "terminal",
    label: "Terminal",
    macAppName: "Terminal",
    macAppPaths: ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    macAppName: "Ghostty",
    macAppPaths: ["/Applications/Ghostty.app"],
  },
  {
    id: "xcode",
    label: "Xcode",
    macAppName: "Xcode",
    macAppPaths: ["/Applications/Xcode.app"],
  },
] as const;

export type ProjectOpenAppId = (typeof PROJECT_OPEN_APPS)[number]["id"];

export const DEFAULT_PROJECT_OPEN_APP_ID: ProjectOpenAppId = "finder";

export function isProjectOpenAppId(value: unknown): value is ProjectOpenAppId {
  return typeof value === "string" && PROJECT_OPEN_APPS.some((app) => app.id === value);
}

export function getProjectOpenApp(id: ProjectOpenAppId) {
  return PROJECT_OPEN_APPS.find((app) => app.id === id) ?? PROJECT_OPEN_APPS[0];
}
