import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

function readCSV(filename: string): Record<string, string>[] {
  const csvPath = path.join(
    __dirname,
    "../../hvac_construction_dataset",
    filename
  );
  const content = fs.readFileSync(csvPath, "utf-8");
  const result = Papa.parse(content, { header: true, skipEmptyLines: true });
  return result.data as Record<string, string>[];
}

function esc(v: string | undefined | null): string {
  if (v === undefined || v === null || v === "") return "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

function num(v: string | undefined | null): string {
  if (v === undefined || v === null || v === "") return "NULL";
  return v;
}

function bool(v: string | undefined | null): string {
  if (!v) return "false";
  return v.toLowerCase() === "true" || v === "1" ? "true" : "false";
}

// Batch INSERT: send multiple rows per query to minimize network round-trips
async function batchInsert(
  table: string,
  columns: string[],
  rows: string[][],
  batchSize = 50
) {
  const colList = columns.join(", ");
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map((r) => `(${r.join(", ")})`).join(",\n");
    await sql.query(`INSERT INTO ${table} (${colList}) VALUES ${values}`);
  }
}

async function execStatements(statements: string[]) {
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (trimmed) await sql.query(trimmed);
  }
}

async function dropAndCreateTables() {
  console.log("Dropping tables...");
  await execStatements([
    "DROP TABLE IF EXISTS change_order_sov_lines CASCADE",
    "DROP TABLE IF EXISTS billing_line_items CASCADE",
    "DROP TABLE IF EXISTS billing_history CASCADE",
    "DROP TABLE IF EXISTS scope_creep_candidates CASCADE",
    "DROP TABLE IF EXISTS field_notes CASCADE",
    "DROP TABLE IF EXISTS material_deliveries CASCADE",
    "DROP TABLE IF EXISTS labor_logs CASCADE",
    "DROP TABLE IF EXISTS change_orders CASCADE",
    "DROP TABLE IF EXISTS rfis CASCADE",
    "DROP TABLE IF EXISTS sov_budget CASCADE",
    "DROP TABLE IF EXISTS sov CASCADE",
    "DROP TABLE IF EXISTS contracts CASCADE",
  ]);

  console.log("Creating tables...");
  await execStatements([
    `CREATE TABLE contracts (
      project_id VARCHAR(12) PRIMARY KEY, project_name VARCHAR(100) NOT NULL,
      original_contract_value DECIMAL(15,2) NOT NULL, contract_date DATE NOT NULL,
      substantial_completion_date DATE NOT NULL, retention_pct DECIMAL(4,3) NOT NULL,
      payment_terms VARCHAR(20) NOT NULL, gc_name VARCHAR(50) NOT NULL,
      architect VARCHAR(50) NOT NULL, engineer_of_record VARCHAR(50) NOT NULL)`,
    `CREATE TABLE sov (
      sov_line_id VARCHAR(25) PRIMARY KEY,
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      line_number INT NOT NULL, description VARCHAR(100) NOT NULL,
      scheduled_value DECIMAL(15,2) NOT NULL, labor_pct DECIMAL(5,4) NOT NULL,
      material_pct DECIMAL(5,4) NOT NULL, UNIQUE (project_id, line_number))`,
    `CREATE TABLE sov_budget (
      sov_line_id VARCHAR(25) PRIMARY KEY REFERENCES sov(sov_line_id),
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      estimated_labor_hours INT NOT NULL, estimated_labor_cost DECIMAL(12,2) NOT NULL,
      estimated_material_cost DECIMAL(12,2) NOT NULL, estimated_equipment_cost DECIMAL(12,2) NOT NULL,
      estimated_sub_cost DECIMAL(12,2) NOT NULL, productivity_factor DECIMAL(4,2) NOT NULL,
      key_assumptions TEXT)`,
    `CREATE TABLE rfis (
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      rfi_number VARCHAR(10) NOT NULL, PRIMARY KEY (project_id, rfi_number),
      date_submitted DATE NOT NULL, subject TEXT NOT NULL,
      submitted_by VARCHAR(50) NOT NULL, assigned_to VARCHAR(50) NOT NULL,
      priority VARCHAR(10) NOT NULL, status VARCHAR(20) NOT NULL,
      date_required DATE NOT NULL, date_responded DATE, response_summary TEXT,
      cost_impact BOOLEAN NOT NULL, schedule_impact BOOLEAN NOT NULL)`,
    `CREATE TABLE change_orders (
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      co_number VARCHAR(10) NOT NULL, PRIMARY KEY (project_id, co_number),
      date_submitted DATE NOT NULL, reason_category VARCHAR(30) NOT NULL,
      description TEXT NOT NULL, amount DECIMAL(12,2) NOT NULL,
      status VARCHAR(15) NOT NULL, related_rfi VARCHAR(10),
      labor_hours_impact INT, schedule_impact_days INT,
      submitted_by VARCHAR(30) NOT NULL, approved_by VARCHAR(30))`,
    `CREATE TABLE change_order_sov_lines (
      project_id VARCHAR(12) NOT NULL, co_number VARCHAR(10) NOT NULL,
      sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
      PRIMARY KEY (project_id, co_number, sov_line_id),
      FOREIGN KEY (project_id, co_number) REFERENCES change_orders(project_id, co_number))`,
    `CREATE TABLE labor_logs (
      log_id VARCHAR(10) PRIMARY KEY,
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      date DATE NOT NULL, employee_id VARCHAR(10) NOT NULL, role VARCHAR(30) NOT NULL,
      sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
      hours_st DECIMAL(4,1) NOT NULL, hours_ot DECIMAL(4,1) NOT NULL,
      hourly_rate DECIMAL(6,2) NOT NULL, burden_multiplier DECIMAL(4,2) NOT NULL,
      work_area VARCHAR(30), cost_code INT NOT NULL)`,
    `CREATE TABLE material_deliveries (
      delivery_id VARCHAR(20) PRIMARY KEY,
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      date DATE NOT NULL, sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
      material_category VARCHAR(20) NOT NULL, item_description VARCHAR(100) NOT NULL,
      quantity INT NOT NULL, unit VARCHAR(10) NOT NULL,
      unit_cost DECIMAL(12,2) NOT NULL, total_cost DECIMAL(12,2) NOT NULL,
      po_number VARCHAR(15) NOT NULL, vendor VARCHAR(50) NOT NULL,
      received_by VARCHAR(30) NOT NULL, condition_notes TEXT)`,
    `CREATE TABLE field_notes (
      note_id VARCHAR(10) PRIMARY KEY,
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      date DATE NOT NULL, author VARCHAR(30) NOT NULL, note_type VARCHAR(20) NOT NULL,
      content TEXT NOT NULL, photos_attached INT NOT NULL DEFAULT 0,
      weather VARCHAR(20), temp_high INT, temp_low INT)`,
    `CREATE TABLE billing_history (
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      application_number INT NOT NULL, period_end DATE NOT NULL,
      period_total DECIMAL(12,2) NOT NULL, cumulative_billed DECIMAL(12,2) NOT NULL,
      retention_held DECIMAL(12,2) NOT NULL, net_payment_due DECIMAL(12,2) NOT NULL,
      status VARCHAR(15) NOT NULL, payment_date DATE, line_item_count INT NOT NULL,
      PRIMARY KEY (project_id, application_number))`,
    `CREATE TABLE billing_line_items (
      sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
      project_id VARCHAR(12) NOT NULL, application_number INT NOT NULL,
      description VARCHAR(100) NOT NULL, scheduled_value DECIMAL(12,2) NOT NULL,
      previous_billed DECIMAL(12,2) NOT NULL, this_period DECIMAL(12,2) NOT NULL,
      total_billed DECIMAL(12,2) NOT NULL, pct_complete DECIMAL(5,2) NOT NULL,
      balance_to_finish DECIMAL(12,2) NOT NULL,
      PRIMARY KEY (sov_line_id, project_id, application_number),
      FOREIGN KEY (project_id, application_number) REFERENCES billing_history(project_id, application_number))`,
    `CREATE TABLE scope_creep_candidates (
      scope_id VARCHAR(10) PRIMARY KEY,
      project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
      date DATE NOT NULL, author VARCHAR(30) NOT NULL, note_type VARCHAR(20) NOT NULL,
      estimated_labor_hours INT NOT NULL DEFAULT 0,
      estimated_material_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      approval_status VARCHAR(15) NOT NULL, co_status VARCHAR(20) NOT NULL,
      root_cause VARCHAR(20) NOT NULL, responsibility VARCHAR(15) NOT NULL,
      description TEXT NOT NULL, full_description TEXT NOT NULL)`,
  ]);
}

