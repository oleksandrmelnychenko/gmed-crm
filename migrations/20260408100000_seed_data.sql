-- ============================================================
-- SEED DATA for GMED CRM — Medical Tourism Management
-- ============================================================
-- Password for all users: "Password1!" (Argon2id hash)
-- Run: sqlx migrate run

-- ── 1. USERS (10 roles) ──

INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES
-- CEO
('a0000000-0000-0000-0000-000000000001', 'esther.berg@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Esther Berg', 'ceo', true),
-- CEO Assistant
('a0000000-0000-0000-0000-000000000002', 'anna.mueller@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Anna Mueller', 'ceo_assistant', true),
-- Patient Manager
('a0000000-0000-0000-0000-000000000003', 'sarah.kovacs@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Sarah Kovacs', 'patient_manager', true),
-- Teamlead Interpreter
('a0000000-0000-0000-0000-000000000004', 'olga.petrova@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Olga Petrova', 'teamlead_interpreter', true),
-- Interpreters
('a0000000-0000-0000-0000-000000000005', 'dmitry.volkov@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Dmitry Volkov', 'interpreter', true),
('a0000000-0000-0000-0000-000000000006', 'marina.sokolova@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Marina Sokolova', 'interpreter', true),
-- Concierge
('a0000000-0000-0000-0000-000000000007', 'hans.becker@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Hans Becker', 'concierge', true),
-- Billing
('a0000000-0000-0000-0000-000000000008', 'claudia.hoffman@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Claudia Hoffman', 'billing', true),
-- Sales
('a0000000-0000-0000-0000-000000000009', 'max.richter@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Max Richter', 'sales', true),
-- IT Admin
('a0000000-0000-0000-0000-000000000010', 'tom.weber@gmed.de',
 '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNhbHQxMjM0NTY3OA$Y6kxV5q5VhGZ1J2K0sR3GqOvHpE7vFbNzLkR1PwM2vQ',
 'Tom Weber', 'it_admin', true)
ON CONFLICT (email) DO NOTHING;


-- ── 2. PATIENTS (15 patients) ──

