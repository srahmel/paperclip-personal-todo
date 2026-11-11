# Optionale MCP-Zugriffswege

Das Board bleibt die gemeinsame Aufgaben-Datenbank. Office und Fyxer bleiben getrennte Quellen. MCP-Server werden dem Import-Agenten zugeordnet; das Board muss dazu weder Microsoft-Tokens noch Browser-Sessions übernehmen.

Die Datei [mcp.example.json](../integrations/mcp.example.json) ist eine **nicht aktivierte Vorlage**. Sie wird nicht beim Plugin-Start geladen, installiert keine Agentenverbindung und erteilt keine Rechte. Die npm-Versionen sind auf den geprüften Stand festgelegt.

## Softeria Microsoft 365

[Softeria/ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server) spricht die Microsoft Graph API direkt an. Der Dienst unterstützt Outlook sowie im Organisationsmodus Teams. Der vorbereitete Aufruf nutzt `--org-mode`, `--read-only` und eine ausdrückliche Liste von Lese-Werkzeugen für Nachrichten, Chats und Kanäle. Kalender, Dateien, Kontakte, Senden und Verwaltungsaktionen sind in diesem Profil nicht enthalten.

Vor einer Anmeldung die tatsächlich abgeleiteten Berechtigungen mit denselben Optionen und zusätzlich `--list-permissions` prüfen. Die konkrete Microsoft-Anmeldung und gegebenenfalls eine Administratorzustimmung sind separate Schritte. Vorhandene Codex-/OWA-Sitzungen erzeugen keine Softeria-Anmeldung. Keine Tokens aus diesen Sitzungen kopieren. Der Nur-Lesen-Modus begrenzt angebotene Werkzeuge; ein früher erteilter, breiterer Token wird dadurch nicht rückwirkend eingeschränkt.

Die aktiven Unternehmensregeln haben Vorrang. Wenn diese für Outlook ausschließlich OWA und direkte Codex-Outlook-Werkzeuge erlauben, bleibt Softeria vorbereitet, bis die konkrete Ausnahme für diesen Collector freigegeben und die maßgebliche Agentenregel angepasst wurde. Keine Outlook-Verbindung über einen Aggregator oder eine automatische Paperclip-Verbindungsanfrage anlegen.

Nach Freigabe und Anmeldung: Kontozuordnung prüfen, eine kleine Nachrichtenseite und einen bekannten Teams-Thread lesend abrufen, dann `provider: outlook` beziehungsweise `provider: teams` an das Board melden. Noch unzugängliche Kanäle bleiben ein Teilimport; sie dürfen nicht als vollständig geprüft gelten.

## Microsoft Playwright MCP

[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) stellt Browser-Automatisierung bereit. Für allgemeine Webseiten bleibt der integrierte Browser der erste Weg. Für die vorgeschriebene OWA-Ausnahme kann ein vorhandenes eigenes Brave-Agentenprofil über seinen CDP-Endpunkt verwendet werden.

In der Vorlage muss `REPLACE_WITH_OWN_AGENT_CDP_PORT` durch den tatsächlich laufenden **eigenen** Agenten-Endpunkt ersetzt werden. Ein vorhandenes Profil wird ohne Neustart genutzt. Kein zweites Browserprogramm mit demselben Profilordner starten. Läuft noch kein Profil, erfolgt der Start über den vorgesehenen Agenten-Launcher im Headless-Modus, danach wird dessen tatsächlicher CDP-Endpunkt verwendet.

Playwright ist kein technisch auf Lesen begrenzter Daten-Connector. Die geltenden Aktionsfreigaben gelten weiterhin. Keine Cookie-/Storage-Exporte, kein Auslesen von Zugangsdaten, keine globale Eingabe oder Fokusaktivierung eines Headless-Fensters. Keine Aktionen, die Nachrichten senden, Aufgaben in Fyxer abhaken oder Einstellungen ändern. Bei 2FA oder fehlgeschlagener Anmeldung ist eine gezielte Nutzerinteraktion nötig.

Der CDP-Aufruf wurde hier als Konfigurationsweg vorbereitet; ein produktiver Microsoft-Login über diese Vorlage ist damit nicht nachgewiesen.

## Fyxer bleibt eigenständig

Weder Softeria noch Playwright sind Ersatz für die Fyxer-Datenquelle. Vorhandene Fyxer-Werkzeuge werden für Action Items, Aufzeichnungen und belegte Statusänderungen genutzt. Wenn Suchkontext verfügbar ist, Detail-/Transkriptzugriff aber fehlt, dürfen daraus belegte Aufgaben ergänzt werden; die Quelle bleibt **teilweise geprüft**. Fehlende Detailrechte dürfen nicht durch Session-/Token-Extraktion oder eine erfundene API umgangen werden.

## Einheitlicher Import

Unabhängig vom Zugriffsweg gelten dieselben Verträge: zuerst `list_tasks` beziehungsweise den HTTP-Helper `list` aufrufen, belegte Aufgaben mit stabilen Quellschlüsseln ergänzen, anschließend für jede Quelle tatsächlichen Zeitraum und Status melden. Bei großen Postfächern kleine Seiten und Zeitfenster nutzen und Ergebnisse zwischendurch speichern; keine kompletten Postfächer oder Transkripte in einen einzelnen Tool-Output laden.

## Geprüfter Berechtigungsumfang

Der vorbereitete Softeria-Aufruf wurde mit `--list-permissions` ohne Anmeldung geprüft. Er meldete ausschließlich `Mail.Read`, `Chat.ReadBasic`, `ChatMessage.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All` und `ChannelMessage.Read.All`; keine deaktivierten Werkzeuge und keine Schreibberechtigungen. Das ist eine Prüfung der Konfiguration, kein Nachweis einer bereits erteilten Microsoft-Zustimmung.
