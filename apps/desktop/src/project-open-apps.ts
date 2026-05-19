export const PROJECT_OPEN_APPS = [
  { id: "vscode", label: "VS Code", macAppName: "Visual Studio Code" },
  { id: "cursor", label: "Cursor", macAppName: "Cursor" },
  { id: "finder", label: "Finder", macAppName: "Finder" },
  { id: "terminal", label: "Terminal", macAppName: "Terminal" },
  { id: "ghostty", label: "Ghostty", macAppName: "Ghostty" },
  { id: "xcode", label: "Xcode", macAppName: "Xcode" },
] as const;

export type ProjectOpenAppId = (typeof PROJECT_OPEN_APPS)[number]["id"];

export const DEFAULT_PROJECT_OPEN_APP_ID: ProjectOpenAppId = "finder";

export function isProjectOpenAppId(value: unknown): value is ProjectOpenAppId {
  return typeof value === "string" && PROJECT_OPEN_APPS.some((app) => app.id === value);
}

export function getProjectOpenApp(id: ProjectOpenAppId) {
  return PROJECT_OPEN_APPS.find((app) => app.id === id) ?? PROJECT_OPEN_APPS[0];
}
