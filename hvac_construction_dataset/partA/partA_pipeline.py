import pandas as pd, numpy as np

EPS = 1e-9

def week_end_sun(s):
    s = pd.to_datetime(s)
    return s + pd.to_timedelta(6 - s.dt.weekday, unit="D")

def build_partA_tables(
    sov_budget_path: str,
    labor_logs_path: str,
    material_deliveries_path: str,
    billing_history_path: str,
    billing_line_items_path: str,
):
    # ---- Load ----
    sov = pd.read_csv(sov_budget_path)
    labor = pd.read_csv(labor_logs_path)
    mat = pd.read_csv(material_deliveries_path)
    bh = pd.read_csv(billing_history_path)
    bli = pd.read_csv(billing_line_items_path)

    labor["date"] = pd.to_datetime(labor["date"])
    mat["date"] = pd.to_datetime(mat["date"])
    bh["period_end"] = pd.to_datetime(bh["period_end"])

    # ---- Labor truth-cost ----
    labor["labor_hours"] = labor["hours_st"].astype(float) + labor["hours_ot"].astype(float)
    labor["labor_total_cost"] = (
        (labor["hours_st"].astype(float) + 1.5 * labor["hours_ot"].astype(float))
        * labor["hourly_rate"].astype(float)
        * labor["burden_multiplier"].astype(float)
    )

    # ---- Closeout cutoff ----
    last_pe = bh.groupby("project_id", as_index=False)["period_end"].max().rename(columns={"period_end": "last_period_end"})
    labor = labor.merge(last_pe, on="project_id", how="left")
    mat = mat.merge(last_pe, on="project_id", how="left")
    labor_f = labor[labor["date"] <= labor["last_period_end"]].copy()
    mat_f = mat[mat["date"] <= mat["last_period_end"]].copy()

    # ---- Billing weekly snapshots ----
    bli2 = bli.merge(bh[["project_id","application_number","period_end"]], on=["project_id","application_number"], how="left")
    bli2["period_end"] = pd.to_datetime(bli2["period_end"])
    bli2["week_end"] = week_end_sun(bli2["period_end"])
    billing_week = (
        bli2.sort_values(["project_id","sov_line_id","week_end","application_number"])
           .groupby(["project_id","sov_line_id","week_end"], as_index=False)
           .agg(
                pct_complete=("pct_complete","max"),
                total_billed=("total_billed","max"),
                scheduled_value=("scheduled_value","max"),
                description=("description","first"),
           )
    )

    # ---- Weekly spend ----
    labor_f["week_end"] = week_end_sun(labor_f["date"])
    mat_f["week_end"] = week_end_sun(mat_f["date"])

    labor_w = (
        labor_f.groupby(["project_id","sov_line_id","week_end"], as_index=False)
               .agg(
                    labor_hours_w=("labor_hours","sum"),
                    labor_cost_w=("labor_total_cost","sum"),
                    st_hours_w=("hours_st","sum"),
                    ot_hours_w=("hours_ot","sum"),
               )
    )
    mat_w = (
        mat_f.groupby(["project_id","sov_line_id","week_end"], as_index=False)
             .agg(material_cost_w=("total_cost","sum"), material_qty_w=("quantity","sum"))
    )

    # ---- FACT: sov_line_week_snapshot ----
    events = pd.concat(
        [
            labor_w[["project_id","sov_line_id","week_end"]],
            mat_w[["project_id","sov_line_id","week_end"]],
            billing_week[["project_id","sov_line_id","week_end"]],
        ],
        ignore_index=True
    ).drop_duplicates()

    fact_week = (
        events.merge(labor_w, on=["project_id","sov_line_id","week_end"], how="left")
              .merge(mat_w, on=["project_id","sov_line_id","week_end"], how="left")
              .merge(billing_week, on=["project_id","sov_line_id","week_end"], how="left")
    )

    for c in ["labor_hours_w","labor_cost_w","st_hours_w","ot_hours_w","material_cost_w","material_qty_w"]:
        fact_week[c] = fact_week[c].fillna(0.0)

    fact_week["pct_complete"] = fact_week["pct_complete"].fillna(0.0).clip(0,100)
    fact_week["total_billed"] = fact_week["total_billed"].fillna(0.0)
    fact_week["scheduled_value"] = fact_week["scheduled_value"].fillna(0.0)
    fact_week["description"] = fact_week["description"].fillna("")

    fact_week = fact_week.sort_values(["project_id","sov_line_id","week_end"]).reset_index(drop=True)
    grp = fact_week.groupby(["project_id","sov_line_id"], sort=False)

    fact_week["labor_hours_td"] = grp["labor_hours_w"].cumsum()
    fact_week["labor_cost_td"]  = grp["labor_cost_w"].cumsum()
    fact_week["material_cost_td"] = grp["material_cost_w"].cumsum()
    fact_week["st_hours_td"] = grp["st_hours_w"].cumsum()
    fact_week["ot_hours_td"] = grp["ot_hours_w"].cumsum()
    fact_week["pct_complete_td"] = grp["pct_complete"].cummax()
    fact_week["total_billed_td"] = grp["total_billed"].cummax()

    b_small = sov[["project_id","sov_line_id","estimated_labor_hours","estimated_labor_cost","estimated_material_cost","productivity_factor"]].copy()
    fact_week = fact_week.merge(b_small, on=["project_id","sov_line_id"], how="left")
    for c in ["estimated_labor_hours","estimated_labor_cost","estimated_material_cost","productivity_factor"]:
        fact_week[c] = fact_week[c].fillna(0.0)

    fact_week["budget_hours_adj"] = np.where(
        fact_week["productivity_factor"] > 0,
        fact_week["estimated_labor_hours"] / fact_week["productivity_factor"],
        fact_week["estimated_labor_hours"],
    )

    fact_week["earned_labor_cost_td"] = fact_week["estimated_labor_cost"] * (fact_week["pct_complete_td"] / 100.0)
    fact_week["earned_labor_hours_td"] = fact_week["budget_hours_adj"] * (fact_week["pct_complete_td"] / 100.0)
    fact_week["earned_material_cost_td"] = fact_week["estimated_material_cost"] * (fact_week["pct_complete_td"] / 100.0)

    # signatures
    fact_week["labor_burn_mult_cost"] = np.where(
        (fact_week["pct_complete_td"] >= 5) & (fact_week["estimated_labor_cost"] > 0),
        fact_week["labor_cost_td"] / (fact_week["earned_labor_cost_td"] + EPS),
        np.nan,
    )
    fact_week["labor_burn_mult_hours"] = np.where(
        (fact_week["pct_complete_td"] >= 5) & (fact_week["estimated_labor_hours"] > 0),
        fact_week["labor_hours_td"] / (fact_week["earned_labor_hours_td"] + EPS),
        np.nan,
    )
    fact_week["material_burn_mult_cost"] = np.where(
        (fact_week["pct_complete_td"] >= 5) & (fact_week["estimated_material_cost"] > 0),
        fact_week["material_cost_td"] / (fact_week["earned_material_cost_td"] + EPS),
        np.nan,
    )
    fact_week["ot_ratio_td"] = fact_week["ot_hours_td"] / (fact_week["st_hours_td"] + fact_week["ot_hours_td"] + EPS)
    fact_week["billing_lag_ratio"] = np.where(
        fact_week["total_billed_td"] > 0,
        (fact_week["labor_cost_td"] + fact_week["material_cost_td"]) / (fact_week["total_billed_td"] + EPS),
        np.nan,
    )

    # ---- FACT: closeout per SOV line ----
    fact_close = fact_week.groupby(["project_id","sov_line_id"], as_index=False).tail(1).copy()

    # calibration for localize step
    fact_close["labor_cost_ratio"] = np.where(fact_close["estimated_labor_cost"] > 0, fact_close["labor_cost_td"] / fact_close["estimated_labor_cost"], np.nan)
    fact_close["mat_cost_ratio"]   = np.where(fact_close["estimated_material_cost"] > 0, fact_close["material_cost_td"] / fact_close["estimated_material_cost"], np.nan)

    scales = (
        fact_close.groupby("project_id")
        .apply(lambda d: pd.Series({
            "labor_scale": d.loc[(d["estimated_labor_cost"]>0)&(d["labor_cost_td"]>0), "labor_cost_ratio"].median(),
            "mat_scale":   d.loc[(d["estimated_material_cost"]>0)&(d["material_cost_td"]>0), "mat_cost_ratio"].median(),
        }))
        .reset_index()
    )
    fact_close = fact_close.merge(scales, on="project_id", how="left")

    fact_close["var_labor_scaled"] = fact_close["labor_cost_td"] - fact_close["estimated_labor_cost"] * fact_close["labor_scale"]
    fact_close["var_material_scaled"] = fact_close["material_cost_td"] - fact_close["estimated_material_cost"] * fact_close["mat_scale"]
    fact_close["var_total_scaled"] = fact_close["var_labor_scaled"] + fact_close["var_material_scaled"]

    return fact_week, fact_close, scales, last_pe

if __name__ == "__main__":
    fact_week, fact_close, scales, last_pe = build_partA_tables(
        "sov_budget.csv",
        "labor_logs.csv",
        "material_deliveries.csv",
        "billing_history.csv",
        "billing_line_items.csv",
    )
    fact_week.to_csv("partA_fact_sov_line_week_snapshot.csv", index=False)
    fact_close.to_csv("partA_fact_sov_line_closeout.csv", index=False)
