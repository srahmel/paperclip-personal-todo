# Sebastians Aufgaben-Board

Persönliche Aufgaben aus **Outlook, Microsoft Teams und Fyxer-Meetings**, direkt in Paperclip. Deutsche Oberfläche mit „Meine“ / „Bei anderen“, Fristen, Prioritäten, Bereichen, Quellen, Notizen und Live-Aktualisierung.

## Installation

Voraussetzungen: Node.js ab 24.11, pnpm 9.15.4 und eine selbst gehostete Paperclip-Instanz mit Plugin-Datenbank, eigenen API-Routen und verwalteten Routinen. Entwickelt mit dem offiziellen SDK **2026.1106.0**. Das Plugin läuft als vertrauenswürdiger Code in deiner Paperclip-Instanz.

```sh
git clone https://github.com/srahmel/paperclip-personal-todo.git
cd paperclip-personal-todo
pnpm install --frozen-lockfile
pnpm build
paperclipai auth login --instance-admin --api-base http://127.0.0.1:3100
paperclipai plugin install . --api-base http://127.0.0.1:3100
paperclipai plugin inspect srahmel.personal-todo --api-base http://127.0.0.1:3100
```

Danach erscheint **Meine Aufgaben** in der Seitenleiste. Der Organisationspfad lautet `/<Organisationskürzel>/personal-todo`.

Falls dein Server ein anderes `PAPERCLIP_HOME` nutzt, setze es auch für die CLI. Eine vorhandene Browser-Anmeldung meldet die CLI nicht automatisch an. Ein nur für die Installation angelegter CLI-Zugang lässt sich danach mit `paperclipai auth logout` widerrufen und lokal entfernen.

Lokale Installationen bleiben mit diesem Ordner verbunden. `pnpm dev` baut Änderungen neu; Paperclip lädt die aktualisierten Worker-Dateien. Nach Änderungen der Oberfläche gegebenenfalls die Browserseite neu laden. Änderungen an Manifest-Deklarationen können ein Plugin-Upgrade benötigen; vorhandene Routinen werden zum Schutz manueller Einstellungen nicht still zurückgesetzt.

## Quellen und Morning Brief

1. Im Board **Quellen & Morning Brief** aufklappen.
2. Einen vorhandenen, autorisierten Import-Agenten wählen und **Agent einrichten** anklicken.
3. **Office & Fyxer jetzt prüfen** startet einen sichtbaren Paperclip-Auftrag.
4. Nach erfolgreicher Quellenprüfung bei Bedarf **Morning Brief aktivieren**. Der Zeitplan ist Montag bis Freitag um 09:00 Uhr in `Europe/Berlin`; neue Routinen sind zunächst pausiert.

Der Collector nutzt seine vorhandenen Zugriffe. Das Plugin enthält keine OAuth-Geheimnisse und fordert keine neuen Quellenberechtigungen an. Ein in Codex verfügbarer Zugriff ist nicht automatisch ein Nachweis für den Zugriff eines getrennten Paperclip-Agentenlaufs.

| Quelle  | Zugriff des Collectors                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outlook | Vorhandene direkte Codex-Outlook-Werkzeuge oder OWA im eigenen Brave-Agentenprofil. Nur lesend. Kein Aggregator und keine neue Paperclip-Outlook-Verbindung.         |
| Teams   | Vorhandene direkte Teams-Werkzeuge oder eine bestehende autorisierte Teams-Websitzung. Nur lesend.                                                                   |
| Fyxer   | Vorhandene Fyxer-Werkzeuge `search_context`, `find_recordings`, `get_recording`, bei Bedarf `get_transcript`. Action Items und konkrete Zusagen aus Meetings prüfen. |

Alle drei Quellen werden unabhängig geprüft. Fehlender Zugriff, Suchlimits oder unvollständig gelesene Seiten erscheinen als Fehler oder Teilimport. Nur ein vollständig geprüfter Zeitraum verschiebt den letzten erfolgreichen Prüfzeitpunkt. Ein neuer Collector-Lauf setzt die Quellen zunächst auf „Prüfung läuft“; fehlende Abschlussmeldungen werden nach 30 Minuten als unvollständig angezeigt.

Der erste Import prüft die letzten 30 Tage; Folgeimporte nutzen je Quelle den letzten erfolgreichen Zeitpunkt mit zwei Tagen Überlappung. Lange Zeiträume müssen in kleinere Fenster geteilt werden. Fremde Unternehmens-/Kontosphären werden durch die vorhandenen Agentenregeln ausgeschlossen. Das Plugin teilt oder versendet keine Quellinhalte.

## Daten und Bearbeitung

Optionale Zugriffsprofile für **Softeria Microsoft 365 MCP** und **Microsoft Playwright MCP** stehen unter [Integrationen](docs/integrations.md). Die Vorlagen sind nicht aktiviert und enthalten keine Zugangsdaten.

