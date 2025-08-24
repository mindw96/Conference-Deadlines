-- This script migrates data from the old conferences.json to your Supabase tables.
--
-- Instructions:
-- 1. In your Supabase project, go to the "SQL Editor".
-- 2. Create a "New query".
-- 3. Paste the content of this file and click "RUN".

-- Clear existing data to prevent duplicates if you run this multiple times.
TRUNCATE public.conferences, public.deadlines RESTART IDENTITY CASCADE;

-- Insert data into the 'conferences' table
INSERT INTO public.conferences (id, name, conf_start_date, conf_end_date, location, site_url, areas, tags, note, timezone) VALUES
('aaai-2026', 'AAAI 2026', '2026-01-20', '2026-01-27', 'Singapore', 'https://aaai.org/Conferences/AAAI-26/', '{"AI": ["ML", "NLP", "CV"]}', '{}', '', 'AOE (UTC−12)'),
('acl-2026', 'ACL 2026', '2026-07-02', '2026-07-07', 'San Diego, California, United States', 'https://2026.aclweb.org', '{"AI": ["NLP"]}', '{"ARR"}', '', 'UTC'),
('emnlp-2025', 'EMNLP 2025', '2025-11-05', '2025-11-09', 'Suzhou, China', 'https://2025.emnlp.org', '{"AI": ["NLP"]}', '{"ARR"}', '', 'AOE (UTC−12)'),
('neurips-2025', 'NeurIPS 2025', '2025-12-02', '2025-12-07', 'San Diego, California, United States', 'https://neurips.cc/Conferences/2025', '{"AI": ["ML", "NLP", "CV"]}', '{}', '', 'AOE (UTC−12)'),
('iclr-2026', 'ICLR 2026', '2026-04-23', '2026-04-27', 'Rio de Janeiro, Brazil', 'https://iclr.cc/', '{"AI": ["ML", "NLP", "CV"]}', '{}', '', 'AOE (UTC−12)'),
('miccai-2025', 'MICCAI 2025', '2025-09-23', '2025-09-27', 'Daejeon, Republic of Korea', 'https://conferences.miccai.org/2025/en/default.asp', '{"AI": ["Medical"]}', '{}', '', 'AOE (UTC−12)'),
('chi-2026', 'ACM CHI 2026', '2026-04-13', '2026-04-17', 'Barcelona, Spain', 'https://chi2026.acm.org/', '{"CS": ["HCI", "UX/UI"]}', '{}', '', 'AOE (UTC−12)'),
('siggraph-2026', 'SIGGRAPH 2026', '2026-07-19', '2026-07-23', 'Los Angeles, California', 'https://s2026.siggraph.org/', '{"CS": ["Graphics", "Animation", "VR/AR"]}', '{}', '', 'AOE (UTC−12)'),
('aps-2026', 'APS Global Physics Summit 2026', '2026-03-15', '2026-03-20', 'Denver, Colorado, United States', 'https://summit.aps.org/', '{"Science": ["Physics"]}', '{}', '', 'AOE (UTC−12)'),
('ismb-2026', 'ISMB 2026', '2026-07-12', '2026-07-16', 'Washington, D.C., United States', 'https://www.iscb.org/ismb2026/home', '{"Bio": ["Bioinformatics", "Computational Biology"]}', '{}', '', 'AOE (UTC−12)');

-- Insert data into the 'deadlines' table
INSERT INTO public.deadlines (conference_id, deadline_type, due_date) VALUES
('aaai-2026', 'Deadline', '2025-07-25T23:59:00Z'),
('emnlp-2025', 'Deadline', '2025-05-20T23:59:00Z'),
('neurips-2025', 'Deadline', '2025-05-11T23:59:00Z'),
('iclr-2026', 'Deadline', '2025-09-19T23:59:00Z'),
('miccai-2025', 'Deadline', '2025-02-13T23:59:00Z'),
('chi-2026', 'Deadline', '2025-09-04T23:59:00Z'),
('aps-2026', 'Deadline', '2025-10-23T23:59:00Z');

