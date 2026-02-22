# HVAC Construction Dataset - Data Relationships

This document defines the relationships between all data entities in the HVAC construction dataset for database schema design.

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    HVAC CONSTRUCTION DATABASE                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│    CONTRACTS     │ ◄──────────────────── Central Entity (Parent)
│──────────────────│
│ PK: project_id   │
└────────┬─────────┘
         │
         │ 1:N
         ▼
┌──────────────────┐       ┌──────────────────┐
│       SOV        │       │   SOV_BUDGET     │
│──────────────────│       │──────────────────│
│ PK: sov_line_id  │ ◄────►│ PK: sov_line_id  │ (1:1)
│ FK: project_id   │       │ FK: project_id   │
└────────┬─────────┘       └──────────────────┘
         │
         │ Referenced by (N:1)
         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │   LABOR_LOGS     │  │MATERIAL_DELIVERIES│  │BILLING_LINE_ITEMS│         │
│  │──────────────────│  │──────────────────│  │──────────────────│          │
│  │ PK: log_id       │  │ PK: delivery_id  │  │ PK: (composite)  │          │
│  │ FK: project_id   │  │ FK: project_id   │  │ FK: sov_line_id  │          │
│  │ FK: sov_line_id  │  │ FK: sov_line_id  │  │ FK: project_id   │          │
│  └──────────────────┘  └──────────────────┘  │ FK: app_number   │          │
│                                               └──────────────────┘          │
└────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐       ┌──────────────────┐
│  CHANGE_ORDERS   │──────►│      RFIS        │ (N:0..1 - optional link)
│──────────────────│       │──────────────────│
│ PK: co_number    │       │ PK: rfi_number   │
│ FK: project_id   │       │ FK: project_id   │
│ FK: related_rfi  │───────│ (rfi_number)     │
│ affected_sov_lines│      └──────────────────┘
└──────────────────┘

┌──────────────────┐       ┌──────────────────┐
│ BILLING_HISTORY  │ 1:N   │BILLING_LINE_ITEMS│
│──────────────────│──────►│──────────────────│
│ PK: (composite)  │       │ (see above)      │
│ FK: project_id   │       │                  │
└──────────────────┘       └──────────────────┘

┌──────────────────┐
│   FIELD_NOTES    │ (Standalone - links to project only)
│──────────────────│
│ PK: note_id      │
│ FK: project_id   │
└──────────────────┘