- Jede Aufgabe liegt als einzelnes JSON-Dokument in der PostgreSQL-Tabelle `tasks` des vom Host isolierten Plugin-Schemas.
- Alle Abfragen sind auf Organisation und authentifizierten Benutzer begrenzt. Ein explizit gewählter Collector darf nur sein gebundenes Board lesen und Importe ergänzen.
- Manuell geänderte Felder bleiben vor Import-Überschreibung geschützt. Notizen werden nie aus Quellen ersetzt. Erledigte Aufgaben werden nicht automatisch wieder geöffnet.
- Stabile `sourceKey`-Werte verhindern Wiederholungen derselben Fundstelle. `taskKey` und optional `existingId` verbinden sicher identische Aufgaben aus verschiedenen Quellen. Die fachliche Identitätsentscheidung trifft der Collector; unklare Fälle bleiben getrennt.
- Automatisch „Erledigt“ braucht einen expliziten `completionEvidence`-Nachweis. Er wird mit der Aufgabe gespeichert und im Board angezeigt.
- Browseränderungen nutzen Revisionsnummern. Bei einem gleichzeitigen Update wird dein Entwurf erhalten und ein Konflikt angezeigt.
- `localStorage` enthält ausschließlich Tab- und Bereichsauswahl, immer mit Fehlerbehandlung. Aufgaben werden dort nicht gespeichert.
- Streams enthalten nur Änderungsereignisse. Die Oberfläche liest danach die benutzergebundenen Aufgaben neu; auch nach einer Wiederverbindung.
- „Bei anderen“ ist eine Nachverfolgung und startet keine Ausführungsaufgabe bei dieser Person.

Pro Organisation kann die eine verwaltete Morning-Brief-Routine an genau ein persönliches Board gebunden werden. Andere Benutzer erhalten eigene leere Ansichten und können das private Board nicht lesen.

Das `hr`-Flag ist eine Kennzeichnung, keine zusätzliche Berechtigungsgrenze innerhalb deines eigenen Boards. Die Sichtbarkeit wird durch die Benutzer-/Collector-Bindung geschützt.

## Werkzeuge und API

Das Plugin registriert für den gebundenen Import-Agenten:

- `srahmel.personal-todo:list_tasks`
- `srahmel.personal-todo:upsert_tasks`
- `srahmel.personal-todo:report_source`

Die eigene API liegt unter `/api/plugins/srahmel.personal-todo/api/board`. `GET` verwendet `companyId` als Queryparameter; `POST` nimmt `companyId` und `op` als JSON an. Der Host authentifiziert Board-Benutzer oder Agenten. Benutzer-IDs aus Request-Daten werden nicht als Zugriffsberechtigung verwendet.

Für CLI-Adapter ohne direkt angebotene Plugin-Werkzeuge gibt es `scripts/import_tasks.py`. Es nutzt ausschließlich die vom Paperclip-Lauf bereitgestellten Umgebungsvariablen und protokolliert keine Schlüssel:

```sh
python scripts/import_tasks.py list
python scripts/import_tasks.py upsert --payload /path/to/tasks.json
python scripts/import_tasks.py report --payload /path/to/source-status.json
```

`upsert` erwartet beispielsweise synthetische Daten dieses Formats:

```json
{
  "provider": "fyxer",
  "tasks": [
    {
      "title": "Prüfe die Projektfreigabe",
      "kind": "mine",
      "sourceKey": "recording-example:action-1",
      "taskKey": "example-project-approval",
      "due": null,
      "prio": 2,
      "area": "software",
      "category": "partial",
      "source": { "title": "Beispielbesprechung", "date": "2026-11-01" }
    }
  ]
}
```

## HTML-Artefakt und Entwicklung

Das eigentliche Board besteht aus Vanilla TypeScript/JavaScript, HTML und CSS. Der Build erzeugt **eine eigenständige HTML-Datei** `dist/aufgaben-board.html` mit eingebetteten IBM-Plex-Schriften. Eine kleine React-Hülle bindet dieselbe Datei als vertrauenswürdige Plugin-Seite ein. Die persönliche Authentifizierung und Datenspeicherung benötigen weiterhin den Paperclip-Host; eine isolierte gewöhnliche Paperclip-HTML-Artefaktvorschau erlaubt keine API-Zugriffe.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm preview
```

`tests/service.spec.ts` prüft das tatsächliche SQL gegen PGlite: Entdoppelung, Revisionskonflikte, Benutzer-/Organisationsgrenzen, Collector-Zugriff, Erledigt-Nachweise und unabhängige Quellstatus. `scripts/preview.ts` bietet einen isolierten Testserver mit ausschließlich synthetischen Daten unter Port 3318. Dafür kann ein vorhandener TypeScript-Loader genutzt werden. Der Preview-Server verbindet sich mit keiner produktiven Quelle oder Paperclip-Datenbank.

Das Repository enthält Quellcode und synthetische Testdaten. Echte Aufgaben, E-Mails, Transkripte, Sessions und Zugangsdaten gehören ausschließlich in die laufende Instanz.
