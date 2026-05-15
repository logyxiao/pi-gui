import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import App from "./App";
import "./dev-reload-hook";
import "./styles.css";
import { I18nProvider, normalizeLanguageCode, type LanguageCode } from "./i18n";

function Root() {
  const [language, setLanguage] = useState<LanguageCode>(() => normalizeLanguageCode(navigator.language));

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const api = window.piApp;
    if (!api?.getLanguage) {
      return;
    }
    void api.getLanguage().then(setLanguage);
  }, []);

  const handleSetLanguage = (nextLanguage: LanguageCode) => {
    setLanguage(nextLanguage);
    void window.piApp?.setLanguage?.(nextLanguage).then(setLanguage);
  };

  return (
    <I18nProvider language={language}>
      <App language={language} onSetLanguage={handleSetLanguage} />
    </I18nProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
