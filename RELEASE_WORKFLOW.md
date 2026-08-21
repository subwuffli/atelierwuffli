# Sicher nach Live veröffentlichen

1. Neue Funktion nur in `test/` entwickeln und dort testen.
2. Vor der Freigabe ausführen:

```powershell
.\tools\release-check.ps1 -Strict
```

3. Bei einem `STOP` keine Live-Veröffentlichung verlangen. Zuerst alle angezeigten Unterschiede und die passende Live-SQL-Migration klären.
4. Nach erfolgreichem Test klar schreiben: **„Live deployen“**. Dann wird vor dem Push erneut geprüft, die additive Live-Migration ausgeführt und danach die veröffentlichte Version kontrolliert.

## Was du mir jeweils sagen solltest

- **„In Test entwickeln“** für neue Funktionen.
- **„Test prüfen“**, nachdem du sie ausprobiert hast.
- **„Live deployen“** erst nach deiner Freigabe.
- Bei Datenbankänderungen: ob wir Testdaten anlegen dürfen oder nur vorhandene Daten prüfen sollen.

Ich übernehme dann die technischen Schritte. Echte Live-Daten werden weder für Tests gelöscht noch ersetzt.
