import { sql } from "@/lib/db";

// ---------------------------------------------------------------------------
// 1. Portfolio Summary
// ---------------------------------------------------------------------------

export async function getPortfolioSummary() {
  // Total contract value & project count
  const contractRows = await sql`
    SELECT
      COALESCE(SUM(original_contract_value), 0) AS total_contract_value,
      COUNT(*)::int AS project_count
    FROM contracts
  `;

  // Total bid cost from sov_budget
  const bidRows = await sql`
    SELECT
      COALESCE(SUM(
        estimated_labor_cost
        + estimated_material_cost
        + estimated_equipment_cost
        + estimated_sub_cost
      ), 0) AS total_bid_cost
    FROM sov_budget
  `;

  // Total billed — latest application per project
  const billedRows = await sql`
    SELECT COALESCE(SUM(cumulative_billed), 0) AS total_billed
    FROM billing_history bh
    INNER JOIN (
      SELECT project_id, MAX(application_number) AS max_app
      FROM billing_history
      GROUP BY project_id
    ) latest ON bh.project_id = latest.project_id
              AND bh.application_number = latest.max_app
  `;

  // Actual labor cost from labor_logs
  const laborRows = await sql`
    SELECT COALESCE(SUM(
      (hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier
    ), 0) AS actual_labor_cost
    FROM labor_logs
  `;

  // Actual material cost from material_deliveries
  const materialRows = await sql`
    SELECT COALESCE(SUM(total_cost), 0) AS actual_material_cost
    FROM material_deliveries
  `;

  // At-risk amount from scope_creep_candidates not yet submitted as COs
  const riskRows = await sql`
    SELECT COALESCE(SUM(
      estimated_labor_hours * 85 + estimated_material_cost
    ), 0) AS at_risk_amount
    FROM scope_creep_candidates
    WHERE co_status = 'not_submitted'
  `;

  // Pending change orders
  const coRows = await sql`
    SELECT
      COUNT(*)::int AS pending_cos,
      COALESCE(SUM(amount), 0) AS pending_co_amount
    FROM change_orders
    WHERE status IN ('Pending', 'Under Review')
  `;

  const totalContractValue = Number(contractRows[0].total_contract_value);
  const totalBidCost = Number(bidRows[0].total_bid_cost);
  const totalBilled = Number(billedRows[0].total_billed);
  const actualLaborCost = Number(laborRows[0].actual_labor_cost);
  const actualMaterialCost = Number(materialRows[0].actual_material_cost);
  const totalActualCost = actualLaborCost + actualMaterialCost;

  return {
    totalContractValue,
    totalBidCost,
    bidMargin: totalContractValue !== 0
      ? (totalContractValue - totalBidCost) / totalContractValue
      : 0,
    totalBilled,
    totalActualCost,
    realizedMargin: totalBilled !== 0
      ? (totalBilled - totalActualCost) / totalBilled
      : 0,
    atRiskAmount: Number(riskRows[0].at_risk_amount),
    projectCount: Number(contractRows[0].project_count),
    pendingCOs: Number(coRows[0].pending_cos),
    pendingCOAmount: Number(coRows[0].pending_co_amount),
  };
}

// ---------------------------------------------------------------------------
// 2. Project Summaries
// ---------------------------------------------------------------------------