┌──────────────────────────┐
│ SCOPE_CREEP_CANDIDATES   │ (Derived from field notes - margin leak detection)
│──────────────────────────│
│ PK: scope_id             │
│ FK: project_id           │
│ estimated_labor_hours    │
│ estimated_material_cost  │
│ co_status                │ (not_submitted/pending/absorbed/awaiting_approval)
│ responsibility           │ (owner/gc/architect/vendor/tbd/self_absorbed)
└──────────────────────────┘
```

---

## Table Definitions

### 1. CONTRACTS (Master Table)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `project_id` | VARCHAR(12) | **PRIMARY KEY** | Unique project identifier (PRJ-YYYY-NNN) |
| `project_name` | VARCHAR(100) | NOT NULL | Full project name |
| `original_contract_value` | DECIMAL(15,2) | NOT NULL | Base contract amount (USD) |
| `contract_date` | DATE | NOT NULL | Contract execution date |
| `substantial_completion_date` | DATE | NOT NULL | Target completion date |
| `retention_pct` | DECIMAL(4,3) | NOT NULL | Retention percentage (0.10 = 10%) |
| `payment_terms` | VARCHAR(20) | NOT NULL | Payment terms (e.g., "Net 30") |
| `gc_name` | VARCHAR(50) | NOT NULL | General Contractor name |
| `architect` | VARCHAR(50) | NOT NULL | Architect of record |
| `engineer_of_record` | VARCHAR(50) | NOT NULL | MEP Engineer |

**Relationships:**
- Parent to all other tables via `project_id`

---

### 2. SOV (Schedule of Values)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `sov_line_id` | VARCHAR(25) | **PRIMARY KEY** | Unique SOV line identifier |
| `project_id` | VARCHAR(12) | **FOREIGN KEY** → contracts | Links to project |
| `line_number` | INT | NOT NULL | SOV line number (1-15) |
| `description` | VARCHAR(100) | NOT NULL | Work description |
| `scheduled_value` | DECIMAL(15,2) | NOT NULL | Dollar value for this line |
| `labor_pct` | DECIMAL(5,4) | NOT NULL | Labor percentage (0.0-1.0) |
| `material_pct` | DECIMAL(5,4) | NOT NULL | Material percentage (0.0-1.0) |

**Relationships:**
- `project_id` → contracts.project_id (N:1)
- Referenced by: labor_logs, material_deliveries, billing_line_items, sov_budget

**Business Rule:** SUM(scheduled_value) WHERE project_id = X must equal contracts.original_contract_value

---

### 3. SOV_BUDGET (Bid Estimates)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `sov_line_id` | VARCHAR(25) | **PRIMARY KEY / FOREIGN KEY** → sov | Links to SOV line |
| `project_id` | VARCHAR(12) | **FOREIGN KEY** → contracts | Links to project |
| `estimated_labor_hours` | INT | NOT NULL | Budgeted labor hours |
| `estimated_labor_cost` | DECIMAL(12,2) | NOT NULL | Budgeted labor cost |
| `estimated_material_cost` | DECIMAL(12,2) | NOT NULL | Budgeted material cost |
| `estimated_equipment_cost` | DECIMAL(12,2) | NOT NULL | Budgeted equipment cost |
| `estimated_sub_cost` | DECIMAL(12,2) | NOT NULL | Budgeted subcontractor cost |
| `productivity_factor` | DECIMAL(4,2) | NOT NULL | Productivity multiplier |
| `key_assumptions` | TEXT | | Bid assumptions |

**Relationships:**
- `sov_line_id` → sov.sov_line_id (1:1)
- `project_id` → contracts.project_id (N:1)

---

### 4. LABOR_LOGS

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `log_id` | VARCHAR(10) | **PRIMARY KEY** | Unique entry ID |
| `project_id` | VARCHAR(12) | **FOREIGN KEY** → contracts | Links to project |
| `date` | DATE | NOT NULL | Work date |
| `employee_id` | VARCHAR(10) | NOT NULL | Worker identifier |
| `role` | VARCHAR(30) | NOT NULL | Job classification |
| `sov_line_id` | VARCHAR(25) | **FOREIGN KEY** → sov | Cost-coded to SOV line |
| `hours_st` | DECIMAL(4,1) | NOT NULL | Straight time hours |
| `hours_ot` | DECIMAL(4,1) | NOT NULL | Overtime hours |
| `hourly_rate` | DECIMAL(6,2) | NOT NULL | Base hourly rate (USD) |
| `burden_multiplier` | DECIMAL(4,2) | NOT NULL | Burden rate |
| `work_area` | VARCHAR(30) | | Physical location on site |
| `cost_code` | INT | NOT NULL | Maps to SOV line_number |

**Relationships:**
- `project_id` → contracts.project_id (N:1)
- `sov_line_id` → sov.sov_line_id (N:1)

**Derived Column:**
```sql
total_cost = (hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier
```

**Special Pattern - OVR-* Records:**
Labor logs with `log_id` prefix `OVR-*` (125 records) represent overtime/rework entries linked to scope creep issues. These are valid records with unique IDs—not duplicates. Query for margin leak analysis:
```sql
SELECT * FROM labor_logs WHERE log_id LIKE 'OVR-%'
-- 125 records, 1,186 hours, $133,558 total cost
```

---

### 5. MATERIAL_DELIVERIES

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `delivery_id` | VARCHAR(20) | **PRIMARY KEY** | Unique delivery ID |
| `project_id` | VARCHAR(12) | **FOREIGN KEY** → contracts | Links to project |
| `date` | DATE | NOT NULL | Delivery date |
| `sov_line_id` | VARCHAR(25) | **FOREIGN KEY** → sov | Cost-coded to SOV line |
| `material_category` | VARCHAR(20) | NOT NULL | Category |
| `item_description` | VARCHAR(100) | NOT NULL | Specific material item |
| `quantity` | INT | NOT NULL | Quantity received |
| `unit` | VARCHAR(10) | NOT NULL | Unit of measure |
| `unit_cost` | DECIMAL(12,2) | NOT NULL | Cost per unit |
| `total_cost` | DECIMAL(12,2) | NOT NULL | Total delivery cost |
| `po_number` | VARCHAR(15) | NOT NULL | Purchase order reference |
| `vendor` | VARCHAR(50) | NOT NULL | Supplier name |
| `received_by` | VARCHAR(30) | NOT NULL | Person who received delivery |
| `condition_notes` | TEXT | | Receiving notes |

**Relationships:**
- `project_id` → contracts.project_id (N:1)
- `sov_line_id` → sov.sov_line_id (N:1)

---

### 6. CHANGE_ORDERS

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `project_id` | VARCHAR(12) | **PRIMARY KEY (composite)**, FK → contracts | Links to project |
| `co_number` | VARCHAR(10) | **PRIMARY KEY (composite)** | Change order number |
| `date_submitted` | DATE | NOT NULL | Submission date |
| `reason_category` | VARCHAR(30) | NOT NULL | Category |
| `description` | TEXT | NOT NULL | Detailed description |
| `amount` | DECIMAL(12,2) | NOT NULL | Dollar amount (+/-) |
| `status` | VARCHAR(15) | NOT NULL | Approved/Rejected/Pending |
| `related_rfi` | VARCHAR(10) | **FOREIGN KEY** → rfis (NULLABLE) | Associated RFI |
| `affected_sov_lines` | TEXT | | JSON array of sov_line_ids |
| `labor_hours_impact` | INT | | Estimated labor hour change |
| `schedule_impact_days` | INT | | Schedule impact in days |
| `submitted_by` | VARCHAR(30) | NOT NULL | Person who submitted |
| `approved_by` | VARCHAR(30) | NULLABLE | Approver (if approved) |

**Relationships:**
- `project_id` → contracts.project_id (N:1)
- `related_rfi` → rfis.rfi_number (N:0..1) - Optional relationship

**Special Handling:**
- `affected_sov_lines` contains a JSON array of `sov_line_id` values
- For normalized DB, create junction table: `change_order_sov_lines`

---

### 7. RFIS (Requests for Information)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `project_id` | VARCHAR(12) | **PRIMARY KEY (composite)**, FK → contracts | Links to project |
| `rfi_number` | VARCHAR(10) | **PRIMARY KEY (composite)** | RFI number (unique per project) |
| `date_submitted` | DATE | NOT NULL | Submission date |
| `subject` | TEXT | NOT NULL | Question/issue description |
| `submitted_by` | VARCHAR(50) | NOT NULL | Person who submitted |
| `assigned_to` | VARCHAR(50) | NOT NULL | Responsible party |
| `priority` | VARCHAR(10) | NOT NULL | Low/Medium/High/Critical |
| `status` | VARCHAR(20) | NOT NULL | Open/Pending Response/Closed |
| `date_required` | DATE | NOT NULL | Date response needed |
| `date_responded` | DATE | NULLABLE | Actual response date |
| `response_summary` | TEXT | NULLABLE | Summary of response |
| `cost_impact` | BOOLEAN | NOT NULL | Has cost impact |
| `schedule_impact` | BOOLEAN | NOT NULL | Has schedule impact |

**Relationships:**
- `project_id` → contracts.project_id (N:1)
- Referenced by: change_orders.(project_id, related_rfi) (0..1:N)

---

### 8. FIELD_NOTES

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `note_id` | VARCHAR(10) | **PRIMARY KEY** | Unique note ID |
| `project_id` | VARCHAR(12) | **FOREIGN KEY** → contracts | Links to project |
| `date` | DATE | NOT NULL | Report date |
| `author` | VARCHAR(30) | NOT NULL | Author name |
| `note_type` | VARCHAR(20) | NOT NULL | Type of note |
| `content` | TEXT | NOT NULL | Unstructured field note |
| `photos_attached` | INT | NOT NULL | Number of photos |
| `weather` | VARCHAR(20) | | Weather conditions |
| `temp_high` | INT | | High temperature (°F) |
| `temp_low` | INT | | Low temperature (°F) |

**Relationships:**
- `project_id` → contracts.project_id (N:1)

---

### 9. BILLING_HISTORY

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `project_id` | VARCHAR(12) | **PRIMARY KEY (composite)**, FK → contracts | Links to project |
| `application_number` | INT | **PRIMARY KEY (composite)** | Pay app number |
| `period_end` | DATE | NOT NULL | Billing period end date |
| `period_total` | DECIMAL(12,2) | NOT NULL | Total billed this period |
| `cumulative_billed` | DECIMAL(12,2) | NOT NULL | Total billed to date |
| `retention_held` | DECIMAL(12,2) | NOT NULL | Retention amount held |
| `net_payment_due` | DECIMAL(12,2) | NOT NULL | Net amount payable |
| `status` | VARCHAR(15) | NOT NULL | Pending/Approved/Paid |
| `payment_date` | DATE | NULLABLE | Date payment received |
| `line_item_count` | INT | NOT NULL | Number of SOV lines billed |

**Relationships:**
- `project_id` → contracts.project_id (N:1)
- Referenced by: billing_line_items (1:N)

---

### 10. BILLING_LINE_ITEMS

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `sov_line_id` | VARCHAR(25) | **PRIMARY KEY (composite)**, FK → sov | SOV line reference |
| `project_id` | VARCHAR(12) | **PRIMARY KEY (composite)**, FK → contracts | Links to project |
| `application_number` | INT | **PRIMARY KEY (composite)**, FK → billing_history | Pay app number |
| `description` | VARCHAR(100) | NOT NULL | Line description |
| `scheduled_value` | DECIMAL(12,2) | NOT NULL | Total scheduled value |
| `previous_billed` | DECIMAL(12,2) | NOT NULL | Previously billed amount |
| `this_period` | DECIMAL(12,2) | NOT NULL | Current period billing |
| `total_billed` | DECIMAL(12,2) | NOT NULL | Cumulative billed |
| `pct_complete` | DECIMAL(5,2) | NOT NULL | Percentage complete |
| `balance_to_finish` | DECIMAL(12,2) | NOT NULL | Remaining value |

**Relationships:**
- `sov_line_id` → sov.sov_line_id (N:1)
- `(project_id, application_number)` → billing_history (N:1)

---

### 11. SCOPE_CREEP_CANDIDATES (Derived Table)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `scope_id` | VARCHAR(10) | **PRIMARY KEY** | Unique scope item ID (SCOPE-NNN) |
| `project_id` | VARCHAR(12) | **FOREIGN KEY** → contracts | Links to project |
| `date` | DATE | NOT NULL | Date identified |
| `author` | VARCHAR(30) | NOT NULL | Person who noted issue |
| `note_type` | VARCHAR(20) | NOT NULL | Original note type |
| `estimated_labor_hours` | INT | NOT NULL | Estimated unbilled hours |
| `estimated_material_cost` | DECIMAL(12,2) | NOT NULL | Estimated unbilled materials |
| `approval_status` | VARCHAR(15) | NOT NULL | verbal/written/none/undocumented |
| `co_status` | VARCHAR(20) | NOT NULL | not_submitted/pending/absorbed/awaiting_approval |
| `root_cause` | VARCHAR(20) | NOT NULL | design_conflict/owner_change/gc_coordination/etc |
| `responsibility` | VARCHAR(15) | NOT NULL | owner/gc/architect/vendor/tbd/self_absorbed |
| `description` | TEXT | NOT NULL | Truncated description (200 chars) |
| `full_description` | TEXT | NOT NULL | Complete field note content |

**Relationships:**
- `project_id` → contracts.project_id (N:1)

**Purpose:** Identifies potential margin leaks from unbilled scope changes—work done with verbal approval, no CO submitted, or costs absorbed as "goodwill". Critical for margin rescue agent.

**Key Queries:**
- Total unbilled: `SUM(estimated_labor_hours)` WHERE `co_status = 'not_submitted'`
- Recoverable costs: WHERE `responsibility IN ('owner', 'gc')` AND `co_status = 'not_submitted'`
- Absorbed losses: WHERE `co_status = 'absorbed'`

---

## Relationship Summary

### Cardinality Overview

| Parent | Child | Cardinality | FK Column(s) |
|--------|-------|-------------|--------------|
| contracts | sov | 1:N | project_id |
| contracts | sov_budget | 1:N | project_id |
| contracts | labor_logs | 1:N | project_id |
| contracts | material_deliveries | 1:N | project_id |
| contracts | change_orders | 1:N | project_id |
| contracts | rfis | 1:N | project_id |
| contracts | field_notes | 1:N | project_id |
| contracts | scope_creep_candidates | 1:N | project_id |
| contracts | billing_history | 1:N | project_id |
| sov | sov_budget | 1:1 | sov_line_id |
| sov | labor_logs | 1:N | sov_line_id |
| sov | material_deliveries | 1:N | sov_line_id |
| sov | billing_line_items | 1:N | sov_line_id |
| rfis | change_orders | 0..1:N | (project_id, related_rfi) |
| billing_history | billing_line_items | 1:N | (project_id, application_number) |

### Many-to-Many Relationship

| Table 1 | Table 2 | Junction Table | Description |
|---------|---------|----------------|-------------|
| change_orders | sov | change_order_sov_lines | COs can affect multiple SOV lines |

---

## Junction Table for Normalization

### CHANGE_ORDER_SOV_LINES

```sql
CREATE TABLE change_order_sov_lines (
    project_id VARCHAR(12) NOT NULL,
    co_number VARCHAR(10) NOT NULL,
    sov_line_id VARCHAR(25) NOT NULL,
    PRIMARY KEY (project_id, co_number, sov_line_id),
    FOREIGN KEY (project_id, co_number) REFERENCES change_orders(project_id, co_number),
    FOREIGN KEY (sov_line_id) REFERENCES sov(sov_line_id)
);
```

**Population Script:**
```python
import ast
import pandas as pd

co = pd.read_csv('change_orders.csv')
junction_rows = []

for _, row in co.iterrows():
    if pd.notna(row['affected_sov_lines']):
        sov_lines = ast.literal_eval(row['affected_sov_lines'])
        for sov_line in sov_lines:
            junction_rows.append({
                'project_id': row['project_id'],
                'co_number': row['co_number'],
                'sov_line_id': sov_line
            })

junction_df = pd.DataFrame(junction_rows)
junction_df.to_csv('change_order_sov_lines.csv', index=False)
```

---

## SQL DDL (PostgreSQL)

```sql
-- 1. Contracts (Master)
CREATE TABLE contracts (
    project_id VARCHAR(12) PRIMARY KEY,
    project_name VARCHAR(100) NOT NULL,
    original_contract_value DECIMAL(15,2) NOT NULL,
    contract_date DATE NOT NULL,
    substantial_completion_date DATE NOT NULL,
    retention_pct DECIMAL(4,3) NOT NULL,
    payment_terms VARCHAR(20) NOT NULL,
    gc_name VARCHAR(50) NOT NULL,
    architect VARCHAR(50) NOT NULL,
    engineer_of_record VARCHAR(50) NOT NULL
);

-- 2. SOV
CREATE TABLE sov (
    sov_line_id VARCHAR(25) PRIMARY KEY,
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    line_number INT NOT NULL,
    description VARCHAR(100) NOT NULL,
    scheduled_value DECIMAL(15,2) NOT NULL,
    labor_pct DECIMAL(5,4) NOT NULL,
    material_pct DECIMAL(5,4) NOT NULL,
    UNIQUE (project_id, line_number)
);

-- 3. SOV Budget
CREATE TABLE sov_budget (
    sov_line_id VARCHAR(25) PRIMARY KEY REFERENCES sov(sov_line_id),
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    estimated_labor_hours INT NOT NULL,
    estimated_labor_cost DECIMAL(12,2) NOT NULL,
    estimated_material_cost DECIMAL(12,2) NOT NULL,
    estimated_equipment_cost DECIMAL(12,2) NOT NULL,
    estimated_sub_cost DECIMAL(12,2) NOT NULL,
    productivity_factor DECIMAL(4,2) NOT NULL,
    key_assumptions TEXT
);

-- 4. Labor Logs
CREATE TABLE labor_logs (
    log_id VARCHAR(10) PRIMARY KEY,
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    date DATE NOT NULL,
    employee_id VARCHAR(10) NOT NULL,
    role VARCHAR(30) NOT NULL,
    sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
    hours_st DECIMAL(4,1) NOT NULL,
    hours_ot DECIMAL(4,1) NOT NULL,
    hourly_rate DECIMAL(6,2) NOT NULL,
    burden_multiplier DECIMAL(4,2) NOT NULL,
    work_area VARCHAR(30),
    cost_code INT NOT NULL
);
CREATE INDEX idx_labor_project ON labor_logs(project_id);
CREATE INDEX idx_labor_sov ON labor_logs(sov_line_id);
CREATE INDEX idx_labor_date ON labor_logs(date);

-- 5. Material Deliveries
CREATE TABLE material_deliveries (
    delivery_id VARCHAR(20) PRIMARY KEY,
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    date DATE NOT NULL,
    sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
    material_category VARCHAR(20) NOT NULL,
    item_description VARCHAR(100) NOT NULL,
    quantity INT NOT NULL,
    unit VARCHAR(10) NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL,
    total_cost DECIMAL(12,2) NOT NULL,
    po_number VARCHAR(15) NOT NULL,
    vendor VARCHAR(50) NOT NULL,
    received_by VARCHAR(30) NOT NULL,
    condition_notes TEXT
);
CREATE INDEX idx_material_project ON material_deliveries(project_id);
CREATE INDEX idx_material_sov ON material_deliveries(sov_line_id);

-- 6. RFIs
CREATE TABLE rfis (
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    rfi_number VARCHAR(10) NOT NULL,
    PRIMARY KEY (project_id, rfi_number),
    date_submitted DATE NOT NULL,
    subject TEXT NOT NULL,
    submitted_by VARCHAR(50) NOT NULL,
    assigned_to VARCHAR(50) NOT NULL,
    priority VARCHAR(10) NOT NULL CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('Open', 'Pending Response', 'Closed')),
    date_required DATE NOT NULL,
    date_responded DATE,
    response_summary TEXT,
    cost_impact BOOLEAN NOT NULL,
    schedule_impact BOOLEAN NOT NULL
);
CREATE INDEX idx_rfi_project ON rfis(project_id);
CREATE INDEX idx_rfi_status ON rfis(status);

