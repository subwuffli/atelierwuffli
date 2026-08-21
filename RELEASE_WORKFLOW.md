# Sicher nach Live veröffentlichen

1. Neue Funktion nur in `test/` entwickeln und dort testen.
2. Vor der Freigabe ausführen:

```powershell
.\tools\release-check.ps1 -Strict
```

3. Bei einem `STOP` keine Live-Veröffentlichung verlangen. Zuerst das fehlende Merkmal oder die passende Live-SQL-Migration klären. Hinweise zu Test-Banner, URLs und Versionsnummern sind erwartete Umgebungsunterschiede.
4. Nach erfolgreichem Test klar schreiben: **„Live deployen“**. Dann wird vor dem Push erneut geprüft, die additive Live-Migration ausgeführt und danach die veröffentlichte Version kontrolliert.

## Was du mir jeweils sagen solltest

- **„In Test entwickeln“** für neue Funktionen.
- **„Test prüfen“**, nachdem du sie ausprobiert hast.
- **„Live deployen“** erst nach deiner Freigabe.
- Bei Datenbankänderungen: ob wir Testdaten anlegen dürfen oder nur vorhandene Daten prüfen sollen.

Ich übernehme dann die technischen Schritte. Echte Live-Daten werden weder für Tests gelöscht noch ersetzt.

Bei jeder neuen Funktion ergänze ich zusätzlich den Release-Vertrag unter `tools/release-contract.json`. Dadurch prüft der Release-Check, dass die Funktion samt nötiger Migration auch in Live vorhanden ist.
