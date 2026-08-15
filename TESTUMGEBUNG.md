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

## Aktueller Teststand

`TEST V0.0.37.0` speichert Kunden, Aufträge, Rechnungen, Quittungen, Ausgaben und Einstellungen datensatzweise. Auftrag samt Positionen sowie Rechnung samt Positionen und Quittung werden jeweils in einer Datenbanktransaktion gespeichert. Gleichzeitige Änderungen werden über Sperren und den Zeitstempel `updated_at` erkannt, statt fremde Änderungen zu überschreiben.

Die zugehörige Testmigration liegt unter `supabase/test-record-storage-v0037.sql` und ist ausschliesslich im Supabase-Testprojekt installiert.

`TEST V0.0.38.0` ergänzt sichere Löschungen ohne physisches Entfernen. Gelöschte Datensätze werden aus Listen, Auswertungen und PDF-Berichten ausgeschlossen und können unmittelbar über „Rückgängig“ wiederhergestellt werden. Ein unveränderbares Audit-Log protokolliert Änderungen mit Zeitpunkt, Benutzer sowie altem und neuem Datenstand. Die Migration liegt unter `supabase/test-soft-delete-audit-v0038.sql`.

`TEST V0.0.39.0` ergänzt eine globale Suche über Kunden, Belegnummern, Referenzen, Artikel, Beträge und Ausgaben. Auf Smartphones steht eine Navigation mit fünf Zielen, einer zentralen Schnellaktion und mindestens 48 px grossen Touch-Zielen zur Verfügung; weitere Bereiche öffnen sich über „Mehr“.

`TEST V0.0.40.0` führt eine Mitglieder-Allowlist und strengere Row-Level-Security ein. Nur ausdrücklich freigegebene ERP-Mitglieder sehen Geschäftsdaten. Physisches Löschen der Hauptdatensätze ist für Browserbenutzer auf Datenbankebene gesperrt. Der Sicherheitsstatus zeigt Rolle, Mandant, Audit-Schutz und MFA-Stand. Die Migration liegt unter `supabase/test-security-baseline-v0040.sql`.

`TEST V0.0.41.0` ergänzt interne Datenbank-Snapshots, einen strukturellen Wiederherstellungstest, Betriebsstatus sowie zentrale JavaScript-Fehlerprotokolle mit Rate-Limit. Der erste Snapshot wurde erfolgreich als `valid` geprüft. Die Migration liegt unter `supabase/test-operations-v0041.sql`.

`TEST V0.0.42.0` ergänzt einen dauerhaften Papierkorb für gelöschte Kunden, Aufträge, Rechnungen, Quittungen und Ausgaben. Einträge können in sicherer Abhängigkeitsreihenfolge wiederhergestellt werden. Auf Smartphones lässt sich der vollständige Funktionsbaum wieder über die Menüschaltfläche ein- und ausblenden. Die Migration liegt unter `supabase/test-trash-v0042.sql`.
