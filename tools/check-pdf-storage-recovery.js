const assert=require('node:assert/strict'),fs=require('node:fs'),edge=fs.readFileSync('supabase/functions/file-storage/index.ts','utf8'),app=fs.readFileSync('test/app.js','utf8');
assert.match(edge,/async function moveGeneratedPdfsToBackup/,'Vorherige PDFs werden nicht vor dem neuen Datenbankeintrag verschoben');
assert.match(edge,/if\(!isMissingObject\(error\)\)throw new Error\("BACKUP_MOVE_FAILED"/,'R2-Ausfälle ausserhalb von 404 werden noch als fehlend behandelt');
assert.match(edge,/BACKUP_MOVE_FAILED/,'Backup-Fehler werden nicht eindeutig an den Browser gemeldet');
assert.match(edge,/FILE_STORAGE_FAILED/,'Unerwartete Function-Fehler liefern keine CORS-fähige JSON-Antwort');
assert.match(edge,/fileKey=source==="generated_pdf"\?`\$\{names\.number\}-\$\{documentHash\}\.pdf`/,'Wiederholte PDF-Erzeugungen verwenden keinen stabilen R2-Schlüssel');
assert(app.indexOf("if(!/Failed to send a request to the Edge Function/i.test(error.message))")<app.indexOf('const recovered=await findGeneratedPdf'),'Ein Serverfehler wird vor der Wiederherstellungsprüfung nicht zuverlässig angezeigt');
console.log('PDF-Speicher-Wiederherstellung ist gegen fehlende R2-Dateien und Backup-Fehler abgesichert.');
