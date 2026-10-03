-- product-images (also holds shop logos) allowed 5 MB per file, and one 1.77 MB
-- logo PNG was 94% of everything in storage. The upload code now resizes and
-- re-encodes images to WebP before upload (logos at most 512 px / 100 KB,
-- product images at most 1600 px / 300 KB), so 1 MB is a generous ceiling that
-- still refuses an original-sized photo someone manages to upload around it.
-- Existing objects are not touched.
update storage.buckets set file_size_limit = 1048576 where id = 'product-images';