-- 7. Change Orders
CREATE TABLE change_orders (
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    co_number VARCHAR(10) NOT NULL,
    PRIMARY KEY (project_id, co_number),
    date_submitted DATE NOT NULL,
    reason_category VARCHAR(30) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    -- Data contains all four statuses after recovery of misplaced COs
    status VARCHAR(15) NOT NULL CHECK (status IN ('Pending', 'Under Review', 'Approved', 'Rejected')),
    related_rfi VARCHAR(10),
    FOREIGN KEY (project_id, related_rfi) REFERENCES rfis(project_id, rfi_number),
    labor_hours_impact INT,
    schedule_impact_days INT,
    submitted_by VARCHAR(30) NOT NULL,
    approved_by VARCHAR(30)
);
CREATE INDEX idx_co_project ON change_orders(project_id);
CREATE INDEX idx_co_status ON change_orders(status);

-- 8. Change Order SOV Lines (Junction Table)
CREATE TABLE change_order_sov_lines (
    project_id VARCHAR(12) NOT NULL,
    co_number VARCHAR(10) NOT NULL,
    sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
    PRIMARY KEY (project_id, co_number, sov_line_id),
    FOREIGN KEY (project_id, co_number) REFERENCES change_orders(project_id, co_number)
);

-- 9. Field Notes
CREATE TABLE field_notes (
    note_id VARCHAR(10) PRIMARY KEY,
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    date DATE NOT NULL,
    author VARCHAR(30) NOT NULL,
    note_type VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    photos_attached INT NOT NULL DEFAULT 0,
    weather VARCHAR(20),
    temp_high INT,
    temp_low INT
);
CREATE INDEX idx_notes_project ON field_notes(project_id);
CREATE INDEX idx_notes_date ON field_notes(date);

