// Runs the production catalog and service SQL against disposable fictional records.
// node scripts/test-order-intake-catalog-sql.mjs /path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
try {
  await db.exec(`
    CREATE TABLE medical_specializations(id uuid PRIMARY KEY, name_de text, is_active boolean DEFAULT true, deleted_at timestamptz);
    CREATE TABLE medical_specialization_work_types(id uuid PRIMARY KEY, name_de text, name_ru text, name_en text, name_es text, code text, sort_order integer, duration_hours integer, min_price_eur numeric, max_price_eur numeric, is_active boolean DEFAULT true, deleted_at timestamptz);
    CREATE TABLE medical_specialization_work_type_assignments(work_type_id uuid, specialization_id uuid);
    CREATE TABLE medical_specialization_work_type_descriptions(id uuid PRIMARY KEY, work_type_id uuid, language_code text, body text, sort_order integer, is_active boolean DEFAULT true, deleted_at timestamptz);
    CREATE TABLE agency_service_catalog(id uuid PRIMARY KEY, description text, description_items jsonb, unit_label text);
    CREATE TABLE agency_service_price_versions(id uuid PRIMARY KEY, agency_service_id uuid, unit_price numeric, vat_rate numeric, currency text, valid_from date, valid_to date);
    CREATE TABLE orders(id uuid PRIMARY KEY, patient_id uuid);
    CREATE TABLE order_leistungen(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, description text, quantity numeric, unit_price numeric, vat_rate numeric, client_reference text, agency_service_id uuid, agency_service_price_version_id uuid, patient_id uuid, notes text, UNIQUE(order_id,client_reference));
  `);
  await db.query("INSERT INTO medical_specializations(id,name_de) VALUES($1,'Urologie'),($2,'Dermatologie')", [id(1),id(2)]);
  await db.query("INSERT INTO medical_specialization_work_types(id,name_de,code,sort_order,duration_hours,min_price_eur,max_price_eur) VALUES($1,'Operation','surgery',1,15,28000,35000)", [id(3)]);
  await db.query('INSERT INTO medical_specialization_work_type_assignments VALUES($1,$2)', [id(3),id(1)]);
  await db.query("INSERT INTO medical_specialization_work_type_descriptions(id,work_type_id,language_code,body,sort_order,deleted_at) VALUES($1,$3,'de','Current description',1,NULL),($2,$3,'de','Deleted wording',2,now())", [id(4),id(5),id(3)]);
  await db.query("INSERT INTO agency_service_catalog VALUES($1,'From [Datum Beginn]', '[]','Std.')", [id(6)]);
  await db.query("INSERT INTO agency_service_price_versions VALUES($1,$2,100,19,'EUR','2020-01-01','2025-12-31')", [id(7),id(6)]);
  await db.query('INSERT INTO orders VALUES($1,$2)', [id(8),id(9)]);

  const catalogSource = await readFile(new URL('../crates/server/src/routes/order_intake_catalog.rs', import.meta.url), 'utf8');
  const queries = [...catalogSource.matchAll(/"(SELECT[\s\S]*?)"/g)].map(match => match[1]);
  assert.equal(queries.length,3);
  const selected = (await db.query(queries[0],[[id(2),id(1)],true])).rows.map(row => Object.values(row)[0]);
  assert.deepEqual(selected.map(item => item.name_de),['Dermatologie','Urologie']);
  const selectedWork = (await db.query(queries[1],[[id(3)],[id(1)],true])).rows.map(row => Object.values(row)[0]);
  assert.equal(selectedWork[0].duration_hours,15);
  assert.equal(Number(selectedWork[0].min_price_eur),28000);
  assert.deepEqual(selectedWork[0].specialization_ids,[id(1)]);
  assert.deepEqual(selectedWork[0].descriptions.map(item => item.body),['Current description']);
  assert.equal((await db.query(queries[1],[[id(3)],[id(2)],true])).rows.length,0,'Work type must belong to a selected specialization');
  await db.query('UPDATE medical_specialization_work_types SET is_active=false WHERE id=$1',[id(3)]);
  assert.equal((await db.query(queries[1],[[id(3)],[id(1)],true])).rows.length,0);
  assert.equal((await db.query(queries[1],[[id(3)],[id(1)],false])).rows.length,1,'Inactive work can remain in a draft but cannot be prepared');
  assert.equal((await db.query(queries[2],[[id(6),id(6)]])).rows.length,1);

  const intakeSource = await readFile(new URL('../crates/server/src/routes/order_intakes.rs', import.meta.url), 'utf8');
  const priceSql = intakeSource.match(/"(SELECT EXISTS\(SELECT 1 FROM agency_service_price_versions[\s\S]*?)"/)[1];
  assert.equal(Object.values((await db.query(priceSql,[id(7),id(6),100,19])).rows[0])[0],true,'Explicit historical price remains selectable');
  assert.equal(Object.values((await db.query(priceSql,[id(7),id(6),99,19])).rows[0])[0],false,'Tariff amount cannot be changed');
  assert.equal(Object.values((await db.query(priceSql,[id(7),id(2),100,19])).rows[0])[0],false,'Tariff must belong to its service');
  const insertSql = intakeSource.match(/"(INSERT INTO order_leistungen[\s\S]*?RETURNING id)"/)[1];
  const values = [id(8),'Coordination',2,100,19,'line-1',id(6),id(7),'From 14.09.2026'];
  const first = (await db.query(insertSql,values)).rows[0].id;
  values[2]=3; values[8]='From 15.09.2026';
  assert.equal((await db.query(insertSql,values)).rows[0].id,first,'Prepare updates the existing service');
  const saved = (await db.query('SELECT * FROM order_leistungen')).rows;
  assert.equal(saved.length,1); assert.equal(saved[0].notes,'From 15.09.2026'); assert.equal(saved[0].patient_id,id(9));
  console.log('Order intake SQL passed: selection, active/deleted catalogs, historical tariff validation, persisted descriptions and idempotent preparation.');
} finally { await db.close(); }
