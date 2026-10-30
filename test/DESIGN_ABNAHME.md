# Design-Abnahme · TEST V0.0.128.0

Alle Prüfungen ausschliesslich in der Testumgebung durchführen.

1. **Kontrast:** Marineblau/Dunkel wählen. Auftrag öffnen und zurückgehen. Die markierte Zeile bleibt vollständig lesbar. Mit den anderen Farbdesigns wiederholen.
2. **Formularschutz:** Kunde erfassen, Vorname ändern, Escape drücken. „Weiter bearbeiten“ erhält die Eingabe. × oder Abbrechen und danach „Änderungen verwerfen“ schliesst. Ohne Eingaben schliesst das Formular direkt.
3. **Rückkehr:** Startseite → Auftrag → Zurück führt zur gleichen Startseitenkarte. „In Arbeit“ → sortieren/scrollen → Auftrag → Zurück erhält Filter, Sortierung, Position und Fokus. Auftrag → Rechnung → Zurück führt erst zum Auftrag.
4. **Mobiles Menü:** Mit Tab und Enter öffnen. Der Fokus bleibt im Menü. Escape schliesst es und setzt den Fokus auf „Menü“ zurück. Alle 13 Ziele bleiben über die vier Gruppen erreichbar.
5. **Zugängliche Rückmeldung:** Screenreader benennt „Kunde erfassen“. Erfolgsmeldungen werden als Status angekündigt. „Rückgängig“ bleibt auch nach zehn Sekunden erreichbar; Meldungen lassen sich ausdrücklich schliessen.
6. **Bewegung:** Geräteeinstellung „Bewegung reduzieren“ aktivieren. Allgemeine Ladeindikatoren und PDF-Schritte bleiben verständlich, ohne fortlaufende Drehung. Mit deaktivierter Einstellung erscheinen die vorgesehenen dezenten Bewegungen wieder.
7. **Navigation:** Gruppen Atelier, Finanzen, Organisation und Verwaltung prüfen. Datenexport befindet sich unter Einstellungen → Datensicherung. Kleine Breite sowie 200 % Textvergrösserung prüfen.

Automatisiert geprüft: isolierter Edge-Browser, 320/390/768/1440 Pixel, 40 Kontrastkombinationen, Ursprung/Filter/Sortierung/Scrollposition/Fokus, verknüpfte Dokumente, Formularabbruch und erfolgreiche Speicherung, laufende Speicherung, Menütastaturbedienung, Statusauszeichnung, länger verfügbare Rückgängig-Aktion, reduzierte Bewegung und persönliche Farbwahl.

Echte VoiceOver-/Safari- und iPhone-Prüfung sowie ein angemeldeter Testbenutzer bleiben manuelle Abnahmeschritte. Automatische Tests verwenden lokale Beispieldaten und kontaktieren keine ERP-Datenbank.
