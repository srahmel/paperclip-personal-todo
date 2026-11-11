import { useHostContext, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import boardHtml from "../../dist/ui/board.html";
export function BoardPage() {
  const context = useHostContext();
  if (!context.companyId) return <p>Wähle deine Organisation aus.</p>;
  return (
    <iframe
      title="Sebastians Aufgaben-Board"
      srcDoc={boardHtml.replace(
        '<div id="app"></div>',
        '<div id="app" data-company-id="' +
          encodeURIComponent(context.companyId) +
          '"></div>',
      )}
      style={{
        width: "100%",
        height: "calc(100dvh - 130px)",
        minHeight: 600,
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
      <span aria-hidden="true">☑</span>
      <span>Meine Aufgaben</span>
    </a>
  );
}
