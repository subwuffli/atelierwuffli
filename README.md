# Atelier Wuffli ERP

Aktuelle Version: **V0.0.15**

Bei jeder veröffentlichten Änderung wird die letzte Versionsstelle um eins erhöht (`V0.0.2`, `V0.0.3`, …). Die Version wird in der Seitenleiste oberhalb von **Sperren** angezeigt.

Deutschsprachiges Mehrbenutzer-ERP für Kunden, Aufträge, Rechnungen und Quittungen. Die Anwendung wird über GitHub Pages ausgeliefert; Anmeldung und sämtliche Geschäftsdaten liegen in Supabase.

Bezahlte Rechnungen können als nummerierte Quittung (`QU-JJ-MM-TT-XXX`) ausgegeben werden. Quittungen stehen als PDF und Druckansicht zur Verfügung.
Erstellte Quittungen werden im eigenen Navigationsbereich **Quittungen** gesammelt. Offene Rechnungen werden nach Überschreiten des Fälligkeitsdatums rot als **Überfällig** hervorgehoben.
Die Rechnungsfälligkeit wird aus dem Abhol-/Lieferdatum plus Zahlungsfrist berechnet und bei einer Änderung des Auftrags automatisch aktualisiert.
Bereits erstellte Quittungen werden bei späteren Änderungen an Rechnung oder Auftrag automatisch inhaltlich aktualisiert; Quittungsnummer und Datum bleiben erhalten.

## Supabase einmalig einrichten

1. Im Supabase-Dashboard den **SQL Editor** öffnen.
2. Den vollständigen Inhalt von `supabase/migration.sql` ausführen.
3. Unter **Authentication → Users** alle gewünschten ERP-Benutzer anlegen.
4. Selbstregistrierung deaktiviert lassen, wenn Benutzer nur durch den Administrator angelegt werden sollen.
5. Danach die GitHub-Pages-Anwendung neu laden und anmelden.

Bei einem bestehenden Datenbestand für V0.0.12 einmalig `supabase/hotfix-quittungen.sql` im SQL Editor ausführen.

Falls bereits Daten in der früheren Tabelle `erp_data` liegen, übernimmt die Migration sie beim ersten Lauf automatisch in die neuen Tabellen. Die alte Tabelle wird vorsichtshalber nicht gelöscht.

Das Schema ist relational aufgebaut. Kunden, Lieferadressen, Aufträge, Positionen, Rechnungen und Zähler besitzen jeweils eigene Tabellen und können später durch Spalten oder zusätzliche Tabellen erweitert werden.

## Datensicherung

- **Exportieren** lädt den vollständigen Supabase-Datenbestand als JSON-Datei herunter.
- **Importieren** ersetzt nach einer deutlichen Bestätigung den gesamten Datenbestand transaktional.
- Der Import unterstützt alte Backups der Version 1 sowie neue Backups der Version 2.
- Dokumentnummern werden atomar in Supabase vergeben, damit mehrere Benutzer keine doppelten Nummern erzeugen.
- Eine Revisionsprüfung verhindert, dass ein Benutzer unbemerkt Änderungen eines anderen überschreibt.
- Supabase Realtime meldet Änderungen anderer Geräte; die Anwendung lädt sie automatisch nach, solange kein Formular geöffnet ist.
- Kunden können nach Kundennummer oder Name auf- und absteigend sortiert werden.
- Derselbe Kunde, Auftrag oder dieselbe Rechnung kann nicht gleichzeitig auf zwei Geräten bearbeitet werden. Die Sperre wird beim Schließen freigegeben und läuft bei Verbindungsabbrüchen automatisch aus.
- Typische fehlerhafte UTF-8-Umlaute aus alten Backups werden beim Laden und Import automatisch repariert.

## Sicherheit

- Nur bei Supabase angemeldete Benutzer erhalten über Row Level Security Zugriff.
- Alle angelegten Benutzer teilen denselben ERP-Datenbestand.
- Die Supabase-Publishable-Key im Browser ist öffentlich und wird durch Authentifizierung und RLS abgesichert.
- Passwörter und Service-Role-Keys dürfen niemals im Repository gespeichert werden.

## Veröffentlichung

Pushes auf `main` werden über `.github/workflows/pages.yml` automatisch auf GitHub Pages veröffentlicht.
