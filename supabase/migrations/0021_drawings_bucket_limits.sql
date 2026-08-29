-- Bound what the drawings bucket will accept.
--
-- 0009 created it private, and 0009/0010 gave it an admin-only write policy and
-- a member-only read policy, so this is not the boundary that keeps strangers
-- out -- that one already holds. What was missing is a bound on what an admin,
-- or code running inside an admin's tab, can put into it: the bucket took a
-- file of any size and any type, and `contentType: 'image/png'` in
-- decksApi.uploadDrawing is a claim the client makes about itself, not
-- something the server ever checked.
--
-- image/png only, because that is genuinely all this product stores. The PDF
-- the admin picks is rasterised in the browser (lib/pdfToPng.ts) and it is the
-- PNG that is uploaded; nothing else has ever been written here.
--
-- 25 MB, from the real files: a rendered A1 sheet at 2400px is a few MB, so
-- this is several times the largest thing the app produces and still far below
-- what would matter as a bill or as a denial-of-service. A limit nobody
-- legitimate can reach is a limit nobody argues with.
update storage.buckets
set
  allowed_mime_types = array['image/png'],
  file_size_limit = 25 * 1024 * 1024
where id = 'drawings';

-- The bucket is created by 0009, so a missing row here means 0009 did not run
-- or was edited -- which would leave the limits silently unapplied on the very
-- database this migration exists to bound.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'drawings'
      and allowed_mime_types = array['image/png']
      and file_size_limit = 25 * 1024 * 1024
  ) then
    raise exception 'drawings bucket is missing or did not take the limits';
  end if;
end $$;
