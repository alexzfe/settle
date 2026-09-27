-- The Quick Guide's own lines gain a kind, so the app places them: avoid, test, or ask. A flat list
-- in saved order read as prose in bullets and couldn't be sectioned for a glance in the shop.
-- Stored lines were plain strings; a line beginning "Avoid" becomes an avoid and every other one a
-- test, in the order saved. The looking-for line heading the Quick Guide stays empty until a
-- Session writes one.
ALTER TABLE guides ADD COLUMN looking_for TEXT;

UPDATE guides
SET quick_lines = (
  SELECT json_group_array(
    json_object(
      'kind', CASE WHEN line.value LIKE 'Avoid%' THEN 'avoid' ELSE 'test' END,
      'text', line.value
    ) ORDER BY line.key
  )
  FROM json_each(guides.quick_lines) AS line
)
WHERE json_array_length(quick_lines) > 0;