-- 10. Billing History
CREATE TABLE billing_history (
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    application_number INT NOT NULL,
    period_end DATE NOT NULL,
    period_total DECIMAL(12,2) NOT NULL,
    cumulative_billed DECIMAL(12,2) NOT NULL,
    retention_held DECIMAL(12,2) NOT NULL,
    net_payment_due DECIMAL(12,2) NOT NULL,
    status VARCHAR(15) NOT NULL CHECK (status IN ('Pending', 'Approved', 'Paid')),
    payment_date DATE,
    line_item_count INT NOT NULL,
    PRIMARY KEY (project_id, application_number)
);

-- 11. Billing Line Items
CREATE TABLE billing_line_items (
    sov_line_id VARCHAR(25) NOT NULL REFERENCES sov(sov_line_id),
    project_id VARCHAR(12) NOT NULL,
    application_number INT NOT NULL,
    description VARCHAR(100) NOT NULL,
    scheduled_value DECIMAL(12,2) NOT NULL,
    previous_billed DECIMAL(12,2) NOT NULL,
    this_period DECIMAL(12,2) NOT NULL,
    total_billed DECIMAL(12,2) NOT NULL,
    pct_complete DECIMAL(5,2) NOT NULL,
    balance_to_finish DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (sov_line_id, project_id, application_number),
    FOREIGN KEY (project_id, application_number) 
        REFERENCES billing_history(project_id, application_number)
);
CREATE INDEX idx_billing_items_sov ON billing_line_items(sov_line_id);

