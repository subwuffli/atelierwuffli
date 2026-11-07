# Projektstand – Atelier Wuffli ERP

Stand: 7. November 2026
Live-Version: `V0.0.132.0` · Test-Version: `TEST V0.0.132.0`

## Betrieb und Architektur

- **Live-App:** https://subwuffli.github.io/atelierwuffli/
- **Test-App:** https://subwuffli.github.io/atelierwuffli/test/
- **Frontend:** statische Browser-App auf GitHub Pages.
- **Daten:** getrennte Supabase-Projekte für Test und Live, mit Row-Level-Security, Mitglieder-Allowlist, Audit-Log und Bearbeitungssperren.
- **Dateien:** PDFs und Inventarfotos liegen getrennt je Umgebung im Cloudflare-R2-Speicher. Supabase Edge Function `file-storage` vermittelt den Zugriff.
- **Backups:** vollständiges Live-Backup vom 6. November 2026 unter `backups/live-20261106-175624/` (Git-Historie, SQL-Schema, Daten und R2-Dateien).

## Umgesetzte Bereiche

- Kunden, Lieferadressen, Termine und Aufträge
- Rechnungen, Quittungen und Schweizer QR-Rechnungen
- PDF-Erzeugung, Speicherung, Wiederherstellung fehlender Dateien und mobile Vorschau/Teilen
- Einnahmen, Ausgaben, Kassen- und Bankbuch sowie Jahres- und Monatsauswertung
- Statistik, Suche, Papierkorb, Archivierung abgeschlossener Aufträge und Inventar
- Inventar mit Bestandsbewegungen, Mindestbestand, Archivierung und Fotos
- Persönliches Erscheinungsbild, barriereärmere Bedienung und mobile Navigation
- Upload-Schutz mit maximal 20 Dateien je Benutzer und voller Stunde

## Verbindlicher Release-Ablauf

1. Neue Funktionen ausschliesslich unter `test/` entwickeln und in der Testumgebung prüfen.
2. Vor einem Live-Release läuft `tools/release-check.ps1 -Strict`.
3. Erst nach ausdrücklichem `#live` beziehungsweise „Live deployen“ wird `tools/promote-test-to-live.ps1 -Apply` ausgeführt.
4. Der Befehl erzeugt das Live-Frontend aus dem Teststand, behält aber Live-Supabase, Live-CSP und die Live-Kennung bei.
5. Notwendige SQL-Migrationen und Edge-Function-Deployments werden kontrolliert für Live ausgeführt.
6. GitHub Actions prüft Syntax, Release-Vertrag, Promotionsweg und Inventar vor jeder Veröffentlichung. Ein fehlgeschlagener Check blockiert GitHub Pages.

Details zur Testumgebung stehen in `TESTUMGEBUNG.md`, der genaue Release-Ablauf in `RELEASE_WORKFLOW.md`. Die vollständige Historie liegt in Git.
