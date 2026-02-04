-- Step 2: Import Users (5 records)
-- Copy and paste this into Production SQL Playground and click "Run"

-- NOTE: Passwords are set as follows:
-- - dr.michelle@hello-optometry.com → password: hello2020
-- - contact@hello-optometry.com → password: hello2020
-- - All other users → password: TempPass123! (temporary, should reset)

INSERT INTO users (id, email, password, role, first_name, last_name, office_id, created_at, updated_at) VALUES ('0a30693a-baed-4c99-bb81-4d11d2c43dd9', 'dr.michelle@hello-optometry.com', '9a22c1cacb4a48e482d068535ecbe1ad50aa0e91d451d9df5023e41ef2b578c285bf23f504d88b1e89dfd4e087bbbaa0eb0b716efc89a281316971924b77bd3e.3e96368bef9d97d75b84282788600314', 'owner', 'michelle', 'cho', 'a20d81c8-bde9-4ff0-bbfb-86171cd2f382', '2025-09-03 23:30:18.705321+00', '2025-09-03 23:31:24.088557+00');

INSERT INTO users (id, email, password, role, first_name, last_name, office_id, created_at, updated_at) VALUES ('1bd2e7fc-cd53-412d-aa16-9f79d17dc0a8', 'chopeter67@gmail.com', '689d290e41d29a7d10245431f107e93bb5ab4d8848b431ce79335294b050bf0b3f8f636b4bb09119e24bbaa6bd3ff72cc2884fa9ff3b257978befa05ec67880e.bcaecd7cbdb86297f26cdd368af6209d', 'owner', 'peter', 'cho', 'd10015ce-316c-41f0-9661-42b5b65911ba', '2025-08-28 04:02:13.165712+00', '2025-08-28 04:16:31.642248+00');

INSERT INTO users (id, email, password, role, first_name, last_name, created_at, updated_at) VALUES ('3814ff83-2db2-48f7-aa60-5f7e606756ae', 'peter@ottojobtracker.com', '689d290e41d29a7d10245431f107e93bb5ab4d8848b431ce79335294b050bf0b3f8f636b4bb09119e24bbaa6bd3ff72cc2884fa9ff3b257978befa05ec67880e.bcaecd7cbdb86297f26cdd368af6209d', 'super_admin', 'Unknown', 'User', '2025-09-09 21:35:32.022382+00', '2025-09-09 21:37:52.0834+00');

INSERT INTO users (id, email, password, role, first_name, last_name, office_id, created_at, updated_at) VALUES ('a1446249-284a-49cc-b254-9dc5bbe75a1a', 'contact@hello-optometry.com', '9a22c1cacb4a48e482d068535ecbe1ad50aa0e91d451d9df5023e41ef2b578c285bf23f504d88b1e89dfd4e087bbbaa0eb0b716efc89a281316971924b77bd3e.3e96368bef9d97d75b84282788600314', 'staff', 'Staff', 'HelloOptometry', 'a20d81c8-bde9-4ff0-bbfb-86171cd2f382', '2025-09-03 23:32:26.208843+00', '2025-09-03 23:33:02.961355+00');

INSERT INTO users (id, email, password, role, first_name, last_name, office_id, created_at, updated_at) VALUES ('ac62d335-d85c-4892-a159-7e3b445ee38d', 'peter.hyung.cho@gmail.com', '689d290e41d29a7d10245431f107e93bb5ab4d8848b431ce79335294b050bf0b3f8f636b4bb09119e24bbaa6bd3ff72cc2884fa9ff3b257978befa05ec67880e.bcaecd7cbdb86297f26cdd368af6209d', 'owner', 'peter', 'cho', 'ef1469c9-1c70-464e-bb55-1bb950e27fd8', '2025-09-11 03:50:26.992217+00', '2025-09-11 03:51:36.237131+00');

-- Verify: Run this to check if all 5 users imported correctly
-- SELECT COUNT(*) FROM users;
-- SELECT email FROM users ORDER BY email;