-- 12. Scope Creep Candidates (Derived Table for Margin Leak Detection)
CREATE TABLE scope_creep_candidates (
    scope_id VARCHAR(10) PRIMARY KEY,
    project_id VARCHAR(12) NOT NULL REFERENCES contracts(project_id),
    date DATE NOT NULL,
    author VARCHAR(30) NOT NULL,
    note_type VARCHAR(20) NOT NULL,
    estimated_labor_hours INT NOT NULL DEFAULT 0,
    estimated_material_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    approval_status VARCHAR(15) NOT NULL CHECK (approval_status IN ('verbal', 'written', 'none', 'undocumented')),
    co_status VARCHAR(20) NOT NULL CHECK (co_status IN ('not_submitted', 'pending', 'absorbed', 'awaiting_approval')),
    root_cause VARCHAR(20) NOT NULL,
    responsibility VARCHAR(15) NOT NULL CHECK (responsibility IN ('owner', 'gc', 'architect', 'vendor', 'tbd', 'self_absorbed', 'code_compliance')),
    description TEXT NOT NULL,
    full_description TEXT NOT NULL
);
CREATE INDEX idx_scope_project ON scope_creep_candidates(project_id);
CREATE INDEX idx_scope_status ON scope_creep_candidates(co_status);
CREATE INDEX idx_scope_responsibility ON scope_creep_candidates(responsibility);
```

---

## Data Import Order

Due to foreign key dependencies, import tables in this order:

1. `contracts`
2. `sov`
3. `sov_budget`
4. `rfis`
5. `change_orders`
6. `change_order_sov_lines` (generate from affected_sov_lines column)
7. `labor_logs`
8. `material_deliveries`
9. `field_notes`
10. `billing_history`
11. `billing_line_items`
12. `scope_creep_candidates`

---

## Useful Indexes for Agent Queries

```sql
-- For margin analysis (budget vs actual)
CREATE INDEX idx_labor_sov_date ON labor_logs(sov_line_id, date);
CREATE INDEX idx_material_sov_date ON material_deliveries(sov_line_id, date);

