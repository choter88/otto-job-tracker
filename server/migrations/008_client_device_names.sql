-- Split the single `label` column on client_devices into two:
--   auto_label  — derived from the User-Agent string at every
--                 device_register WS message (e.g. "Mac · Chrome",
--                 "Windows · Edge"). The Host computes this; the
--                 Client doesn't get a say.
--   name        — user-set friendly name, NULL until an admin
--                 renames the device from Settings → Computers.
--                 When set, takes precedence over auto_label for
--                 display.
--
-- Migration approach: rename the existing column rather than drop +
-- add, so we keep all existing rows and their original UA strings as
-- auto_labels (which will be overwritten with the parsed friendly
-- form the next time the Client connects and re-fires device_register).

ALTER TABLE client_devices RENAME COLUMN label TO auto_label;
ALTER TABLE client_devices ADD COLUMN name TEXT;
