-- Löscht ausschließlich temporäre Bearbeitungssperren.
-- Kunden, Aufträge und Rechnungen bleiben unverändert.
delete from public.edit_locks where true;