INSERT INTO patients (id, patient_id, title, first_name, last_name, birth_date, gender, nationality, residence_country, languages, phone_primary, email, address_city, address_country, insurance_type, insurance_provider, is_active, created_by) VALUES
('b0000000-0000-0000-0000-000000000001', 'P-0001', 'Mr.', 'Abbela', 'Nane', '2000-04-15', 'female', 'Nigerian', 'Nigeria', '{en,de}', '+234-801-234-5678', 'abbela.nane@mail.com', 'Lagos', 'Nigeria', 'self_pay', NULL, true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000002', 'P-0002', 'Ms.', 'Juliana', 'Gale', '2003-07-22', 'female', 'Brazilian', 'Brazil', '{pt,en}', '+55-11-9876-5432', 'juliana.gale@mail.com', 'Sao Paulo', 'Brazil', 'private', 'Allianz Global', true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000003', 'P-0003', NULL, 'Abefuurwa', 'Mary', '2005-01-10', 'female', 'Ghanaian', 'Ghana', '{en}', '+233-24-567-8901', 'abefuurwa.mary@mail.com', 'Accra', 'Ghana', 'foreign', NULL, true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000004', 'P-0004', 'Mr.', 'Victor', 'Dane', '2006-09-03', 'male', 'Danish', 'Denmark', '{da,en,de}', '+45-20-123-456', 'victor.dane@mail.com', 'Copenhagen', 'Denmark', 'private', 'Tryg Forsikring', true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000005', 'P-0005', 'Mr.', 'Victor', 'Darmane', '2004-03-18', 'male', 'Latvian', 'Latvia', '{lv,ru,en}', '+371-20-345-678', 'victor.darmane@mail.com', 'Riga', 'Latvia', 'foreign', NULL, true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000006', 'P-0006', 'Ms.', 'Alexandra', 'Manti', '1999-11-25', 'female', 'Greek', 'Greece', '{el,en}', '+30-697-123-4567', 'alexandra.manti@mail.com', 'Athens', 'Greece', 'private', 'Ethniki Insurance', true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000007', 'P-0007', 'Mr.', 'Sergei', 'Kovalenko', '1985-06-12', 'male', 'Ukrainian', 'Ukraine', '{uk,ru,de}', '+380-67-890-1234', 'sergei.kovalenko@mail.com', 'Kyiv', 'Ukraine', 'self_pay', NULL, true, 'a0000000-0000-0000-0000-000000000001'),
('b0000000-0000-0000-0000-000000000008', 'P-0008', 'Ms.', 'Fatima', 'Al-Rashid', '1992-02-28', 'female', 'Emirati', 'UAE', '{ar,en}', '+971-50-123-4567', 'fatima.alrashid@mail.com', 'Dubai', 'UAE', 'private', 'Daman Insurance', true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000009', 'P-0009', 'Mr.', 'Andrei', 'Popov', '1978-08-05', 'male', 'Russian', 'Russia', '{ru,en}', '+7-916-234-5678', 'andrei.popov@mail.com', 'Moscow', 'Russia', 'self_pay', NULL, true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000010', 'P-0010', 'Ms.', 'Elena', 'Novak', '1990-12-14', 'female', 'Czech', 'Czech Republic', '{cs,de,en}', '+420-777-123-456', 'elena.novak@mail.com', 'Prague', 'Czech Republic', 'foreign', NULL, true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000011', 'P-0011', 'Mr.', 'Ahmed', 'Hassan', '1988-04-20', 'male', 'Egyptian', 'Egypt', '{ar,en}', '+20-100-234-5678', 'ahmed.hassan@mail.com', 'Cairo', 'Egypt', 'self_pay', NULL, true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000012', 'P-0012', 'Ms.', 'Li', 'Wei', '1995-07-08', 'female', 'Chinese', 'China', '{zh,en}', '+86-138-1234-5678', 'li.wei@mail.com', 'Shanghai', 'China', 'private', 'Ping An Insurance', true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000013', 'P-0013', 'Mr.', 'Nikolai', 'Smirnov', '1982-10-30', 'male', 'Russian', 'Russia', '{ru,de}', '+7-903-345-6789', 'nikolai.smirnov@mail.com', 'St. Petersburg', 'Russia', 'self_pay', NULL, true, 'a0000000-0000-0000-0000-000000000001'),
('b0000000-0000-0000-0000-000000000014', 'P-0014', 'Ms.', 'Yana', 'Kravchenko', '1997-05-16', 'female', 'Ukrainian', 'Germany', '{uk,ru,de,en}', '+49-176-1234-5678', 'yana.kravchenko@mail.com', 'Berlin', 'Germany', 'public', 'TK', true, 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000015', 'P-0015', 'Mr.', 'Omar', 'Farooq', '1975-01-22', 'male', 'Pakistani', 'Pakistan', '{ur,en}', '+92-300-123-4567', 'omar.farooq@mail.com', 'Lahore', 'Pakistan', 'self_pay', NULL, true, 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (patient_id) DO NOTHING;


-- ── 3. PROVIDERS (6 medical facilities) ──

INSERT INTO providers (id, name, provider_type, address_street, address_city, address_zip, address_country, phone, email, fachbereich, is_active) VALUES
('c0000000-0000-0000-0000-000000000001', 'Charite Universitaetsmedizin Berlin', 'medical', 'Chariteplatz 1', 'Berlin', '10117', 'Germany', '+49-30-450-50', 'info@charite.de', 'Allgemeinmedizin', true),
('c0000000-0000-0000-0000-000000000002', 'Helios Klinikum Berlin-Buch', 'medical', 'Schwanebecker Chaussee 50', 'Berlin', '13125', 'Germany', '+49-30-9401-0', 'info@helios-berlin.de', 'Orthopaedie', true),
('c0000000-0000-0000-0000-000000000003', 'Universitaetsklinikum Heidelberg', 'medical', 'Im Neuenheimer Feld 672', 'Heidelberg', '69120', 'Germany', '+49-6221-56-0', 'info@ukl-hd.de', 'Onkologie', true),
('c0000000-0000-0000-0000-000000000004', 'Klinikum rechts der Isar (TUM)', 'medical', 'Ismaninger Str. 22', 'Muenchen', '81675', 'Germany', '+49-89-4140-0', 'info@mri.tum.de', 'Kardiologie', true),
('c0000000-0000-0000-0000-000000000005', 'Premium Medical Travel GmbH', 'non_medical', 'Friedrichstr. 100', 'Berlin', '10117', 'Germany', '+49-30-200-300', 'service@pmt.de', NULL, true),
('c0000000-0000-0000-0000-000000000006', 'MedTranslate Services', 'non_medical', 'Kurfuerstendamm 200', 'Berlin', '10719', 'Germany', '+49-30-555-678', 'office@medtranslate.de', NULL, true)
ON CONFLICT (id) DO NOTHING;


-- ── 4. LEADS (20 leads — various statuses, spread over 3 months) ──

INSERT INTO leads (id, first_name, last_name, email, phone, source, country, languages, needs_medical, qualification_status, created_by, created_at) VALUES
('d0000000-0000-0000-0000-000000000001', 'Ivan', 'Petrov', 'ivan.petrov@yandex.ru', '+7-916-111-2233', 'website', 'Russia', '{ru,en}', 'Cardiac surgery consultation', 'new', 'a0000000-0000-0000-0000-000000000009', now() - interval '2 days'),
('d0000000-0000-0000-0000-000000000002', 'Nadia', 'Kowalski', 'nadia.k@gmail.com', '+48-512-345-678', 'referral', 'Poland', '{pl,de}', 'Orthopedic knee replacement', 'new', 'a0000000-0000-0000-0000-000000000009', now() - interval '1 day'),
('d0000000-0000-0000-0000-000000000003', 'Tariq', 'Al-Mansur', 'tariq.m@hotmail.com', '+966-50-111-2233', 'agent', 'Saudi Arabia', '{ar,en}', 'Full body check-up', 'in_progress', 'a0000000-0000-0000-0000-000000000009', now() - interval '5 days'),
('d0000000-0000-0000-0000-000000000004', 'Svetlana', 'Orlova', 'svetlana.o@mail.ru', '+7-903-222-3344', 'website', 'Russia', '{ru}', 'Oncology second opinion', 'in_progress', 'a0000000-0000-0000-0000-000000000009', now() - interval '7 days'),
('d0000000-0000-0000-0000-000000000005', 'Chen', 'Xiaoming', 'chen.xm@qq.com', '+86-139-0000-1111', 'partner', 'China', '{zh,en}', 'Spine surgery', 'qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '10 days'),
('d0000000-0000-0000-0000-000000000006', 'Olga', 'Shapiro', 'olga.sh@gmail.com', '+972-54-111-2233', 'website', 'Israel', '{he,ru,en}', 'Fertility treatment', 'qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '12 days'),
('d0000000-0000-0000-0000-000000000007', 'Amir', 'Hosseini', 'amir.h@gmail.com', '+98-912-345-6789', 'referral', 'Iran', '{fa,en}', 'Dental implants', 'qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '14 days'),
('d0000000-0000-0000-0000-000000000008', 'Maria', 'Gonzalez', 'maria.g@outlook.com', '+34-600-123-456', 'website', 'Spain', '{es,en}', 'Hip replacement', 'not_qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '20 days'),
('d0000000-0000-0000-0000-000000000009', 'Yuki', 'Tanaka', 'yuki.t@mail.jp', '+81-80-1234-5678', 'partner', 'Japan', '{ja,en}', 'Cardiac check-up', 'converted', 'a0000000-0000-0000-0000-000000000009', now() - interval '25 days'),
('d0000000-0000-0000-0000-000000000010', 'Karim', 'Benali', 'karim.b@gmail.com', '+213-555-1234', 'agent', 'Algeria', '{ar,fr}', 'Eye surgery (LASIK)', 'converted', 'a0000000-0000-0000-0000-000000000009', now() - interval '30 days'),
-- Older leads for monthly stats
('d0000000-0000-0000-0000-000000000011', 'Pavel', 'Morozov', 'pavel.m@mail.ru', '+7-926-333-4455', 'website', 'Russia', '{ru}', 'Neurology consultation', 'qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '35 days'),
('d0000000-0000-0000-0000-000000000012', 'Leila', 'Ahmadi', 'leila.a@yahoo.com', '+98-935-111-2233', 'referral', 'Iran', '{fa,en}', 'Plastic surgery', 'converted', 'a0000000-0000-0000-0000-000000000009', now() - interval '40 days'),
('d0000000-0000-0000-0000-000000000013', 'Andrzej', 'Wisniewski', 'andrzej.w@wp.pl', '+48-601-234-567', 'website', 'Poland', '{pl,en}', 'Knee arthroscopy', 'new', 'a0000000-0000-0000-0000-000000000009', now() - interval '45 days'),
('d0000000-0000-0000-0000-000000000014', 'Gulnara', 'Ismail', 'gulnara.i@gmail.com', '+994-50-111-2233', 'agent', 'Azerbaijan', '{az,ru,en}', 'General check-up', 'in_progress', 'a0000000-0000-0000-0000-000000000009', now() - interval '50 days'),
('d0000000-0000-0000-0000-000000000015', 'Mohammed', 'Al-Sayed', 'mohammed.s@gmail.com', '+20-122-345-6789', 'partner', 'Egypt', '{ar,en}', 'Heart valve surgery', 'qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '55 days'),
('d0000000-0000-0000-0000-000000000016', 'Anastasia', 'Romanova', 'anastasia.r@mail.ru', '+7-915-444-5566', 'website', 'Russia', '{ru,de}', 'Dermatology', 'archived', 'a0000000-0000-0000-0000-000000000009', now() - interval '60 days'),
('d0000000-0000-0000-0000-000000000017', 'Raj', 'Patel', 'raj.p@gmail.com', '+91-98765-43210', 'referral', 'India', '{hi,en}', 'Liver transplant eval', 'new', 'a0000000-0000-0000-0000-000000000009', now() - interval '65 days'),
('d0000000-0000-0000-0000-000000000018', 'Marta', 'Sokolowska', 'marta.s@onet.pl', '+48-509-876-543', 'website', 'Poland', '{pl,de}', 'IVF treatment', 'qualified', 'a0000000-0000-0000-0000-000000000009', now() - interval '75 days'),
('d0000000-0000-0000-0000-000000000019', 'Ali', 'Demir', 'ali.d@gmail.com', '+90-532-111-2233', 'agent', 'Turkey', '{tr,en}', 'Bariatric surgery', 'converted', 'a0000000-0000-0000-0000-000000000009', now() - interval '85 days'),
('d0000000-0000-0000-0000-000000000020', 'Nina', 'Ivanova', 'nina.i@yandex.ru', '+7-909-555-6677', 'website', 'Russia', '{ru,en}', 'Pediatric cardiology', 'new', 'a0000000-0000-0000-0000-000000000009', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;


-- ── 5. CASES (8 medical cases) ──

INSERT INTO cases (id, case_id, patient_id, manager_id, status, hauptanfragegrund, aktuelle_anamnese) VALUES
('e0000000-0000-0000-0000-000000000001', 'C-0001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'in_progress', 'Allgemeine Untersuchung', 'Patientin klagt ueber chronische Muedigkeit und Kopfschmerzen seit 3 Monaten.'),
('e0000000-0000-0000-0000-000000000002', 'C-0002', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'in_progress', 'Blutuntersuchung', 'Regelmaessige Kontrolle, Verdacht auf Eisenmangel.'),
('e0000000-0000-0000-0000-000000000003', 'C-0003', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'open', 'Roentgenuntersuchung', 'Persistierende Schmerzen im rechten Knie nach Sportunfall.'),
('e0000000-0000-0000-0000-000000000004', 'C-0004', 'b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'in_progress', 'Konsultation Kardiologie', 'Patient berichtet ueber gelegentliche Brustschmerzen bei Belastung.'),
('e0000000-0000-0000-0000-000000000005', 'C-0005', 'b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', 'in_progress', 'Orthopaedie Wirbelsaeule', 'Chronische Rueckenschmerzen seit 2 Jahren, konservative Therapie bisher ohne Erfolg.'),
('e0000000-0000-0000-0000-000000000006', 'C-0006', 'b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000003', 'open', 'Zweitmeinung Onkologie', 'Patientin wuenscht Zweitmeinung zur empfohlenen Chemotherapie.'),
('e0000000-0000-0000-0000-000000000007', 'C-0007', 'b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000003', 'closed', 'Herz-Kreislauf Check-up', 'Routine-Check nach Myokardinfarkt vor 1 Jahr.'),
('e0000000-0000-0000-0000-000000000008', 'C-0008', 'b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000003', 'in_progress', 'Allgemeine Vorsorge', 'Umfassender Gesundheitscheck auf Wunsch der Patientin.')
ON CONFLICT (case_id) DO NOTHING;


-- ── 6. ORDERS (10 orders — various phases) ──

INSERT INTO orders (id, order_number, patient_id, phase, status, needs_description, created_by) VALUES
('f0000000-0000-0000-0000-000000000001', 'ORD-2026-001', 'b0000000-0000-0000-0000-000000000001', 'execution', 'active', 'General check-up package', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000002', 'ORD-2026-002', 'b0000000-0000-0000-0000-000000000002', 'execution', 'active', 'Blood test review + specialist consultation', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000003', 'ORD-2026-003', 'b0000000-0000-0000-0000-000000000003', 'discovery', 'active', 'X-ray and orthopedic consultation', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000004', 'ORD-2026-004', 'b0000000-0000-0000-0000-000000000004', 'discovery', 'active', 'Cardiology consultation and ECG', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000005', 'ORD-2026-005', 'b0000000-0000-0000-0000-000000000005', 'intake', 'active', 'Routine check-up and travel clearance', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000006', 'ORD-2026-006', 'b0000000-0000-0000-0000-000000000007', 'execution', 'active', 'Spinal MRI and orthopedic evaluation', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000007', 'ORD-2026-007', 'b0000000-0000-0000-0000-000000000008', 'closure', 'active', 'Oncology second opinion report', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000008', 'ORD-2026-008', 'b0000000-0000-0000-0000-000000000009', 'followup', 'active', 'Post-MI cardiac follow-up', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000009', 'ORD-2026-009', 'b0000000-0000-0000-0000-000000000012', 'execution', 'active', 'Comprehensive health screening', 'a0000000-0000-0000-0000-000000000003'),
('f0000000-0000-0000-0000-000000000010', 'ORD-2026-010', 'b0000000-0000-0000-0000-000000000013', 'discovery', 'active', 'Initial assessment for knee surgery', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (order_number) DO NOTHING;


-- ── 7. APPOINTMENTS (14 — today and upcoming) ──

INSERT INTO appointments (id, patient_id, provider_id, order_id, interpreter_id, appointment_type, title, date, time_start, time_end, location, status, created_by) VALUES
-- Today's appointments (2026-04-08)
('11000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005',
 'medical', 'General Check-up', '2026-04-08', '12:30', '13:20', 'Charite Berlin, Station 3A', 'completed', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006',
 'medical', 'Blood Test Review', '2026-04-08', '12:30', '13:20', 'Charite Berlin, Labor', 'in_progress', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005',
 'medical', 'X-ray Review', '2026-04-08', '13:30', '14:00', 'Helios Klinikum, Radiologie', 'planned', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005',
 'medical', 'Consultation', '2026-04-08', '14:00', '14:40', 'Klinikum rechts der Isar, Kardiologie', 'planned', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006',
 'medical', 'Routine Check-up', '2026-04-08', '15:00', '15:40', 'Helios Klinikum, Allgemein', 'planned', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', NULL, 'a0000000-0000-0000-0000-000000000005',
 'medical', 'Consultation', '2026-04-08', '16:00', '16:50', 'Charite Berlin, Onkologie', 'planned', 'a0000000-0000-0000-0000-000000000003'),

-- Tomorrow
('11000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000005',
 'medical', 'Spinal MRI', '2026-04-09', '09:00', '10:00', 'Helios Klinikum, Radiologie', 'confirmed', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000006',
 'medical', 'Oncology Consultation', '2026-04-09', '11:00', '12:00', 'Uniklinikum Heidelberg, Onkologie', 'confirmed', 'a0000000-0000-0000-0000-000000000003'),

-- This week
('11000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000005',
 'medical', 'Cardiac Follow-up', '2026-04-10', '10:00', '11:00', 'Klinikum rechts der Isar, Kardiologie', 'planned', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000006',
 'medical', 'Health Screening', '2026-04-10', '14:00', '16:00', 'Charite Berlin, Vorsorge', 'planned', 'a0000000-0000-0000-0000-000000000003'),

-- Non-medical / internal
('11000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', NULL,
 'non_medical', 'Hotel Transfer', '2026-04-08', '10:00', '10:30', 'Hotel Adlon -> Charite', 'completed', 'a0000000-0000-0000-0000-000000000007'),

('11000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000002', NULL,
 'non_medical', 'Airport Pickup', '2026-04-07', '18:00', '19:30', 'BER -> Hotel', 'completed', 'a0000000-0000-0000-0000-000000000007'),

('11000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', NULL, 'a0000000-0000-0000-0000-000000000005',
 'medical', 'Dermatology Consultation', '2026-04-11', '09:30', '10:30', 'Charite Berlin, Dermatologie', 'planned', 'a0000000-0000-0000-0000-000000000003'),

('11000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000004', NULL, 'a0000000-0000-0000-0000-000000000006',
 'medical', 'Cardiology ECG', '2026-04-12', '11:00', '11:45', 'Klinikum rechts der Isar, Kardiologie', 'planned', 'a0000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;


-- ── 8. PATIENT ASSIGNMENTS ──

INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES
('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003'),
('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003')
ON CONFLICT (patient_id, user_id) DO NOTHING;


-- ── 9. MEDICAL DATA (medications, allergies, etc.) ──

INSERT INTO medikamente (case_id, handelsname, wirkstoff, dosis, dosis_einheit, einnahmeschema, darreichungsform, med_typ) VALUES
('e0000000-0000-0000-0000-000000000001', 'Ibuprofen 400mg', 'Ibuprofen', '400', 'mg', '3x taeglich', 'tablette', 'temporary'),
('e0000000-0000-0000-0000-000000000001', 'Ferro sanol', 'Eisen(II)-glycin-sulfat', '100', 'mg', '1x morgens', 'tablette', 'permanent'),
('e0000000-0000-0000-0000-000000000004', 'Metoprolol', 'Metoprolol', '50', 'mg', '2x taeglich', 'tablette', 'permanent'),
('e0000000-0000-0000-0000-000000000004', 'ASS 100', 'Acetylsalicylsaeure', '100', 'mg', '1x taeglich', 'tablette', 'permanent'),
('e0000000-0000-0000-0000-000000000005', 'Voltaren', 'Diclofenac', '75', 'mg', '2x taeglich', 'tablette', 'temporary'),
('e0000000-0000-0000-0000-000000000007', 'Ramipril', 'Ramipril', '5', 'mg', '1x morgens', 'tablette', 'permanent'),
('e0000000-0000-0000-0000-000000000007', 'Clopidogrel', 'Clopidogrel', '75', 'mg', '1x taeglich', 'tablette', 'permanent')
ON CONFLICT DO NOTHING;

INSERT INTO allergien (case_id, allergie, reaktion) VALUES
('e0000000-0000-0000-0000-000000000001', 'Penicillin', 'Hautausschlag'),
('e0000000-0000-0000-0000-000000000002', 'Pollen', 'Rhinitis'),
('e0000000-0000-0000-0000-000000000004', 'Kontrastmittel', 'Uebelkeit'),
('e0000000-0000-0000-0000-000000000006', 'Latex', 'Kontaktdermatitis')
ON CONFLICT DO NOTHING;

INSERT INTO vorerkrankungen (case_id, erkrankung, erstdiagnose) VALUES
('e0000000-0000-0000-0000-000000000004', 'Arterielle Hypertonie', '2020'),
('e0000000-0000-0000-0000-000000000005', 'Bandscheibenvorfall L4/L5', '2024'),
('e0000000-0000-0000-0000-000000000007', 'Myokardinfarkt (NSTEMI)', '2025'),
('e0000000-0000-0000-0000-000000000007', 'Diabetes Typ 2', '2019'),
('e0000000-0000-0000-0000-000000000008', 'Eisenmangelanaemie', '2025')
ON CONFLICT DO NOTHING;


-- ── 10. TASKS ──

INSERT INTO tasks (title, description, assigned_to, assigned_by, patient_id, appointment_id, due_date, priority, status) VALUES
('Prepare medical records for transfer', 'Collect all lab results and imaging for Charite consultation', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '2026-04-08 10:00:00+02', 'high', 'completed'),
('Arrange interpreter for MRI appointment', NULL, 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000007', '11000000-0000-0000-0000-000000000007', '2026-04-09 08:00:00+02', 'high', 'in_progress'),
('Send follow-up report to patient', 'Cardiac follow-up summary for Mr. Popov', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000009', NULL, '2026-04-11 17:00:00+02', 'normal', 'open'),
('Verify insurance documents', 'Check pre-approval for Juliana Gale, Allianz Global', 'a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', NULL, '2026-04-09 12:00:00+02', 'urgent', 'open'),
('Book hotel for patient family', 'Need 2 nights near Helios Klinikum', 'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000005', NULL, '2026-04-08 14:00:00+02', 'normal', 'in_progress'),
('Qualify new lead — Raj Patel', 'Initial call and needs assessment', 'a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', NULL, NULL, '2026-04-10 10:00:00+02', 'normal', 'open')
ON CONFLICT DO NOTHING;