async function seedData() {
  // 1. Contracts
  console.log("Seeding contracts...");
  const contracts = readCSV("contracts.csv");
  await batchInsert(
    "contracts",
    [
      "project_id",
      "project_name",
      "original_contract_value",
      "contract_date",
      "substantial_completion_date",
      "retention_pct",
      "payment_terms",
      "gc_name",
      "architect",
      "engineer_of_record",
    ],
    contracts.map((r) => [
      esc(r.project_id),
      esc(r.project_name),
      num(r.original_contract_value),
      esc(r.contract_date),
      esc(r.substantial_completion_date),
      num(r.retention_pct),
      esc(r.payment_terms),
      esc(r.gc_name),
      esc(r.architect),
      esc(r.engineer_of_record),
    ])
  );
  console.log(`  ${contracts.length} contracts`);

  // 2. SOV
  console.log("Seeding sov...");
  const sovData = readCSV("sov.csv");
  await batchInsert(
    "sov",
    [
      "sov_line_id",
      "project_id",
      "line_number",
      "description",
      "scheduled_value",
      "labor_pct",
      "material_pct",
    ],
    sovData.map((r) => [
      esc(r.sov_line_id),
      esc(r.project_id),
      num(r.line_number),
      esc(r.description),
      num(r.scheduled_value),
      num(r.labor_pct),
      num(r.material_pct),
    ])
  );
  console.log(`  ${sovData.length} sov lines`);

  // 3. SOV Budget
  console.log("Seeding sov_budget...");
  const budgets = readCSV("sov_budget.csv");
  await batchInsert(
    "sov_budget",
    [
      "sov_line_id",
      "project_id",
      "estimated_labor_hours",
      "estimated_labor_cost",
      "estimated_material_cost",
      "estimated_equipment_cost",
      "estimated_sub_cost",
      "productivity_factor",
      "key_assumptions",
    ],
    budgets.map((r) => [
      esc(r.sov_line_id),
      esc(r.project_id),
      num(r.estimated_labor_hours),
      num(r.estimated_labor_cost),
      num(r.estimated_material_cost),
      num(r.estimated_equipment_cost),
      num(r.estimated_sub_cost),
      num(r.productivity_factor),
      esc(r.key_assumptions),
    ])
  );
  console.log(`  ${budgets.length} budgets`);

  // 4. RFIs
  console.log("Seeding rfis...");
  const rfis = readCSV("rfis.csv");
  await batchInsert(
    "rfis",
    [
      "project_id",
      "rfi_number",
      "date_submitted",
      "subject",
      "submitted_by",
      "assigned_to",
      "priority",
      "status",
      "date_required",
      "date_responded",
      "response_summary",
      "cost_impact",
      "schedule_impact",
    ],
    rfis.map((r) => [
      esc(r.project_id),
      esc(r.rfi_number),
      esc(r.date_submitted),
      esc(r.subject),
      esc(r.submitted_by),
      esc(r.assigned_to),
      esc(r.priority),
      esc(r.status),
      esc(r.date_required),
      esc(r.date_responded),
      esc(r.response_summary),
      bool(r.cost_impact),
      bool(r.schedule_impact),
    ])
  );
  console.log(`  ${rfis.length} rfis`);

  // 5. Change Orders
  console.log("Seeding change_orders...");
  const cos = readCSV("change_orders.csv");
  await batchInsert(
    "change_orders",
    [
      "project_id",
      "co_number",
      "date_submitted",
      "reason_category",
      "description",
      "amount",
      "status",
      "related_rfi",
      "labor_hours_impact",
      "schedule_impact_days",
      "submitted_by",
      "approved_by",
    ],
    cos.map((r) => [
      esc(r.project_id),
      esc(r.co_number),
      esc(r.date_submitted),
      esc(r.reason_category),
      esc(r.description),
      num(r.amount),
      esc(r.status),
      esc(r.related_rfi),
      num(r.labor_hours_impact),
      num(r.schedule_impact_days),
      esc(r.submitted_by),
      esc(r.approved_by),
    ])
  );
  console.log(`  ${cos.length} change orders`);

  // 5b. Change Order SOV Lines (junction)
  console.log("Seeding change_order_sov_lines...");
  const junctionRows: string[][] = [];
  for (const r of cos) {
    if (r.affected_sov_lines) {
      try {
        const lines = JSON.parse(r.affected_sov_lines.replace(/'/g, '"'));
        for (const sovLineId of lines) {
          junctionRows.push([esc(r.project_id), esc(r.co_number), esc(sovLineId)]);
        }
      } catch {
        // skip
      }
    }
  }
  if (junctionRows.length > 0) {
    await batchInsert(
      "change_order_sov_lines",
      ["project_id", "co_number", "sov_line_id"],
      junctionRows
    );
  }
  console.log(`  ${junctionRows.length} junction rows`);

  // 6. Labor Logs (large table)
  console.log("Seeding labor_logs...");
  const labor = readCSV("labor_logs.csv");
  await batchInsert(
    "labor_logs",
    [
      "log_id",
      "project_id",
      "date",
      "employee_id",
      "role",
      "sov_line_id",
      "hours_st",
      "hours_ot",
      "hourly_rate",
      "burden_multiplier",
      "work_area",
      "cost_code",
    ],
    labor.map((r) => [
      esc(r.log_id),
      esc(r.project_id),
      esc(r.date),
      esc(r.employee_id),
      esc(r.role),
      esc(r.sov_line_id),
      num(r.hours_st),
      num(r.hours_ot),
      num(r.hourly_rate),
      num(r.burden_multiplier),
      esc(r.work_area),
      num(r.cost_code),
    ]),
    100
  );
  console.log(`  ${labor.length} labor logs`);

  // 7. Material Deliveries
  console.log("Seeding material_deliveries...");
  const materials = readCSV("material_deliveries.csv");
  await batchInsert(
    "material_deliveries",
    [
      "delivery_id",
      "project_id",
      "date",
      "sov_line_id",
      "material_category",
      "item_description",
      "quantity",
      "unit",
      "unit_cost",
      "total_cost",
      "po_number",
      "vendor",
      "received_by",
      "condition_notes",
    ],
    materials.map((r) => [
      esc(r.delivery_id),
      esc(r.project_id),
      esc(r.date),
      esc(r.sov_line_id),
      esc(r.material_category),
      esc(r.item_description),
      num(r.quantity),
      esc(r.unit),
      num(r.unit_cost),
      num(r.total_cost),
      esc(r.po_number),
      esc(r.vendor),
      esc(r.received_by),
      esc(r.condition_notes),
    ]),
    100
  );
  console.log(`  ${materials.length} deliveries`);

  // 8. Field Notes
  console.log("Seeding field_notes...");
  const notes = readCSV("field_notes.csv");
  await batchInsert(
    "field_notes",
    [
      "note_id",
      "project_id",
      "date",
      "author",
      "note_type",
      "content",
      "photos_attached",
      "weather",
      "temp_high",
      "temp_low",
    ],
    notes.map((r) => [
      esc(r.note_id),
      esc(r.project_id),
      esc(r.date),
      esc(r.author),
      esc(r.note_type),
      esc(r.content),
      num(r.photos_attached),
      esc(r.weather),
      num(r.temp_high),
      num(r.temp_low),
    ]),
    100
  );
  console.log(`  ${notes.length} field notes`);

  // 9. Billing History
  console.log("Seeding billing_history...");
  const billing = readCSV("billing_history.csv");
  await batchInsert(
    "billing_history",
    [
      "project_id",
      "application_number",
      "period_end",
      "period_total",
      "cumulative_billed",
      "retention_held",
      "net_payment_due",
      "status",
      "payment_date",
      "line_item_count",
    ],
    billing.map((r) => [
      esc(r.project_id),
      num(r.application_number),
      esc(r.period_end),
      num(r.period_total),
      num(r.cumulative_billed),
      num(r.retention_held),
      num(r.net_payment_due),
      esc(r.status),
      esc(r.payment_date),
      num(r.line_item_count),
    ])
  );
  console.log(`  ${billing.length} billing records`);

  // 10. Billing Line Items
  console.log("Seeding billing_line_items...");
  const items = readCSV("billing_line_items.csv");
  await batchInsert(
    "billing_line_items",
    [
      "sov_line_id",
      "project_id",
      "application_number",
      "description",
      "scheduled_value",
      "previous_billed",
      "this_period",
      "total_billed",
      "pct_complete",
      "balance_to_finish",
    ],
    items.map((r) => [
      esc(r.sov_line_id),
      esc(r.project_id),
      num(r.application_number),
      esc(r.description),
      num(r.scheduled_value),
      num(r.previous_billed),
      num(r.this_period),
      num(r.total_billed),
      num(r.pct_complete),
      num(r.balance_to_finish),
    ]),
    100
  );
  console.log(`  ${items.length} billing line items`);

  // 11. Scope Creep Candidates
  console.log("Seeding scope_creep_candidates...");
  const scope = readCSV("scope_creep_candidates.csv");
  await batchInsert(
    "scope_creep_candidates",
    [
      "scope_id",
      "project_id",
      "date",
      "author",
      "note_type",
      "estimated_labor_hours",
      "estimated_material_cost",
      "approval_status",
      "co_status",
      "root_cause",
      "responsibility",
      "description",
      "full_description",
    ],
    scope.map((r) => [
      esc(r.scope_id),
      esc(r.project_id),
      esc(r.date),
      esc(r.author),
      esc(r.note_type),
      num(r.estimated_labor_hours),
      num(r.estimated_material_cost),
      esc(r.approval_status),
      esc(r.co_status),
      esc(r.root_cause),
      esc(r.responsibility),
      esc(r.description),
      esc(r.full_description),
    ])
  );
  console.log(`  ${scope.length} scope creep candidates`);
}

async function createIndexes() {
  console.log("Creating indexes...");
  await execStatements([
    "CREATE INDEX idx_labor_project ON labor_logs(project_id)",
    "CREATE INDEX idx_labor_sov ON labor_logs(sov_line_id)",
    "CREATE INDEX idx_labor_date ON labor_logs(date)",
    "CREATE INDEX idx_labor_sov_date ON labor_logs(sov_line_id, date)",
    "CREATE INDEX idx_material_project ON material_deliveries(project_id)",
    "CREATE INDEX idx_material_sov ON material_deliveries(sov_line_id)",
    "CREATE INDEX idx_co_project ON change_orders(project_id)",
    "CREATE INDEX idx_co_status ON change_orders(status)",
    "CREATE INDEX idx_co_project_status ON change_orders(project_id, status)",
    "CREATE INDEX idx_rfi_project ON rfis(project_id)",
    "CREATE INDEX idx_rfi_status ON rfis(status)",
    "CREATE INDEX idx_notes_project ON field_notes(project_id)",
    "CREATE INDEX idx_notes_date ON field_notes(date)",
    "CREATE INDEX idx_billing_project_status ON billing_history(project_id, status)",
    "CREATE INDEX idx_billing_items_sov ON billing_line_items(sov_line_id)",
    "CREATE INDEX idx_scope_project ON scope_creep_candidates(project_id)",
    "CREATE INDEX idx_scope_status ON scope_creep_candidates(co_status)",
    "CREATE INDEX idx_scope_responsibility ON scope_creep_candidates(responsibility)",
  ]);
}

async function main() {
  console.log("Starting seed (batch mode)...");
  const start = Date.now();
  await dropAndCreateTables();
  await seedData();
  await createIndexes();
  console.log(`Seed complete in ${((Date.now() - start) / 1000).toFixed(1)}s!`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
