-- Test: Bereits gespeicherte PDFs können anhand ihres Inhaltsstands wiederverwendet werden.
alter table public.file_attachments add column if not exists document_hash text;
create unique index if not exists file_attachments_generated_pdf_hash_key
  on public.file_attachments(entity_type,entity_id,document_hash)
  where source='generated_pdf' and deleted_at is null and document_hash is not null;
notify pgrst,'reload schema';