-- For change order tracking
CREATE INDEX idx_co_project_status ON change_orders(project_id, status);

-- For billing lag detection
CREATE INDEX idx_billing_project_status ON billing_history(project_id, status);

-- For RFI response time analysis
CREATE INDEX idx_rfi_dates ON rfis(date_submitted, date_responded);

-- Full-text search on field notes
CREATE INDEX idx_notes_content ON field_notes USING gin(to_tsvector('english', content));
```

---

## Visual Summary

```
                                    contracts
                                        │
               ┌────────────────────────┼────────────────────────┐
               │                        │                        │
               ▼                        ▼                        ▼
              sov ◄──────────────► sov_budget              field_notes
               │                                                 │
    ┌──────────┼──────────┐                          (extracted to)
    │          │          │                                      │
    ▼          ▼          ▼                                      ▼
labor_logs  materials  billing_line_items              scope_creep_candidates
                              │                        (margin leak detection)
                              ▼
                        billing_history

        change_orders ──────► rfis
              │
              ▼
    change_order_sov_lines ──► sov
```

---

## Notes for AI Agent Development

1. **Primary Join Path**: contracts → sov → (labor_logs | material_deliveries | billing_line_items)
2. **Cost Calculations**: Always compute from raw data (hours × rate × burden) for accuracy
3. **Change Order Impact**: Parse `affected_sov_lines` JSON to identify impacted work areas
4. **Billing Lag Detection**: Compare actual costs vs `total_billed` at SOV line level
5. **RFI Cost Exposure**: Filter RFIs where `cost_impact = TRUE` and `status != 'Closed'`
6. **Scope Creep Detection**: Query `scope_creep_candidates` for unbilled work (co_status = 'not_submitted')
7. **Margin Leak Priority**: Filter scope_creep_candidates where responsibility = 'owner' or 'gc' for recoverable costs
8. **Rework Labor Identification**: Labor logs with `log_id LIKE 'OVR-%'` are overtime/rework entries (125 records, $133,558 total cost). These correlate to scope_creep_candidates but actual hours (1,186) exceed estimates (492) by 2.4×
