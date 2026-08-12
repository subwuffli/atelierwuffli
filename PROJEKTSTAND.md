# Projektstand – Atelier Wuffli ERP

Stand: 12. August 2026

Aktuelle App-Version: `V0.0.10`. Ab jetzt wird bei jeder veröffentlichten Änderung die letzte Zahl um eins erhöht.

> Architekturänderung: Supabase ist nun die einzige Datenquelle. Die früher dokumentierte lokale IndexedDB-Speicherung ist nicht mehr aktuell.

Ergänzt am 12. August 2026: automatische Geräteaktualisierung über Supabase Realtime sowie Kundensortierung nach Nummer oder Name.

Ergänzt: geräteübergreifende Bearbeitungssperre pro Kunde und automatische Reparatur früherer Import-Kodierungsfehler bei deutschen Umlauten.

V0.0.4: Bearbeitungssperre zusätzlich für bestehende Aufträge und Rechnungen aktiviert.

V0.0.5: Schaltfläche **Neu laden** in der Seitenleiste lädt den aktuellen Supabase-Datenstand ohne Abmeldung.

V0.0.6: **Neu laden** aktualisiert die gesamte Browserseite und gibt vorher eine aktive Bearbeitungssperre frei.

V0.0.7: Auftragsänderungen aktualisieren verknüpfte Rechnungen; Lieferadressen lassen sich direkt im Auftrag ergänzen; installierte mobile Web-Apps verwenden eine interne Druckansicht mit Rückkehr zur App.

V0.0.8: Sortieroptionen für alle sichtbaren Auftrags- und Rechnungsfelder außer Betrag ergänzt.

V0.0.9: PDF und Drucken getrennt. PDF öffnet am PC einen Browser-Tab und wird in der installierten mobilen Web-App heruntergeladen.

V0.0.10: In der installierten mobilen Web-App wird nur die PDF-Funktion angeboten; Drucken bleibt im normalen Browser und am PC verfügbar.

## Veröffentlichung

- Repository: https://github.com/subwuffli/atelierwuffli
- Live-Webseite: https://subwuffli.github.io/atelierwuffli/
- Branch: `main`
- Hosting: kostenlos über GitHub Pages
- Deployment: automatisch über `.github/workflows/pages.yml`
- Git-Identität: `subwuffli <46577010+subwuffli@users.noreply.github.com>`

## Verbindliche Anforderungen und Entscheidungen

- Deutsche, responsive Browser-App
- Daten bleiben lokal im Browser (IndexedDB)
- Kein Server und keine Cloud-Datenbank
- Lokaler Passwortschutz für die Bedienoberfläche
- Browserdaten sind nicht verschlüsselt
- Bei vergessenem Passwort ist ein vollständiger Reset möglich; nicht exportierte Daten gehen verloren
- Unverschlüsselter JSON-Export aller Daten
- Import ersetzt alle vorhandenen Geschäftsdaten
- Währung: CHF
- Keine Mehrwertsteuer; nur Endbetrag
- Zahlungsfrist: 30 Tage
- Rechnungsreferenz: Rechnungsnummer
- Kunden werden archiviert, nicht endgültig gelöscht
- Aufträge und Rechnungen können nach Abschluss archiviert werden

## Kunden

- Kundennummer
- Firma, Anrede, Vorname, Nachname
- E-Mail und Telefon
- Rechnungsadresse
- Mehrere Lieferadressen
- Interne Notiz
- Aktiv/archiviert

## Aufträge

- Nummer: `AF-JJ-MM-DD-XXX`
- Täglicher Zähler ab `001`
- Status: `In Arbeit` oder `Abgeschlossen`
- Erfüllungsart: `Abholung` oder `Lieferung`
- Abhol- beziehungsweise Lieferdatum
- Bei Lieferung Auswahl einer hinterlegten Lieferadresse
- Positionen mit Beschreibung, Menge und CHF-Einzelpreis
- Automatisch berechneter Gesamtbetrag
- Bearbeitbar und als PDF/Druckansicht ausgebbar
- Aus einem Auftrag kann eine Rechnung erstellt werden

## Rechnungen

- Nummer: `RE-JJ-MM-DD-XXX`
- Täglicher Zähler ab `001`
- Nummer bleibt bei späteren Änderungen erhalten
- Status: `Offen`, `Bezahlt` oder `Storniert`
- Zahlungsfrist und Fälligkeitsdatum
- IBAN und Rechnungsnummer als Referenz
- Bearbeitbar und als PDF/Druckansicht ausgebbar

## Firmeneinstellungen und Gestaltung

- Name/Firma, Adresse und IBAN
- Standardtexte für Auftrag und Rechnung
- Standard-Zahlungsfrist
- Vollständiges Atelier-Wuffli-Logo inklusive Schriftzug
- Logo-Datei: `assets/atelier-wuffli-logo.jpeg`
- Eigenes Logo kann in den Einstellungen hochgeladen werden

## Wichtige Hinweise

- Daten werden pro Browser und Gerät gespeichert und nicht automatisch synchronisiert.
- Vor einem Gerätewechsel muss eine JSON-Sicherung exportiert werden.
- Auf dem neuen Gerät wird diese Sicherung über den ersetzenden Import geladen.
- Das Passwort gehört zum jeweiligen Browser und wird beim Import nicht ersetzt.
- Die Web-App ist unter der Live-Adresse auf Mobilgeräten nutzbar und kann zum Startbildschirm hinzugefügt werden.

## Technische Dateien

- `index.html`: Grundstruktur
- `styles.css`: Layout und responsive Gestaltung
- `app.js`: IndexedDB, Passwort, Kunden, Aufträge, Rechnungen, PDFs, Export/Import
- `.github/workflows/pages.yml`: GitHub-Pages-Deployment
- `.nojekyll`: direkte statische Veröffentlichung
- `README.md`: Kurzbeschreibung und Bedienhinweise

## Prüfstand

- JavaScript-Syntaxprüfung erfolgreich
- GitHub Pages antwortet unter der Live-Adresse mit HTTP 200
- Ein automatischer visueller Browser-Test war in der lokalen Codex-Umgebung wegen einer Berechtigungssperre nicht möglich

## Sinnvolle nächste Schritte

1. Oberfläche auf einem echten Handy vollständig durchtesten.
2. Testkunden, Auftrag und Rechnung anlegen.
3. PDF-Layout anhand eines realen Beispiels prüfen und verfeinern.
4. Export und Import zwischen zwei Browsern testen.
5. Bedienkomfort, Suchfunktion und Validierungen nach Nutzerfeedback verbessern.