export async function getProjectSummaries() {
  const rows = await sql`
    SELECT
      c.project_id,
      c.project_name,
      c.original_contract_value,
      c.gc_name,
      c.substantial_completion_date,

      -- Bid cost from sov_budget
      COALESCE(bid.bid_cost, 0) AS bid_cost,

      -- Bid margin %
      CASE
        WHEN c.original_contract_value > 0
        THEN (c.original_contract_value - COALESCE(bid.bid_cost, 0))
              / c.original_contract_value
        ELSE 0
      END AS bid_margin_pct,

      -- Total billed (latest app per project)
      COALESCE(billed.total_billed, 0) AS total_billed,

      -- Actual labor cost
      COALESCE(labor.actual_labor_cost, 0) AS actual_labor_cost,

      -- Actual material cost
      COALESCE(mat.actual_material_cost, 0) AS actual_material_cost,

      -- Realized margin %
      CASE
        WHEN COALESCE(billed.total_billed, 0) > 0
        THEN (
          COALESCE(billed.total_billed, 0)
          - COALESCE(labor.actual_labor_cost, 0)
          - COALESCE(mat.actual_material_cost, 0)
        ) / NULLIF(COALESCE(billed.total_billed, 0), 0)
        ELSE 0
      END AS realized_margin_pct,

      -- Percent complete (avg from latest billing_line_items)
      COALESCE(pct.pct_complete, 0) AS pct_complete,

      -- CO counts
      COALESCE(co_approved.approved_cos, 0)::int  AS approved_cos,
      COALESCE(co_pending.pending_cos, 0)::int     AS pending_cos,

      -- Scope creep count
      COALESCE(sc.scope_creep_count, 0)::int AS scope_creep_count

    FROM contracts c

    -- Bid cost
    LEFT JOIN (
      SELECT
        project_id,
        SUM(estimated_labor_cost + estimated_material_cost
            + estimated_equipment_cost + estimated_sub_cost) AS bid_cost
      FROM sov_budget
      GROUP BY project_id
    ) bid ON bid.project_id = c.project_id

    -- Latest billed amount per project
    LEFT JOIN (
      SELECT bh.project_id, bh.cumulative_billed AS total_billed
      FROM billing_history bh
      INNER JOIN (
        SELECT project_id, MAX(application_number) AS max_app
        FROM billing_history
        GROUP BY project_id
      ) lb ON bh.project_id = lb.project_id AND bh.application_number = lb.max_app
    ) billed ON billed.project_id = c.project_id

    -- Actual labor cost
    LEFT JOIN (
      SELECT
        project_id,
        SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_labor_cost
      FROM labor_logs
      GROUP BY project_id
    ) labor ON labor.project_id = c.project_id

    -- Actual material cost
    LEFT JOIN (
      SELECT project_id, SUM(total_cost) AS actual_material_cost
      FROM material_deliveries
      GROUP BY project_id
    ) mat ON mat.project_id = c.project_id

    -- Pct complete from latest billing_line_items
    LEFT JOIN (
      SELECT
        bli.project_id,
        AVG(bli.pct_complete) AS pct_complete
      FROM billing_line_items bli
      INNER JOIN (
        SELECT project_id, MAX(application_number) AS max_app
        FROM billing_line_items
        GROUP BY project_id
      ) lb ON bli.project_id = lb.project_id AND bli.application_number = lb.max_app
      GROUP BY bli.project_id
    ) pct ON pct.project_id = c.project_id

    -- Approved COs
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS approved_cos
      FROM change_orders
      WHERE status = 'Approved'
      GROUP BY project_id
    ) co_approved ON co_approved.project_id = c.project_id

    -- Pending COs
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS pending_cos
      FROM change_orders
      WHERE status IN ('Pending', 'Under Review')
      GROUP BY project_id
    ) co_pending ON co_pending.project_id = c.project_id

    -- Scope creep count
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS scope_creep_count
      FROM scope_creep_candidates
      GROUP BY project_id
    ) sc ON sc.project_id = c.project_id

    ORDER BY c.project_id
  `;

  return rows;
}

// ---------------------------------------------------------------------------
// 3. Change Order Summary
// ---------------------------------------------------------------------------

export async function getChangeOrderSummary() {
  const rows = await sql`
    SELECT
      c.project_id,
      c.project_name,
      COALESCE(co.total_cos, 0)::int       AS total_cos,
      COALESCE(co.approved_count, 0)::int   AS approved_count,
      COALESCE(co.pending_count, 0)::int    AS pending_count,
      COALESCE(co.rejected_count, 0)::int   AS rejected_count,
      COALESCE(co.approved_amount, 0)       AS approved_amount,
      COALESCE(co.pending_amount, 0)        AS pending_amount
    FROM contracts c
    LEFT JOIN (
      SELECT
        project_id,
        COUNT(*) AS total_cos,
        COUNT(*) FILTER (WHERE status = 'Approved')                    AS approved_count,
        COUNT(*) FILTER (WHERE status IN ('Pending', 'Under Review'))  AS pending_count,
        COUNT(*) FILTER (WHERE status = 'Rejected')                    AS rejected_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'Approved'), 0)                   AS approved_amount,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('Pending', 'Under Review')), 0) AS pending_amount
      FROM change_orders
      GROUP BY project_id
    ) co ON co.project_id = c.project_id
    ORDER BY c.project_id
  `;

  return rows;
}

// ---------------------------------------------------------------------------
// 4. Risk Alerts
// ---------------------------------------------------------------------------

interface RiskAlert {
  type: string;
  severity: "high" | "medium" | "low";
  project_id: string;
  project_name: string;
  message: string;
  amount: number;
}

