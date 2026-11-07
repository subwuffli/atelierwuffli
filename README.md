# Atelier Wuffli ERP

Deutschsprachiges ERP für Kunden, Termine, Aufträge, Rechnungen, Quittungen, Buchhaltung und Inventar.

## Aktueller Betrieb

- **Live:** https://subwuffli.github.io/atelierwuffli/
- **Test:** https://subwuffli.github.io/atelierwuffli/test/
- **Daten:** getrennte Supabase-Projekte mit Benutzeranmeldung und Row-Level-Security.
- **Dateien:** PDFs und Inventarfotos werden über die Supabase Edge Function `file-storage` im je Umgebung getrennten Cloudflare-R2-Speicher abgelegt.

Die App wird als statische Seite über GitHub Pages veröffentlicht. Der Publishable Key im Browser ist absichtlich öffentlich; Secret- und Service-Role-Schlüssel gehören niemals ins Repository.

## Entwicklung und Veröffentlichung

1. Neue Funktionen nur unter `test/` entwickeln und in der Testumgebung prüfen.
2. Vor dem Live-Release `powershell -ExecutionPolicy Bypass -File tools\release-check.ps1 -Strict` ausführen.
3. Erst nach ausdrücklicher Freigabe das Frontend mit `powershell -ExecutionPolicy Bypass -File tools\promote-test-to-live.ps1 -Apply` erzeugen.
4. Zugehörige SQL-Migrationen und Edge-Function-Deployments zuerst in Test, nach erfolgreicher Prüfung in Live ausführen.
5. GitHub Actions prüft den Release vor dem GitHub-Pages-Deployment automatisch.

Die detaillierten Anweisungen stehen in [TESTUMGEBUNG.md](TESTUMGEBUNG.md) und [RELEASE_WORKFLOW.md](RELEASE_WORKFLOW.md). Der aktuelle technische Stand steht in [PROJEKTSTAND.md](PROJEKTSTAND.md).

## Lokale Prüfungen

```powershell
powershell -ExecutionPolicy Bypass -File tools\release-check.ps1 -Strict
powershell -ExecutionPolicy Bypass -File tools\promote-test-to-live.ps1 -VerifyOnly
node tools\check-file-storage-security.js
```

Die vollständige Liste der schnellen Prüfungen ist in `.github/workflows/pages.yml` hinterlegt und läuft vor jeder Veröffentlichung.
