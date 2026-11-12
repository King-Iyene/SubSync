import { sql } from "../db";
import { cleanSaleSettings, DEFAULT_SALE_SETTINGS, type SaleSettings } from "./sale-basis-core.ts";

// The company's one choice for how a sale is counted. A missing column (migration not applied yet) reads as the default, and a write says it is not ready.
const isMissing = (e: unknown) => /column .* does not exist|42703/i.test(String((e as Error)?.message ?? e));

export async function loadSaleSettings(inst: string): Promise<SaleSettings> {
  try {
    const r = await sql()`select sale_basis, sale_count_without_value from settings where installation_id = ${inst}`;
    return cleanSaleSettings({ basis: r[0]?.sale_basis, countWithoutValue: r[0]?.sale_count_without_value ?? undefined });
  } catch { return DEFAULT_SALE_SETTINGS; }
}

export async function saveSaleSettings(inst: string, s: SaleSettings): Promise<boolean> {
  try {
    await sql()`insert into settings (installation_id, sale_basis, sale_count_without_value) values (${inst}, ${s.basis}, ${s.countWithoutValue})
      on conflict (installation_id) do update set sale_basis = excluded.sale_basis, sale_count_without_value = excluded.sale_count_without_value`;
    return true;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}