export async function getRiskAlerts(): Promise<RiskAlert[]> {
  const alerts: RiskAlert[] = [];

  // --- Scope creep risks ---
  const scopeCreepRows = await sql`
    SELECT
      sc.project_id,
      c.project_name,
      COUNT(*)::int AS item_count,
      SUM(sc.estimated_labor_hours * 85 + sc.estimated_material_cost) AS total_amount
    FROM scope_creep_candidates sc
    JOIN contracts c ON c.project_id = sc.project_id
    WHERE sc.co_status = 'not_submitted'
      AND sc.responsibility IN ('owner', 'gc')
    GROUP BY sc.project_id, c.project_name
  `;

  for (const row of scopeCreepRows) {
    const amount = Number(row.total_amount);
    alerts.push({
      type: "scope_creep",
      severity: amount > 50000 ? "high" : "medium",
      project_id: row.project_id,
      project_name: row.project_name,
      message: `${row.item_count} unsubmitted scope creep item(s) totaling $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      amount,
    });
  }

  // --- Labor overrun risks ---
  const laborOverrunRows = await sql`
    SELECT
      c.project_id,
      c.project_name,
      COALESCE(actual.actual_labor_cost, 0) AS actual_labor_cost,
      COALESCE(budget.estimated_labor_cost, 0) AS estimated_labor_cost
    FROM contracts c
    LEFT JOIN (
      SELECT
        project_id,
        SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_labor_cost
      FROM labor_logs
      GROUP BY project_id
    ) actual ON actual.project_id = c.project_id
    LEFT JOIN (
      SELECT project_id, SUM(estimated_labor_cost) AS estimated_labor_cost
      FROM sov_budget
      GROUP BY project_id
    ) budget ON budget.project_id = c.project_id
    WHERE COALESCE(actual.actual_labor_cost, 0) > COALESCE(budget.estimated_labor_cost, 0) * 1.1
  `;

  for (const row of laborOverrunRows) {
    const actual = Number(row.actual_labor_cost);
    const estimated = Number(row.estimated_labor_cost);
    const overrunPct = estimated !== 0 ? (actual - estimated) / estimated : 0;
    const amount = actual - estimated;
    alerts.push({
      type: "labor_overrun",
      severity: overrunPct > 0.2 ? "high" : "medium",
      project_id: row.project_id,
      project_name: row.project_name,
      message: `Labor cost $${actual.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} exceeds budget $${estimated.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} by ${(overrunPct * 100).toFixed(1)}%`,
      amount,
    });
  }

  // --- Billing lag risks ---
  const billingLagRows = await sql`
    SELECT
      c.project_id,
      c.project_name,
      COALESCE(labor.actual_labor_cost, 0) AS actual_labor_cost,
      COALESCE(mat.actual_material_cost, 0) AS actual_material_cost,
      COALESCE(billed.total_billed, 0) AS total_billed
    FROM contracts c
    LEFT JOIN (
      SELECT project_id,
        SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_labor_cost
      FROM labor_logs
      GROUP BY project_id
    ) labor ON labor.project_id = c.project_id
    LEFT JOIN (
      SELECT project_id, SUM(total_cost) AS actual_material_cost
      FROM material_deliveries
      GROUP BY project_id
    ) mat ON mat.project_id = c.project_id
    LEFT JOIN (
      SELECT bh.project_id, bh.cumulative_billed AS total_billed
      FROM billing_history bh
      INNER JOIN (
        SELECT project_id, MAX(application_number) AS max_app
        FROM billing_history
        GROUP BY project_id
      ) lb ON bh.project_id = lb.project_id AND bh.application_number = lb.max_app
    ) billed ON billed.project_id = c.project_id
    WHERE COALESCE(billed.total_billed, 0) > 0
      AND (
        COALESCE(labor.actual_labor_cost, 0)
        + COALESCE(mat.actual_material_cost, 0)
        - COALESCE(billed.total_billed, 0)
      ) / COALESCE(billed.total_billed, 0) > 0.1
  `;

  for (const row of billingLagRows) {
    const actualCost =
      Number(row.actual_labor_cost) + Number(row.actual_material_cost);
    const billed = Number(row.total_billed);
    const lagRatio = billed !== 0 ? (actualCost - billed) / billed : 0;
    const amount = actualCost - billed;
    alerts.push({
      type: "billing_lag",
      severity: lagRatio > 0.2 ? "high" : "medium",
      project_id: row.project_id,
      project_name: row.project_name,
      message: `Costs exceed billing by ${(lagRatio * 100).toFixed(1)}% — actual $${actualCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs billed $${billed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      amount,
    });
  }

  // --- Pending CO risks (>$100k) ---
  const pendingCORows = await sql`
    SELECT
      c.project_id,
      c.project_name,
      COUNT(*)::int AS pending_count,
      SUM(co.amount) AS pending_amount
    FROM change_orders co
    JOIN contracts c ON c.project_id = co.project_id
    WHERE co.status IN ('Pending', 'Under Review')
    GROUP BY c.project_id, c.project_name
    HAVING SUM(co.amount) > 100000
  `;

  for (const row of pendingCORows) {
    const amount = Number(row.pending_amount);
    alerts.push({
      type: "pending_co",
      severity: "high",
      project_id: row.project_id,
      project_name: row.project_name,
      message: `${row.pending_count} pending change order(s) totaling $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      amount,
    });
  }

  // Sort: high severity first, then by amount descending
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  alerts.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.amount - a.amount
  );

  return alerts;
}
