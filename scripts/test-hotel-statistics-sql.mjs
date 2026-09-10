// Run: node scripts/test-hotel-statistics-sql.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
// Executes the production PostgreSQL query against disposable, fictional records in PGlite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE patients (id uuid PRIMARY KEY, patient_id text, first_name text, last_name text);
    CREATE TABLE providers (id uuid PRIMARY KEY, name text, address_city text, address_country text, provider_type text DEFAULT 'non_medical', is_active boolean DEFAULT true);
    CREATE TABLE provider_taxonomy_nodes (id uuid PRIMARY KEY, code text);
    CREATE TABLE provider_taxonomy_assignments (provider_id uuid, taxonomy_node_id uuid);
    CREATE TABLE patient_assignments (patient_id uuid, user_id uuid, revoked_at timestamptz);
    CREATE TABLE concierge_services (id uuid PRIMARY KEY, patient_id uuid, provider_id uuid, vendor_name text, status text, starts_at timestamptz, ends_at timestamptz, actual_cost numeric(12,2), cost_estimate numeric(12,2), currency text, service_kind text, booking_reference text);
    CREATE TABLE tasks (id uuid PRIMARY KEY, concierge_service_id uuid, patient_id uuid, provider_id uuid, vendor_name text, service_status text, starts_at timestamptz, ends_at timestamptz, actual_cost numeric(12,2), cost_estimate numeric(12,2), currency text, service_kind text, deleted_at timestamptz, created_at timestamptz DEFAULT now(), task_scope text DEFAULT 'general', booking_reference text);
    CREATE TABLE concierge_expense_submissions (id uuid PRIMARY KEY, concierge_service_id uuid, task_id uuid, amount_gross numeric(12,2), currency text);
    CREATE TABLE concierge_expense_review_events (id uuid PRIMARY KEY, expense_id uuid, action text, reverses_event_id uuid, external_invoice_id uuid);
    CREATE TABLE external_invoices (id uuid PRIMARY KEY, paid_by text, provider_liability_gross numeric(12,2));
    CREATE TABLE external_invoice_provider_settlement_balances (external_invoice_id uuid PRIMARY KEY, company_paid_gross numeric(12,2), remaining_provider_liability_gross numeric(12,2));
  `);
  await db.exec(await readFile(new URL('../migrations/20260910210000_hotel_stay_statistics.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../migrations/20260910220000_hotel_breakfast_details.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO users VALUES ($1)', [id(1)]);
  await db.query("INSERT INTO patients VALUES ($1, 'P-TEST-001', 'Test', 'Patient')", [id(3)]);
  await db.query("INSERT INTO providers (id, name, address_city) VALUES ($1, 'Fictional Hotel', 'Berlin')", [id(2)]);
  // The directory must include active hotels before their first booking and exclude other providers.
  await db.query("INSERT INTO provider_taxonomy_nodes VALUES ($1, 'nonmedical_hotels'), ($2, 'nonmedical_transport')", [id(7001), id(7002)]);
  for (const [number, name, kind, active, taxonomy] of [[7010,'New Hotel','non_medical',true,7001],[7011,'Inactive Hotel','non_medical',false,7001],[7012,'Medical Provider','medical',true,7001],[7013,'Transport Provider','non_medical',true,7002]]) {
    await db.query('INSERT INTO providers VALUES ($1,$2,$3,$4,$5,$6)', [id(number),name,'Berlin','DE',kind,active]);
    await db.query('INSERT INTO provider_taxonomy_assignments VALUES ($1,$2)', [id(number),id(taxonomy)]);
  }
  const directorySql = await readFile(new URL('../crates/server/src/routes/hotel_directory.sql', import.meta.url), 'utf8');
  assert.deepEqual((await db.query(directorySql)).rows.map(row => row.item), [{ id: id(7010), name: 'New Hotel', city: 'Berlin', country: 'DE' }]);
  // More than the legacy endpoint's 200-row limit. March DST dates use Berlin calendar dates.
  await db.query(`INSERT INTO concierge_services SELECT gen_random_uuid(), $1, $2, NULL, 'completed', '2026-03-28T14:00:00Z', '2026-03-30T09:00:00Z', 200, 250, 'EUR', 'hotel', 'LEGACY-REF' FROM generate_series(1,250)`, [id(3), id(2)]);
  const original = (await db.query('SELECT id FROM concierge_services LIMIT 1')).rows[0].id;
  await db.query("INSERT INTO tasks (id, concierge_service_id, patient_id, service_kind, service_status, currency, starts_at, ends_at, actual_cost, cost_estimate, provider_id) SELECT $1,id,patient_id,service_kind,status,currency,starts_at,ends_at,actual_cost,cost_estimate,provider_id FROM concierge_services WHERE id=$2", [id(4), original]);
  await db.query("INSERT INTO tasks (id, patient_id, service_kind, service_status, currency, starts_at, ends_at) VALUES ($1,$2,'hotel','confirmed','EUR','2026-03-31T22:30:00Z','2026-04-04T09:00:00Z')", [id(5), id(6)]);
  await db.query('INSERT INTO patient_assignments VALUES ($1,$2,NULL)', [id(6), id(1)]);
  await db.query('INSERT INTO hotel_stay_statistics_details (concierge_service_id, room_count, updated_by) VALUES ($1,2,$2)', [original, id(1)]);
  for (const [n, amount, mode, action] of [[10,100,'patient','posted'],[11,50,'unpaid','posted'],[12,45,'agency','posted'],[13,20,'unpaid',null],[14,99,'unpaid','rejected']]) {
    await db.query('INSERT INTO concierge_expense_submissions VALUES ($1,$2,$3,$4,$5)', [id(n),original,id(4),amount,'EUR']);
    if (action) {
      await db.query('INSERT INTO concierge_expense_review_events VALUES ($1,$2,$3,NULL,$4)', [id(n+100),id(n),action,id(n+200)]);
      await db.query('INSERT INTO external_invoices VALUES ($1,$2,$3)', [id(n+200),mode,mode === 'unpaid' ? amount : 0]);
      await db.query('INSERT INTO external_invoice_provider_settlement_balances VALUES ($1,$2,$3)', [id(n+200),n === 11 ? 30 : 0,n === 11 ? 20 : 0]);
    }
  }
  await db.query("INSERT INTO concierge_expense_review_events VALUES ($1,$2,'reversed',$3,NULL)", [id(999),id(12),id(112)]);
  const sql = await readFile(new URL('../crates/server/src/routes/hotel_statistics.sql', import.meta.url), 'utf8');
  const query = async (from, to, global = true) => (await db.query(sql, [from,to,global,id(1)])).rows.map(row => row.item);
  const march = await query('2026-03-01','2026-03-31');
  assert.equal(march.length,250); // Migrated task and service are one booking, no cap.
  const booking = march.find(row => row.id === original);
  assert.equal(booking.room_count,2); assert.equal(booking.task_id,id(4));
  assert.equal(booking.patient_name,'Test Patient'); assert.equal(booking.patient_number,'P-TEST-001'); assert.equal(booking.booking_reference,null);
  assert.equal(booking.posted_count,2); assert.equal(booking.posted_cost,'150.00');
  assert.equal(booking.direct_paid,'100.00'); assert.equal(booking.company_paid,'30.00'); assert.equal(booking.provider_due,'20.00');
  assert.equal(booking.pending_cost,'20.00'); assert.equal(booking.pending_count,1);
  assert.equal(booking.check_in,'2026-03-28'); assert.equal(booking.check_out,'2026-03-30');
  const april = await query('2026-04-01','2026-04-30');
  assert.equal(april.length,1); assert.equal(april[0].check_in,'2026-04-01');
  assert.equal(april[0].actual_cost,null); assert.equal(april[0].room_count,null);
  assert.equal((await query('2026-03-01','2026-04-30',false)).length,1);
  await db.query('UPDATE patient_assignments SET revoked_at=now()');
  assert.equal((await query('2026-03-01','2026-04-30',false)).length,0);
  await assert.rejects(db.query('UPDATE hotel_stay_statistics_details SET room_count=0'));
  await assert.rejects(db.query('UPDATE hotel_stay_statistics_details SET room_count=1001'));
  await assert.rejects(db.query('UPDATE hotel_stay_statistics_details SET task_id=$1', [id(5)]));
  const rust = await readFile(new URL('../crates/server/src/routes/hotel_statistics.rs', import.meta.url), 'utf8');
  const mutationSql = [...rust.matchAll(/r#"([\s\S]*?)"#/g)].map(match => match[1]);
  await db.query(mutationSql[0], ['service',original,3,id(1),true]);
  await db.query(mutationSql[0], ['service',original,4,id(1),true]);
  assert.equal((await query('2026-03-01','2026-03-31')).find(row => row.id === original).room_count,4);
  assert.equal((await db.query(mutationSql[0], ['service',original,5,id(1),false])).rows.length,0);
  await db.query(mutationSql[1], [id(5),2,id(1),true]);
  await db.query(mutationSql[1], [id(5),3,id(1),true]);
  assert.equal((await query('2026-04-01','2026-04-30'))[0].room_count,3);
  assert.equal((await db.query(mutationSql[1], [id(4),2,id(1),true])).rows.length,0); // Cannot create a second identity for a legacy-linked task.
  await db.query('UPDATE tasks SET actual_cost=NULL, cost_estimate=NULL, ends_at=NULL WHERE id=$1', [id(4)]);
  const cleared = (await query('2026-03-01','2026-03-31')).find(row => row.id === original);
  assert.equal(cleared.actual_cost,null); assert.equal(cleared.cost_estimate,null); assert.equal(cleared.check_out,null);
  const breakfastSql = await readFile(new URL('../crates/server/src/routes/hotel_breakfast_update.sql', import.meta.url), 'utf8');
  const breakfast = (source, bookingId, mode, count, amount, currency, payer = 'unknown', global = true) => db.query(breakfastSql.replace('__SOURCE_KEY__', source === 'service' ? 'concierge_service_id' : 'task_id'), [source, bookingId, mode, count, amount, currency, payer, 'Test conditions', id(1), global]);
  await breakfast('service', original, 'hotel_extra', 8, '40.25', 'EUR', 'split');
  const withBreakfast = (await query('2026-03-01','2026-03-31')).find(row => row.id === original);
  assert.equal(withBreakfast.breakfast_total,'40.25'); assert.equal(withBreakfast.breakfast_payer,'split'); assert.equal(withBreakfast.room_count,4);
  assert.equal(withBreakfast.posted_cost,'150.00'); // Reporting breakfast costs never create payment entries.
  assert.equal((await breakfast('service',original,'self',4,'25.00','EUR','patient',false)).rows.length,0);
  assert.equal((await breakfast('task',id(4),'self',4,'25.00','EUR','patient')).rows.length,0);
  assert.equal((await breakfast('service',original,'self',4,'25.00','USD','patient')).rows.length,0);
  await assert.rejects(breakfast('service',original,'included',8,'40.00','EUR'));
  await assert.rejects(breakfast('service',original,'none',8,null,null));
  await assert.rejects(breakfast('service',original,'self',0,'-1.00','EUR','patient'));
  await breakfast('service',original,'included',8,null,null);
  const included = (await query('2026-03-01','2026-03-31')).find(row => row.id === original);
  assert.equal(included.breakfast_total,null); assert.equal(included.breakfast_count,8);
  await breakfast('task',id(5),'self',2,'10.50','EUR','patient');
  await breakfast('task',id(5),'self',3,'15.50','EUR','patient');
  assert.equal((await query('2026-04-01','2026-04-30'))[0].breakfast_total,'15.50');
  await db.query("UPDATE tasks SET currency='USD' WHERE id=$1", [id(5)]);
  assert.equal((await query('2026-04-01','2026-04-30'))[0].breakfast_currency,'EUR');
  // Older helper tasks must not override native booking identity, cost or access scope.
  await db.query("INSERT INTO tasks (id, concierge_service_id, patient_id, created_at) VALUES ($1,$2,$3,'2020-01-01')", [id(777),original,id(6)]);
  await db.query('UPDATE patient_assignments SET revoked_at=NULL');
  assert.equal((await query('2026-03-01','2026-03-31',false)).length,0);
  let canonical = (await query('2026-03-01','2026-03-31')).find(row => row.id === original);
  assert.equal(canonical.task_id,id(4)); assert.equal(canonical.actual_cost,null);
  assert.equal((await breakfast('service',original,'self',2,'12.00','EUR','patient',false)).rows.length,0);
  assert.equal((await db.query(mutationSql[0], ['service',original,8,id(1),false])).rows.length,0);
  await db.query("UPDATE tasks SET deleted_at=now() WHERE id=$1", [id(4)]);
  assert.equal((await query('2026-03-01','2026-03-31')).length,249);
  assert.equal((await breakfast('service',original,'self',2,'12.00','EUR','patient')).rows.length,0);
  assert.equal((await db.query(mutationSql[0], ['service',original,8,id(1),true])).rows.length,0);
  await db.query("UPDATE tasks SET deleted_at=NULL, patient_id=NULL WHERE id=$1", [id(4)]);
  assert.equal((await query('2026-03-01','2026-03-31')).length,249);
  await db.query("UPDATE tasks SET patient_id=$2, booking_reference='NATIVE-REF' WHERE id=$1", [id(4),id(3)]);
  canonical = (await query('2026-03-01','2026-03-31')).find(row => row.id === original);
  assert.equal(canonical.booking_reference,'NATIVE-REF');
  console.log('Canonical booking checked against an older helper task: identity, assignment, deletion, cleared patient and booking reference.');
  // Exercise the exact SQL projection used by the real document download route.
  await db.exec(`CREATE TABLE documents (id uuid PRIMARY KEY, patient_id uuid, lead_id uuid, order_id uuid, appointment_id uuid, is_medical boolean DEFAULT false, art text DEFAULT 'provider_document');
    CREATE TABLE provider_document_links (document_id uuid, provider_id uuid);`);
  const documentRoute = await readFile(new URL('../crates/server/src/routes/documents.rs', import.meta.url), 'utf8');
  const generalProjection = documentRoute.match(/\(d\.patient_id IS NULL AND d\.lead_id IS NULL AND d\.order_id IS NULL[\s\S]*?AS general_provider_document/)[0];
  for (let n = 800; n < 808; n++) await db.query('INSERT INTO documents (id) VALUES ($1)', [id(n)]);
  for (let n = 800; n < 807; n++) await db.query('INSERT INTO provider_document_links VALUES ($1,$2)', [id(n),id(2)]);
  for (const [n, field] of [[801,'patient_id'],[802,'lead_id'],[803,'order_id'],[804,'appointment_id']]) await db.query(`UPDATE documents SET ${field}=$2 WHERE id=$1`, [id(n),id(3)]);
  await db.query('UPDATE documents SET is_medical=true WHERE id=$1', [id(805)]);
  await db.query("UPDATE documents SET art='other_document' WHERE id=$1", [id(806)]);
  const projected = (await db.query(`SELECT d.id, ${generalProjection} FROM documents d ORDER BY d.id`)).rows;
  assert.deepEqual(projected.map(row => row.general_provider_document), [true,false,false,false,false,false,false,false]);
  const hotelProjection = documentRoute.match(/EXISTS \(\s+SELECT 1 FROM provider_document_links hotel_link[\s\S]*?AS hotel_provider_link/)[0];
  await db.query('UPDATE provider_document_links SET provider_id=$1', [id(7010)]);
  for (const [number, provider] of [[808,7013],[809,7012]]) {
    await db.query('INSERT INTO documents (id) VALUES ($1)', [id(number)]);
    await db.query('INSERT INTO provider_document_links VALUES ($1,$2)', [id(number),id(provider)]);
  }
  const hotelAccess = (await db.query(`SELECT d.id, ${generalProjection}, ${hotelProjection} FROM documents d ORDER BY d.id`)).rows;
  assert.deepEqual(hotelAccess.filter(row => row.general_provider_document && row.hotel_provider_link).map(row => row.id), [id(800)]);
  const uploadRoute = await readFile(new URL('../crates/server/src/routes/provider_documents.rs', import.meta.url), 'utf8');
  const uploadProviderSql = uploadRoute.match(/"(SELECT provider\.name,[\s\S]*?provider\.id = \$1)"/)[1];
  for (const [provider, expected] of [[7010,true],[7012,false],[7013,false]]) {
    assert.equal((await db.query(uploadProviderSql, [id(provider)])).rows[0].is_hotel, expected);
  }
  console.log('Concierge hotel contracts: real upload/download SQL excludes medical providers, non-hotels and private documents.');
  await db.exec("ALTER TABLE providers ADD COLUMN taxonomy_attributes jsonb DEFAULT '{}'::jsonb, ADD COLUMN updated_at timestamptz DEFAULT now()");
  await db.query('UPDATE providers SET taxonomy_attributes=$2::jsonb WHERE id=$1', [id(7010),JSON.stringify({ stars: 4, has_contract: true })]);
  const beforeStays = JSON.stringify(await query('2026-03-01','2026-04-30'));
  const termsSql = await readFile(new URL('../crates/server/src/routes/hotel_breakfast_terms_update.sql', import.meta.url), 'utf8');
  const savedTerms = { mode: 'extra', price_per_person: '12.50', currency: 'EUR', notes: 'Per person', updated_by: id(1) };
  assert.equal((await db.query(termsSql, [id(7010), JSON.stringify(savedTerms)])).rows.length,1);
  const attributes = (await db.query('SELECT taxonomy_attributes FROM providers WHERE id=$1', [id(7010)])).rows[0].taxonomy_attributes;
  assert.deepEqual(attributes, { stars: 4, has_contract: true, hotel_breakfast_terms: savedTerms });
  const termsRoute = await readFile(new URL('../crates/server/src/routes/hotel_breakfast_terms.rs', import.meta.url), 'utf8');
  const termsReadSql = termsRoute.match(/r#"([\s\S]*?)"#/)[1];
  assert.deepEqual(Object.values((await db.query(termsReadSql, [id(7010)])).rows[0])[0], savedTerms);
  for (const provider of [7012,7013]) assert.equal((await db.query(termsSql, [id(provider),JSON.stringify(savedTerms)])).rows.length,0);
  await db.query(termsSql, [id(7010),JSON.stringify({ mode: 'included', price_per_person: null, currency: null, notes: null })]);
  assert.equal(JSON.stringify(await query('2026-03-01','2026-04-30')), beforeStays);
  console.log('Hotel breakfast terms persist independently, preserve other hotel attributes and do not change bookings or payments.');
  console.log('General contract access projection excludes patient, lead, order, appointment, medical and unlinked documents.');
  console.log('Breakfast SQL verified: source scope, update persistence, independent room metadata, included cost constraints, original currency, no payment duplication.');
  console.log('Hotel SQL verified: 250 bookings, task migration deduplication, Berlin date boundary, direct/partial/reversed/pending payments, assignment scope and room constraints.');
} finally { await db.close(); }
