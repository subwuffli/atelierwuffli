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

Die Browser-App erhaelt nie R2-Zugangsdaten. Die Edge Function erstellt nur
kurzlebige, auf genau eine PDF beschraenkte Upload- und Download-URLs.

5. Im Bucket unter **Settings → CORS Policy** diese Regel hinterlegen:

```json
[
  {
    "AllowedOrigins": ["https://subwuffli.github.io"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Die URLs laufen nach zwei Minuten ab. Der Browser kann damit weder andere
Dateipfade noch R2-Zugangsdaten sehen oder verwenden.
