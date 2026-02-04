-- Production Migration Step 6: Import Comments, History, and Notification Rules
-- Instructions: Copy and paste this entire script into the Production SQL Playground and click Run

-- Import Job Comments (filtered to active jobs only)
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('01a435d0-96a6-4e2d-8dcb-8bf970d5728b', '700a1c32-aaaf-49fc-b6b3-a8a21623a38c', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'AWAITING FRAME!', '2025-10-08 21:35:12.607419+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('18929d27-e116-452b-bed1-02204ac24781', 'd36ea168-5982-45cf-b3ae-72aad2120756', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'OD RECEIVED - OS B/O AS OF 10/1', '2025-10-01 21:56:34.933793+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('349ce20e-7ddc-46b3-a977-00db6bfecdb4', '88970ce2-9745-4db5-8963-0c2e68865428', '0a30693a-baed-4c99-bb81-4d11d2c43dd9', 'REDO #2 to Bifocal from PAL', '2025-10-17 00:45:00.61953+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('37130953-875e-41bb-90e5-3894ef0793e3', 'e69d1d5e-00a2-4459-a047-7782157cdb49', '0a30693a-baed-4c99-bb81-4d11d2c43dd9', 'REDO under scratch warranty', '2025-10-16 22:51:13.090992+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('73105788-1468-4c1f-bfbc-e22c3deeae8d', '551f9fce-620b-4f05-9221-2607aba3ceea', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'received OD, OS backordered', '2025-10-09 23:21:15.001808+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('7604cd41-0984-44dc-8b14-92f925602029', '0dae6150-9bcc-442a-826f-6a4d67960030', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'ALLEN HAS ONE LENS ON B/O OCT.6TH', '2025-10-03 22:18:42.584891+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('794720c8-f7a4-4c1e-8a34-616e1dd48b78', 'ff394d74-4d70-42b3-aa7f-2d905461c498', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'RE-SUBMITTED 10/01', '2025-10-02 17:11:17.382543+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('7b560c27-27d0-43a0-98aa-7ab9128ad704', '7574d486-c22c-4a97-a27e-7fc4c9857ca4', '1bd2e7fc-cd53-412d-aa16-9f79d17dc0a8', 'Order is ready but pt is out of town', '2025-09-11 22:28:21.564871+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('8bae9987-e342-437b-a9b8-14c1c801c344', '7574d486-c22c-4a97-a27e-7fc4c9857ca4', '1bd2e7fc-cd53-412d-aa16-9f79d17dc0a8', 'Lens was delayed. Notified pt', '2025-09-11 22:27:55.269645+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('ae36e7a4-cf5f-4154-a0d9-83f69b517c4e', '0dae6150-9bcc-442a-826f-6a4d67960030', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'NEW B/O OCT. 17TH FOR OD LENS', '2025-10-10 18:16:51.237977+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('aeb3b3aa-f34f-4b1a-97b3-9be33b98ea2b', '0dae6150-9bcc-442a-826f-6a4d67960030', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'LENS ON B/O 10/6', '2025-10-07 18:38:17.71374+00');
INSERT INTO job_comments (id, job_id, author_id, content, created_at) VALUES ('c50c7655-8d30-4e1f-ab68-05910427b902', 'b86e722c-1594-4ed9-972e-ff16ba8e950c', 'a1446249-284a-49cc-b254-9dc5bbe75a1a', 'picked up all boxes except one (was backordered)', '2025-09-25 20:30:19.144619+00');

-- Import Notification Rules
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('538b3aa8-0a11-4c7c-89bc-5699a8bcd9b3', 'd10015ce-316c-41f0-9661-42b5b65911ba', 'ordered', 3, true, false, '[]'::jsonb, '[]'::jsonb, '2025-08-28 04:43:41.324127+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('597c1480-1d64-48d2-a23c-f873d46928ed', 'a20d81c8-bde9-4ff0-bbfb-86171cd2f382', 'ready_for_pickup', 7, true, false, '[]'::jsonb, '[]'::jsonb, '2025-10-01 18:16:46.464146+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('79f073ed-407d-44b3-a24d-9993830288e0', 'd10015ce-316c-41f0-9661-42b5b65911ba', 'ready_for_pickup', 5, true, false, '[]'::jsonb, '[]'::jsonb, '2025-08-28 22:39:19.261512+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('9466baae-ece0-411a-8483-086ecb71a016', 'a20d81c8-bde9-4ff0-bbfb-86171cd2f382', 'ordered', 7, true, false, '[]'::jsonb, '[]'::jsonb, '2025-10-01 18:16:22.801607+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('a250c911-1c74-43ed-8994-03dce3a24124', 'd10015ce-316c-41f0-9661-42b5b65911ba', 'quality_check', 3, true, false, '[]'::jsonb, '[]'::jsonb, '2025-09-26 02:48:38.252325+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('ca2f0cee-61a0-4449-95e5-50173963d258', 'a20d81c8-bde9-4ff0-bbfb-86171cd2f382', 'status_1758832364028', 7, true, false, '[]'::jsonb, '[]'::jsonb, '2025-10-01 18:16:38.39235+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('dbb61582-1f9e-41d5-9e98-e9bb8787c830', 'a20d81c8-bde9-4ff0-bbfb-86171cd2f382', 'job_created', 3, true, false, '[]'::jsonb, '[]'::jsonb, '2025-10-01 18:15:45.312616+00');
INSERT INTO notification_rules (id, office_id, status, max_days, enabled, sms_enabled, notify_roles, notify_users, created_at) VALUES ('e8624958-ce6f-4b3b-af0b-32a2bf48d724', 'd10015ce-316c-41f0-9661-42b5b65911ba', 'job_created', 2, true, false, '[]'::jsonb, '[]'::jsonb, '2025-09-26 02:48:30.042787+00');

-- Verification: Check all counts
SELECT 
  (SELECT COUNT(*) FROM job_comments) AS comments_count,
  (SELECT COUNT(*) FROM notification_rules) AS notification_rules_count;

-- NOTE: Job status history has too many records (165+) to include in this migration file.
-- If you need to import job status history, you can extract it separately from migration_import.sql
-- by running lines 158-322 of that file in the Production SQL Playground.
