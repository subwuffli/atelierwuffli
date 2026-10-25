# Cloudflare R2 – Testablage

1. In Cloudflare **R2 Object Storage** aktivieren und den privaten Bucket
   `atelier-wuffli-files-test` erstellen.
2. Eine R2 API-Zugangsgruppe nur fuer diesen Bucket erstellen: Lesen, Schreiben,
   Auflisten und Loeschen. Loeschen braucht die bestehende Sicherungs- und
   Fehlerbereinigung der Edge Function.
3. Die Werte `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` und
   `R2_BUCKET=atelier-wuffli-files-test` anschliessend ausschliesslich als
   Secrets der Supabase Edge Function hinterlegen.
4. Den SQL-Inhalt aus `supabase/test-file-attachments-v0057.sql` im
   Test-Supabase-SQL-Editor ausfuehren.

Die Browser-App erhaelt nie R2-Zugangsdaten und kommuniziert auch nicht direkt
mit R2. Lesen und Schreiben laufen ausschliesslich durch die Supabase Edge
Function. Dadurch ist keine Bucket-CORS-Regel fuer die ERP-App erforderlich.
Falls ein anderes System direkt auf den Bucket zugreifen soll, braucht dieses
eine eigene, so eng wie moeglich begrenzte CORS-Regel.
