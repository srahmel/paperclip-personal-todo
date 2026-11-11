import { useHostContext, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { createI18n, resolveLocale } from "../i18n.js";
import boardHtml from "../../dist/ui/board.html";
function useHostLocale() {
  const [locale, setLocale] = useState(() =>
    resolveLocale(document.documentElement.lang),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setLocale(resolveLocale(document.documentElement.lang)),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
    return () => observer.disconnect();
  }, []);
  return locale;
}
export function BoardPage() {
  const context = useHostContext();
  const locale = useHostLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  // Copy the host's presentation settings, never its application data.
  const syncAppearance = () => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root) return;
    const host = document.documentElement;
    const style = getComputedStyle(host);
    const language = resolveLocale(host.lang);
    if (root.lang !== language) root.lang = language;
    root.dataset.theme = host.classList.contains("dark") ? "dark" : "light";
    for (const [target, source] of Object.entries({
      "--bg": "--background",
      "--panel": "--card",
      "--text": "--foreground",
      "--muted": "--muted-foreground",
      "--line": "--border",
      "--subtle": "--muted",
      "--hover": "--accent",
      "--primary": "--primary",
      "--primary-text": "--primary-foreground",
      "--ring": "--ring",
    })) {
      const value = style.getPropertyValue(source).trim();
      if (value) root.style.setProperty(target, value);
    }
  };
  useEffect(() => {
    const observer = new MutationObserver(syncAppearance);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "lang"],
    });
    syncAppearance();
    return () => observer.disconnect();
  }, [context.companyId]);
  const html = useMemo(
    () =>
      boardHtml
        .replace(
          '<html lang="en">',
          '<html lang="' +
            resolveLocale(document.documentElement.lang) +
            '" data-embedded="true" data-theme="' +
            (document.documentElement.classList.contains("dark")
              ? "dark"
              : "light") +
            '">',
        )
        .replace(
          '<div id="app"></div>',
          '<div id="app" data-company-id="' +
            encodeURIComponent(context.companyId ?? "") +
            '"></div>',
        ),
    [context.companyId],
  );
  if (!context.companyId)
    return <p>{createI18n(locale).t("Select your organization.")}</p>;
  return (
    <iframe
      ref={frame}
      title={createI18n(locale).t("Sebastian's Task Board")}
      srcDoc={html}
      onLoad={syncAppearance}
      style={{
        width: "100%",
        height: "calc(100dvh - 130px)",
        minHeight: 420,
        border: 0,
        display: "block",
      }}
    />
  );
}
export function BoardSidebar() {
  const navigation = useHostNavigation();
  const locale = useHostLocale();
  return (
    <a
      {...navigation.linkProps("/personal-todo")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m3 6 2 2 3-4M11 6h10M3 12h3M11 12h10M3 18h3M11 18h10" />
      </svg>
      <span>{createI18n(locale).t("My tasks")}</span>
    </a>
  );
}
