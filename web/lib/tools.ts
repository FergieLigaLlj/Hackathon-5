import { tool } from "ai";
import { z } from "zod";
import { sql } from "@/lib/db";

export const tools = {
  queryDatabase: tool({
    description:
      "Execute a read-only SELECT query against the PostgreSQL database. Use ONLY when the specialized tools (getPortfolioOverview, analyzeMargin, etc.) cannot answer the question — e.g., ad-hoc joins, date-range filters, or aggregations not covered elsewhere. Returns raw rows and row count. Non-SELECT statements are rejected.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "A PostgreSQL SELECT query. Must start with SELECT. Use table/column names from the schema: contracts, sov, sov_budget, labor_logs, material_deliveries, change_orders, rfis, field_notes, billing_history, billing_line_items, scope_creep_candidates. Example: 'SELECT project_id, SUM(total_cost) FROM material_deliveries GROUP BY project_id'"
        ),
    }),
    execute: async ({ query }) => {
      const trimmed = query.trim().replace(/;$/, "");
      if (!/^SELECT\b/i.test(trimmed)) {
        return { error: "Only SELECT queries are allowed." };
      }
      const rows = await sql.query(trimmed);
      return { rows, rowCount: rows.length };
    },
  }),

  getPortfolioOverview: tool({
    description:
      "CALL THIS FIRST before any other tool. Returns the portfolio-wide financial snapshot: total contract value, bid cost, bid margin, total billed, actual costs (labor + materials), realized margin, at-risk scope creep amount, project count, and pending change order pipeline. This establishes the baseline context needed for all subsequent analysis.",
    inputSchema: z.object({}),
    execute: async () => {
      const contractRows = await sql`
        SELECT
          COALESCE(SUM(original_contract_value), 0) AS total_contract_value,
          COUNT(*)::int AS project_count
        FROM contracts
      `;

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

      const laborRows = await sql`
        SELECT COALESCE(SUM(
          (hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier
        ), 0) AS actual_labor_cost
        FROM labor_logs
      `;

      const materialRows = await sql`
        SELECT COALESCE(SUM(total_cost), 0) AS actual_material_cost
        FROM material_deliveries
      `;

      const riskRows = await sql`
        SELECT COALESCE(SUM(
          estimated_labor_hours * 85 + estimated_material_cost
        ), 0) AS at_risk_amount
        FROM scope_creep_candidates
        WHERE co_status = 'not_submitted'
      `;

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
        bidMargin:
          totalContractValue !== 0
            ? (totalContractValue - totalBidCost) / totalContractValue
            : 0,
        totalBilled,
        totalActualCost,
        actualLaborCost,
        actualMaterialCost,
        realizedMargin:
          totalBilled !== 0
            ? (totalBilled - totalActualCost) / totalBilled
            : 0,
        atRiskAmount: Number(riskRows[0].at_risk_amount),
        projectCount: Number(contractRows[0].project_count),
        pendingCOs: Number(coRows[0].pending_cos),
        pendingCOAmount: Number(coRows[0].pending_co_amount),
      };
    },
  }),

  getProjectDetails: tool({
    description:
      "Deep-dive into a single project. Returns: contract metadata, latest billing application, actual vs budgeted labor (cost and hours), actual vs budgeted materials, equipment and subcontractor budgets, all change orders, scope creep candidates, and per-SOV billing line items. Use after getPortfolioOverview when a specific project needs investigation.",
    inputSchema: z.object({
      projectId: z
        .string()
        .describe("The project ID, e.g. 'P-101'. Must match a project_id in the contracts table."),
    }),
    execute: async ({ projectId }) => {
      const contractRows = await sql`
        SELECT * FROM contracts WHERE project_id = ${projectId}
      `;

      const billingRows = await sql`
        SELECT *
        FROM billing_history
        WHERE project_id = ${projectId}
        ORDER BY application_number DESC
        LIMIT 1
      `;

      const laborRows = await sql`
        SELECT
          COALESCE(SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier), 0) AS actual_labor_cost,
          COALESCE(SUM(hours_st + hours_ot), 0) AS total_hours
        FROM labor_logs
        WHERE project_id = ${projectId}
      `;

      const budgetRows = await sql`
        SELECT
          COALESCE(SUM(estimated_labor_cost), 0) AS budgeted_labor_cost,
          COALESCE(SUM(estimated_material_cost), 0) AS budgeted_material_cost,
          COALESCE(SUM(estimated_equipment_cost), 0) AS budgeted_equipment_cost,
          COALESCE(SUM(estimated_sub_cost), 0) AS budgeted_sub_cost,
          COALESCE(SUM(estimated_labor_hours), 0) AS budgeted_labor_hours
        FROM sov_budget
        WHERE project_id = ${projectId}
      `;

      const materialRows = await sql`
        SELECT COALESCE(SUM(total_cost), 0) AS actual_material_cost
        FROM material_deliveries
        WHERE project_id = ${projectId}
      `;

      const coRows = await sql`
        SELECT co_number, description, amount, status, reason_category, date_submitted
        FROM change_orders
        WHERE project_id = ${projectId}
        ORDER BY date_submitted DESC
      `;

      const scopeCreepRows = await sql`
        SELECT
          scope_id, description, responsibility,
          co_status, estimated_labor_hours, estimated_material_cost
        FROM scope_creep_candidates
        WHERE project_id = ${projectId}
        ORDER BY co_status, responsibility
      `;

      const billingLineRows = await sql`
        SELECT bli.sov_line_id, s.description AS sov_description,
               bli.pct_complete, bli.total_billed, bli.this_period
        FROM billing_line_items bli
        JOIN sov s ON s.sov_line_id = bli.sov_line_id
        INNER JOIN (
          SELECT project_id, MAX(application_number) AS max_app
          FROM billing_line_items
          GROUP BY project_id
        ) latest ON bli.project_id = latest.project_id AND bli.application_number = latest.max_app
        WHERE bli.project_id = ${projectId}
        ORDER BY s.line_number
      `;

      return {
        contract: contractRows[0] || null,
        latestBilling: billingRows[0] || null,
        labor: {
          actual: Number(laborRows[0].actual_labor_cost),
          budgeted: Number(budgetRows[0].budgeted_labor_cost),
          totalHoursActual: Number(laborRows[0].total_hours),
          totalHoursBudgeted: Number(budgetRows[0].budgeted_labor_hours),
        },
        materials: {
          actual: Number(materialRows[0].actual_material_cost),
          budgeted: Number(budgetRows[0].budgeted_material_cost),
        },
        budget: {
          equipment: Number(budgetRows[0].budgeted_equipment_cost),
          subcontractor: Number(budgetRows[0].budgeted_sub_cost),
        },
        changeOrders: coRows,
        scopeCreepItems: scopeCreepRows,
        billingLineItems: billingLineRows,
      };
    },
  }),

  analyzeMargin: tool({
    description:
      "Compare bid margin vs realized margin to find margin erosion. Without projectId: returns per-project comparison with marginDelta (negative = underperforming). With projectId: breaks down by SOV line item showing which specific line items are bleeding margin, with bid cost, actual cost, billed amount, and variance for each. Use this to answer 'where are we losing money?' and 'which line items are over budget?'",
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "Project ID (e.g. 'P-101') for SOV-line-level breakdown. Omit for portfolio-wide project-by-project comparison."
        ),
    }),
    execute: async ({ projectId }) => {
      if (projectId) {
        const rows = await sql`
          SELECT
            sb.sov_line_id,
            s.description AS sov_description,
            s.scheduled_value,
            (sb.estimated_labor_cost + sb.estimated_material_cost
             + sb.estimated_equipment_cost + sb.estimated_sub_cost) AS bid_cost,
            COALESCE(labor.actual_labor_cost, 0) AS actual_labor_cost,
            COALESCE(mat.actual_material_cost, 0) AS actual_material_cost,
            COALESCE(billed.total_billed, 0) AS total_billed
          FROM sov_budget sb
          JOIN sov s ON s.sov_line_id = sb.sov_line_id
          LEFT JOIN (
            SELECT sov_line_id,
              SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_labor_cost
            FROM labor_logs
            WHERE project_id = ${projectId}
            GROUP BY sov_line_id
          ) labor ON labor.sov_line_id = sb.sov_line_id
          LEFT JOIN (
            SELECT sov_line_id, SUM(total_cost) AS actual_material_cost
            FROM material_deliveries
            WHERE project_id = ${projectId}
            GROUP BY sov_line_id
          ) mat ON mat.sov_line_id = sb.sov_line_id
          LEFT JOIN (
            SELECT sov_line_id, total_billed
            FROM billing_line_items bli
            INNER JOIN (
              SELECT project_id, MAX(application_number) AS max_app
              FROM billing_line_items
              GROUP BY project_id
            ) latest ON bli.project_id = latest.project_id AND bli.application_number = latest.max_app
            WHERE bli.project_id = ${projectId}
          ) billed ON billed.sov_line_id = sb.sov_line_id
          WHERE sb.project_id = ${projectId}
          ORDER BY s.line_number
        `;

        const lines = rows.map((r) => {
          const bidCost = Number(r.bid_cost);
          const scheduledValue = Number(r.scheduled_value);
          const actualCost =
            Number(r.actual_labor_cost) + Number(r.actual_material_cost);
          const billed = Number(r.total_billed);
          return {
            sovLineId: r.sov_line_id,
            description: r.sov_description,
            scheduledValue,
            bidCost,
            bidMargin:
              scheduledValue !== 0
                ? (scheduledValue - bidCost) / scheduledValue
                : 0,
            actualCost,
            actualLaborCost: Number(r.actual_labor_cost),
            actualMaterialCost: Number(r.actual_material_cost),
            billed,
            realizedMargin: billed !== 0 ? (billed - actualCost) / billed : 0,
            variance: bidCost - actualCost,
          };
        });

        return { projectId, lineItems: lines };
      }

      // Portfolio-level margin analysis
      const rows = await sql`
        SELECT
          c.project_id,
          c.project_name,
          c.original_contract_value,
          COALESCE(bid.bid_cost, 0) AS bid_cost,
          COALESCE(labor.actual_labor_cost, 0) AS actual_labor_cost,
          COALESCE(mat.actual_material_cost, 0) AS actual_material_cost,
          COALESCE(billed.total_billed, 0) AS total_billed
        FROM contracts c
        LEFT JOIN (
          SELECT project_id,
            SUM(estimated_labor_cost + estimated_material_cost
                + estimated_equipment_cost + estimated_sub_cost) AS bid_cost
          FROM sov_budget
          GROUP BY project_id
        ) bid ON bid.project_id = c.project_id
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
        ORDER BY c.project_id
      `;

      const projects = rows.map((r) => {
        const contractValue = Number(r.original_contract_value);
        const bidCost = Number(r.bid_cost);
        const actualCost =
          Number(r.actual_labor_cost) + Number(r.actual_material_cost);
        const billed = Number(r.total_billed);
        return {
          projectId: r.project_id,
          projectName: r.project_name,
          contractValue,
          bidCost,
          bidMargin:
            contractValue !== 0
              ? (contractValue - bidCost) / contractValue
              : 0,
          actualCost,
          billed,
          realizedMargin: billed !== 0 ? (billed - actualCost) / billed : 0,
          marginDelta:
            contractValue !== 0 && billed !== 0
              ? (billed - actualCost) / billed -
                (contractValue - bidCost) / contractValue
              : 0,
        };
      });

      return { projects };
    },
  }),

  detectBillingLag: tool({
    description:
      "Find projects where actual costs (labor + materials) exceed cumulative billed amounts. This indicates Morrison is financing the work and there is a cash flow risk. Optionally filter by projectId.",
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "Optional project ID. If omitted, checks all projects for billing lag."
        ),
    }),
    execute: async ({ projectId }) => {
      if (projectId) {
        const rows = await sql`
          SELECT
            s.sov_line_id,
            s.description AS sov_description,
            COALESCE(labor.actual_labor_cost, 0) AS actual_labor_cost,
            COALESCE(mat.actual_material_cost, 0) AS actual_material_cost,
            COALESCE(billed.total_billed, 0) AS total_billed
          FROM sov s
          LEFT JOIN (
            SELECT sov_line_id,
              SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_labor_cost
            FROM labor_logs
            WHERE project_id = ${projectId}
            GROUP BY sov_line_id
          ) labor ON labor.sov_line_id = s.sov_line_id
          LEFT JOIN (
            SELECT sov_line_id, SUM(total_cost) AS actual_material_cost
            FROM material_deliveries
            WHERE project_id = ${projectId}
            GROUP BY sov_line_id
          ) mat ON mat.sov_line_id = s.sov_line_id
          LEFT JOIN (
            SELECT sov_line_id, total_billed
            FROM billing_line_items bli
            INNER JOIN (
              SELECT project_id, MAX(application_number) AS max_app
              FROM billing_line_items
              GROUP BY project_id
            ) latest ON bli.project_id = latest.project_id AND bli.application_number = latest.max_app
            WHERE bli.project_id = ${projectId}
          ) billed ON billed.sov_line_id = s.sov_line_id
          WHERE s.project_id = ${projectId}
          ORDER BY s.line_number
        `;

        const lines = rows.map((r) => {
          const actualCost =
            Number(r.actual_labor_cost) + Number(r.actual_material_cost);
          const billed = Number(r.total_billed);
          return {
            sovLineId: r.sov_line_id,
            description: r.sov_description,
            actualCost,
            actualLaborCost: Number(r.actual_labor_cost),
            actualMaterialCost: Number(r.actual_material_cost),
            billed,
            lag: actualCost - billed,
            lagPct: billed !== 0 ? (actualCost - billed) / billed : 0,
          };
        });

        const totalLag = lines.reduce((sum, l) => sum + l.lag, 0);
        return { projectId, lineItems: lines, totalBillingLag: totalLag };
      }

      // All projects
      const rows = await sql`
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
        ORDER BY c.project_id
      `;

      const projects = rows.map((r) => {
        const actualCost =
          Number(r.actual_labor_cost) + Number(r.actual_material_cost);
        const billed = Number(r.total_billed);
        return {
          projectId: r.project_id,
          projectName: r.project_name,
          actualCost,
          billed,
          lag: actualCost - billed,
          lagPct: billed !== 0 ? (actualCost - billed) / billed : 0,
        };
      });

      return { projects };
    },
  }),

  detectScopeCreep: tool({
    description:
      "Query scope_creep_candidates to find out-of-scope work. Shows recoverable costs (responsibility is owner or gc with co_status = not_submitted), absorbed costs (responsibility is morrison), and pending items. Optionally filter by projectId.",
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "Optional project ID. If omitted, checks all projects for scope creep."
        ),
    }),
    execute: async ({ projectId }) => {
      let rows;
      if (projectId) {
        rows = await sql`
          SELECT
            sc.scope_id, sc.project_id,
            sc.description, sc.responsibility, sc.co_status,
            sc.estimated_labor_hours, sc.estimated_material_cost,
            (sc.estimated_labor_hours * 85 + sc.estimated_material_cost) AS estimated_total_cost,
            c.project_name
          FROM scope_creep_candidates sc
          JOIN contracts c ON c.project_id = sc.project_id
          WHERE sc.project_id = ${projectId}
          ORDER BY sc.co_status, sc.responsibility
        `;
      } else {
        rows = await sql`
          SELECT
            sc.scope_id, sc.project_id,
            sc.description, sc.responsibility, sc.co_status,
            sc.estimated_labor_hours, sc.estimated_material_cost,
            (sc.estimated_labor_hours * 85 + sc.estimated_material_cost) AS estimated_total_cost,
            c.project_name
          FROM scope_creep_candidates sc
          JOIN contracts c ON c.project_id = sc.project_id
          ORDER BY sc.project_id, sc.co_status, sc.responsibility
        `;
      }

      const items = rows.map((r) => ({
        scopeId: r.scope_id,
        projectId: r.project_id,
        projectName: r.project_name,
        description: r.description,
        responsibility: r.responsibility,
        coStatus: r.co_status,
        estimatedLaborHours: Number(r.estimated_labor_hours),
        estimatedMaterialCost: Number(r.estimated_material_cost),
        estimatedTotalCost: Number(r.estimated_total_cost),
      }));

      const recoverableItems = items.filter(
        (i) =>
          (i.responsibility === "owner" || i.responsibility === "gc") &&
          i.coStatus === "not_submitted"
      );
      const absorbedItems = items.filter(
        (i) => i.coStatus === "absorbed" || i.responsibility === "self_absorbed"
      );
      const pendingItems = items.filter((i) => i.coStatus === "pending" || i.coStatus === "awaiting_approval");

      const recoverableTotal = recoverableItems.reduce(
        (sum, i) => sum + i.estimatedTotalCost,
        0
      );
      const absorbedTotal = absorbedItems.reduce(
        (sum, i) => sum + i.estimatedTotalCost,
        0
      );
      const pendingTotal = pendingItems.reduce(
        (sum, i) => sum + i.estimatedTotalCost,
        0
      );

      return {
        allItems: items,
        summary: {
          totalItems: items.length,
          recoverableCount: recoverableItems.length,
          recoverableTotal,
          absorbedCount: absorbedItems.length,
          absorbedTotal,
          pendingCount: pendingItems.length,
          pendingTotal,
        },
      };
    },
  }),

  analyzeLaborOverruns: tool({
    description:
      "Compare actual labor hours and cost vs budgeted amounts from sov_budget per SOV line. Flags lines where actual exceeds budget by more than 10%. Optionally filter by projectId.",
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "Optional project ID. If omitted, analyzes all projects for labor overruns."
        ),
    }),
    execute: async ({ projectId }) => {
      let rows;
      if (projectId) {
        rows = await sql`
          SELECT
            sb.sov_line_id,
            s.description AS sov_description,
            sb.estimated_labor_hours AS budgeted_hours,
            sb.estimated_labor_cost AS budgeted_cost,
            COALESCE(labor.actual_hours, 0) AS actual_hours,
            COALESCE(labor.actual_cost, 0) AS actual_cost,
            c.project_id,
            c.project_name
          FROM sov_budget sb
          JOIN sov s ON s.sov_line_id = sb.sov_line_id
          JOIN contracts c ON c.project_id = sb.project_id
          LEFT JOIN (
            SELECT
              sov_line_id,
              SUM(hours_st + hours_ot) AS actual_hours,
              SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_cost
            FROM labor_logs
            WHERE project_id = ${projectId}
            GROUP BY sov_line_id
          ) labor ON labor.sov_line_id = sb.sov_line_id
          WHERE sb.project_id = ${projectId}
          ORDER BY s.line_number
        `;
      } else {
        rows = await sql`
          SELECT
            sb.sov_line_id,
            s.description AS sov_description,
            sb.estimated_labor_hours AS budgeted_hours,
            sb.estimated_labor_cost AS budgeted_cost,
            COALESCE(labor.actual_hours, 0) AS actual_hours,
            COALESCE(labor.actual_cost, 0) AS actual_cost,
            c.project_id,
            c.project_name
          FROM sov_budget sb
          JOIN sov s ON s.sov_line_id = sb.sov_line_id
          JOIN contracts c ON c.project_id = sb.project_id
          LEFT JOIN (
            SELECT
              sov_line_id,
              project_id,
              SUM(hours_st + hours_ot) AS actual_hours,
              SUM((hours_st + hours_ot * 1.5) * hourly_rate * burden_multiplier) AS actual_cost
            FROM labor_logs
            GROUP BY sov_line_id, project_id
          ) labor ON labor.sov_line_id = sb.sov_line_id
                 AND labor.project_id = sb.project_id
          ORDER BY c.project_id, s.line_number
        `;
      }

      const lines = rows.map((r) => {
        const budgetedHours = Number(r.budgeted_hours);
        const budgetedCost = Number(r.budgeted_cost);
        const actualHours = Number(r.actual_hours);
        const actualCost = Number(r.actual_cost);
        return {
          projectId: r.project_id,
          projectName: r.project_name,
          sovLineId: r.sov_line_id,
          description: r.sov_description,
          budgetedHours,
          actualHours,
          hoursVariance: actualHours - budgetedHours,
          hoursOverrunPct:
            budgetedHours !== 0
              ? (actualHours - budgetedHours) / budgetedHours
              : 0,
          budgetedCost,
          actualCost,
          costVariance: actualCost - budgetedCost,
          costOverrunPct:
            budgetedCost !== 0
              ? (actualCost - budgetedCost) / budgetedCost
              : 0,
          flagged: actualCost > budgetedCost * 1.1,
        };
      });

      const flaggedLines = lines.filter((l) => l.flagged);

      return {
        allLines: lines,
        flaggedCount: flaggedLines.length,
        flaggedLines,
        totalOverrunAmount: flaggedLines.reduce(
          (sum, l) => sum + l.costVariance,
          0
        ),
      };
    },
  }),

  analyzeChangeOrders: tool({
    description:
      "Show the change order pipeline: pending, approved, and rejected COs with dollar amounts and reason categories. Optionally filter by projectId.",
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe(
          "Optional project ID. If omitted, shows CO pipeline for all projects."
        ),
    }),
    execute: async ({ projectId }) => {
      let rows;
      if (projectId) {
        rows = await sql`
          SELECT
            co.co_number, co.project_id, c.project_name,
            co.description, co.amount, co.status, co.reason_category,
            co.date_submitted
          FROM change_orders co
          JOIN contracts c ON c.project_id = co.project_id
          WHERE co.project_id = ${projectId}
          ORDER BY co.date_submitted DESC
        `;
      } else {
        rows = await sql`
          SELECT
            co.co_number, co.project_id, c.project_name,
            co.description, co.amount, co.status, co.reason_category,
            co.date_submitted
          FROM change_orders co
          JOIN contracts c ON c.project_id = co.project_id
          ORDER BY co.project_id, co.date_submitted DESC
        `;
      }

      const changeOrders = rows.map((r) => ({
        coId: r.co_number,
        projectId: r.project_id,
        projectName: r.project_name,
        description: r.description,
        amount: Number(r.amount),
        status: r.status,
        reason: r.reason_category,
        submittedDate: r.date_submitted,
      }));

      const approved = changeOrders.filter((co) => co.status === "Approved");
      const pending = changeOrders.filter(
        (co) => co.status === "Pending" || co.status === "Under Review"
      );
      const rejected = changeOrders.filter((co) => co.status === "Rejected");

      const reasonSummary: Record<string, { count: number; totalAmount: number }> = {};
      for (const co of changeOrders) {
        const reason = co.reason || "Unknown";
        if (!reasonSummary[reason]) {
          reasonSummary[reason] = { count: 0, totalAmount: 0 };
        }
        reasonSummary[reason].count++;
        reasonSummary[reason].totalAmount += co.amount;
      }

      return {
        changeOrders,
        summary: {
          total: changeOrders.length,
          approvedCount: approved.length,
          approvedAmount: approved.reduce((sum, co) => sum + co.amount, 0),
          pendingCount: pending.length,
          pendingAmount: pending.reduce((sum, co) => sum + co.amount, 0),
          rejectedCount: rejected.length,
          rejectedAmount: rejected.reduce((sum, co) => sum + co.amount, 0),
        },
        reasonSummary,
      };
    },
  }),

  getFieldNotes: tool({
    description:
      "Search field notes by project, content keyword, or note type. Useful for finding on-site observations, issues, delays, and safety concerns that may explain financial variances.",
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe("Optional project ID to filter field notes."),
      search: z
        .string()
        .optional()
        .describe(
          "Optional keyword to search in note content using case-insensitive matching."
        ),
      noteType: z
        .string()
        .optional()
        .describe(
          "Optional note_type filter, e.g. 'delay', 'issue', 'safety', 'progress'."
        ),
    }),
    execute: async ({ projectId, search, noteType }) => {
      // Build query based on provided filters
      if (projectId && search && noteType) {
        const searchPattern = `%${search}%`;
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.project_id = ${projectId}
            AND fn.content ILIKE ${searchPattern}
            AND fn.note_type = ${noteType}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      if (projectId && search) {
        const searchPattern = `%${search}%`;
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.project_id = ${projectId}
            AND fn.content ILIKE ${searchPattern}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      if (projectId && noteType) {
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.project_id = ${projectId}
            AND fn.note_type = ${noteType}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      if (search && noteType) {
        const searchPattern = `%${search}%`;
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.content ILIKE ${searchPattern}
            AND fn.note_type = ${noteType}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      if (projectId) {
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.project_id = ${projectId}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      if (search) {
        const searchPattern = `%${search}%`;
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.content ILIKE ${searchPattern}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      if (noteType) {
        const rows = await sql`
          SELECT fn.*, c.project_name
          FROM field_notes fn
          JOIN contracts c ON c.project_id = fn.project_id
          WHERE fn.note_type = ${noteType}
          ORDER BY fn.date DESC
        `;
        return { notes: rows, count: rows.length };
      }

      // No filters — return all
      const rows = await sql`
        SELECT fn.*, c.project_name
        FROM field_notes fn
        JOIN contracts c ON c.project_id = fn.project_id
        ORDER BY fn.date DESC
        LIMIT 100
      `;
      return { notes: rows, count: rows.length };
    },
  }),

  sendEmail: tool({
    description:
      "Send an email notification (demo mode). Use this to simulate sending financial alerts, reports, or action items to project managers, controllers, or executives.",
    inputSchema: z.object({
      to: z
        .string()
        .describe("Email recipient address."),
      subject: z
        .string()
        .describe("Email subject line."),
      body: z
        .string()
        .describe("Email body content."),
    }),
    execute: async ({ to, subject, body }) => {
      console.log(
        `[DEMO EMAIL] To: ${to} | Subject: ${subject} | Body: ${body}`
      );
      return {
        success: true,
        message: `Email sent (demo mode) to ${to} with subject "${subject}"`,
        timestamp: new Date().toISOString(),
      };
    },
  }),
};
