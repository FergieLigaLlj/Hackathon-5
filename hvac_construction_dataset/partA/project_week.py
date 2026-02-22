import pandas as pd
import numpy as np

EPS = 1e-9

def build_project_week_snapshot(fact_sov_week_path: str) -> pd.DataFrame:
    f = pd.read_csv(fact_sov_week_path, parse_dates=["week_end"])

    # project-week rollup
    g = (f.groupby(["project_id", "week_end"], as_index=False)
           .agg(
               labor_cost_td=("labor_cost_td", "sum"),
               material_cost_td=("material_cost_td", "sum"),
               earned_labor_cost_td=("earned_labor_cost_td", "sum"),
               earned_material_cost_td=("earned_material_cost_td", "sum"),
               total_billed_td=("total_billed_td", "sum"),
               ot_hours_td=("ot_hours_td", "sum"),
               st_hours_td=("st_hours_td", "sum"),
           ))

    g["total_cost_td"] = g["labor_cost_td"] + g["material_cost_td"]
    g["earned_cost_td"] = g["earned_labor_cost_td"] + g["earned_material_cost_td"]

    # project-level signatures (orthogonal drivers)
    g["burn_mult_cost"] = g["total_cost_td"] / (g["earned_cost_td"] + EPS)
    g["labor_burn_mult_cost"] = g["labor_cost_td"] / (g["earned_labor_cost_td"] + EPS)
    g["material_burn_mult_cost"] = g["material_cost_td"] / (g["earned_material_cost_td"] + EPS)

    g["ot_ratio_td"] = g["ot_hours_td"] / (g["ot_hours_td"] + g["st_hours_td"] + EPS)
    g["billing_lag_ratio"] = np.where(
        g["total_billed_td"] > 0,
        g["total_cost_td"] / (g["total_billed_td"] + EPS),
        np.nan
    )

    return g

if __name__ == "__main__":
    proj = build_project_week_snapshot("partA_fact_sov_line_week_snapshot.csv")
    proj.to_csv("fact_project_week_snapshot.csv", index=False)