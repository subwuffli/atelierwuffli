# ERP-Testumgebung

Die Testumgebung wird unter `/test/` derselben GitHub-Pages-Site veröffentlicht. Sie verwendet ausschliesslich das Supabase-Projekt `atelierwuffli-erp-test` (`xiqbveuuhngeosqetfuo`).

## Trennung

- Live-App: Dateien im Projektstamm, Supabase-Projekt `atelierwuffli-erp`
- Test-App: Dateien unter `test/`, Supabase-Projekt `atelierwuffli-erp-test`
- Testdaten und Testbenutzer gelangen nicht in die Live-Datenbank.
- Die Test-App trägt oben dauerhaft den roten Hinweis `TESTUMGEBUNG – KEINE ECHTEN DATEN`.

## Arbeitsablauf

1. Neue Funktionen zuerst unter `test/` umsetzen und veröffentlichen.
2. Mit Testbenutzern und Testdaten prüfen.
3. Nach Freigabe die getesteten Änderungen kontrolliert in die Live-Dateien übernehmen.
4. Datenbankmigrationen zuerst im Testprojekt und erst nach erfolgreichem Test im Live-Projekt ausführen.

Die Publishable Keys der Browser-Apps dürfen öffentlich sein. Secret- und Service-Role-Schlüssel dürfen niemals im Repository gespeichert werden.
