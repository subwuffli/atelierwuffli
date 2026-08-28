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

`TEST V0.0.43.0` macht die vier Kennzahlenkarten auf der Übersicht direkt bedienbar. Kunden und Aufträge führen in ihren jeweiligen Bereich; offene Rechnungen und offener Betrag öffnen die Rechnungsübersicht. Die Karten sind auch per Tastatur erreichbar.

`TEST V0.0.44.0` stellt Datensatzaktionen auf Smartphones platzsparend dar. Die verfügbaren Aktionen eines Kunden, Termins, Auftrags, einer Rechnung, Quittung oder Ausgabe erscheinen erst nach Auswahl der betreffenden Karte; gleichzeitig bleibt höchstens ein Aktionsbereich geöffnet. Desktoplisten bleiben unverändert.

`TEST V0.0.45.0` verschiebt die Bedienleiste der mobilen PDF-Vorschau an den unteren Bildschirmrand. Dateiname sowie die mindestens 48 px hohen Schaltflächen zum Schließen und Teilen beziehungsweise Herunterladen bleiben dadurch auch mit mobilen Browserleisten und iPhone-Sicherheitsabstand erreichbar.

`TEST V0.0.45.1` erkennt die mobile PDF-Vorschau zusätzlich anhand der Bildschirmbreite und damit zuverlässig auch auf Geräten, die ihre Touch-Eigenschaften nicht korrekt melden.

`TEST V0.0.46.0` ergänzt zusammenhängende Detailansichten für Aufträge, Rechnungen und Quittungen. Die Auswahl eines Datensatzes zeigt Kunden-, Adress-, Termin-, Zahlungs-, Text- und Positionsdaten sowie alle passenden Bearbeitungs- und PDF-Aktionen. Verknüpfte Dokumente können direkt gewechselt werden; „Zurück“ führt in den zuvor geöffneten Abschnitt.

`TEST V0.0.47.0` ermittelt die zu einem Auftrag gehörende Rechnung und Quittung zuverlässig über beide Datenbankverknüpfungen. Die Detailansicht besitzt nun eine eigene Navigation: Von einem Auftrag zur Rechnung oder Quittung gewechselt führt „Zum vorherigen Dokument“ zuerst zurück zur vorherigen Detailansicht und erst danach zurück zur ursprünglichen Liste.

`TEST V0.0.48.0` integriert Rechnung und Zahlung direkt in die Auftragsdetailansicht. Rechnungsdatum, Fälligkeit, Status, Zahlungsdatum, Zahlungsart und Rechnungstext können ohne Bereichswechsel bearbeitet werden. Eine Quittung kann beim Abschluss direkt erstellt werden; vorhandene Quittungen werden automatisch aktualisiert. Die Datenbanksperre bleibt dabei auf der Rechnung aktiv.

`TEST V0.0.49.0` korrigiert mobile Größenprobleme bei langen Formularen. Dialoghöhe, Scrollbereich, Kopfzeile und sichere Aktionsleiste verwenden dynamische iPhone-Viewport-Höhen und Safe-Area-Abstände; Eingabefelder verhindern unerwünschtes Browser-Zoomen. Lange Kennzahlen bleiben innerhalb ihrer Karten.

`TEST V0.0.75.0` ergänzt die getrennte Hausnummer in den Rechnungsinformationen. Sie wird für Schweizer QR-Rechnungen als strukturiertes Adressfeld gespeichert.

`TEST V0.0.76.0` erzeugt für Rechnungen einen Schweizer QR-Zahlteil direkt im Browser. Bestehende Rechnungen mit noch leeren QR-Daten werden beim Speichern vollständiger Rechnungsinformationen nachgepflegt. Ohne Firma oder Name, Strasse, Hausnummer, PLZ/Ort und gültige CH- oder LI-IBAN wird kein unvollständiges Rechnungs-PDF gespeichert.

`TEST V0.0.77.0` korrigiert die IBAN-Prüfung für Schweizer und Liechtensteiner IBANs. Gültige CH-/LI-IBANs werden nun korrekt als Grundlage für den QR-Zahlteil akzeptiert.
