import { useHostContext, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import { useEffect, useMemo, useRef } from "react";
import boardHtml from "../../dist/ui/board.html";
export function BoardPage() {
  const context = useHostContext();
  const frame = useRef<HTMLIFrameElement>(null);
  // The board is trusted plugin content. Copy only appearance tokens, never host state.
  const syncAppearance = () => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root) return;
    const host = document.documentElement;
    const style = getComputedStyle(host);
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
      attributeFilter: ["class", "style"],
    });
    syncAppearance();
    return () => observer.disconnect();
  }, [context.companyId]);
  const html = useMemo(
    () =>
      boardHtml
        .replace(
          '<html lang="de">',
          '<html lang="de" data-embedded="true" data-theme="' +
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
  if (!context.companyId) return <p>Wähle deine Organisation aus.</p>;
  return (
    <iframe
      ref={frame}
      title="Sebastians Aufgaben-Board"
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
      <span>Meine Aufgaben</span>
    </a>
  );
}
