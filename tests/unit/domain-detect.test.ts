import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { captureWhitelabelDomain, getSettings, updateSettings } from "@/lib/analytics/queries";
import { closeDb, sql } from "@/lib/db";
import { crmUrl, DEFAULT_APP_DOMAIN } from "@/lib/links";

// N82: the white-label login domain is found automatically (sign-in and the install event), stored per company, and the field in Settings is only
// an override that can be taken off again. Against the real database, with a fixture company that is removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-domain-co";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!HAS_DB)("login domain: found automatically, typed only as an override", () => {
  let inst = "";
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    const [i] = await sql()`insert into installations (company_id, company_name, plan) values (${CO}, 'zzDomain', 'pro') returning id`; // no tokens: the scheduler ignores it
    inst = i.id as string;
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  const state = async () => { const s = await getSettings(inst); return [s.appDomain, s.appDomainSource, s.detectedDomain]; };

  it("nothing seen yet: links use the standard address and say so", async () => {
    expect(await state()).toEqual([DEFAULT_APP_DOMAIN, "default", null]);
    expect(crmUrl((await getSettings(inst)), "/x")).toBe(`https://${DEFAULT_APP_DOMAIN}/x`);
  });

  it("the install event's domain is stored, and links use it from the first screen", async () => {
    await captureWhitelabelDomain(inst, "crm.fromevent.test", "install");
    expect(await state()).toEqual(["crm.fromevent.test", "install", "crm.fromevent.test"]);
    expect(crmUrl(await getSettings(inst), "/v2/location/L/dashboard")).toBe("https://crm.fromevent.test/v2/location/L/dashboard");
  });

  it("a later sign-in with another domain replaces it (the company moved), and the same domain again changes nothing", async () => {
    await captureWhitelabelDomain(inst, "crm.fromsignin.test", "sso");
    expect(await state()).toEqual(["crm.fromsignin.test", "sso", "crm.fromsignin.test"]);
    await captureWhitelabelDomain(inst, "crm.fromsignin.test", "sso");
    expect(await state()).toEqual(["crm.fromsignin.test", "sso", "crm.fromsignin.test"]);
  });

  it("saving other settings never turns the found address into a typed one", async () => {
    await updateSettings(inst, { brandName: "Zz Brand" });
    expect((await state())[1]).toBe("sso");
  });

  it("a typed address wins, later sign-ins still remember what they saw, and taking the override off goes back to it", async () => {
    await updateSettings(inst, { appDomainOverride: "app.typed.test" });
    expect(await state()).toEqual(["app.typed.test", "manual", "crm.fromsignin.test"]);
    await captureWhitelabelDomain(inst, "crm.newer.test", "sso");
    expect(await state(), "a detected domain never replaces a typed one").toEqual(["app.typed.test", "manual", "crm.newer.test"]);
    await captureWhitelabelDomain(inst, "crm.fromevent2.test", "install");
    expect((await state())[0]).toBe("app.typed.test");
    await updateSettings(inst, { appDomainOverride: null });
    expect(await state(), "override off: back to the one that was found most recently").toEqual(["crm.fromevent2.test", "sso", "crm.fromevent2.test"]);
  });

  it("taking the override off when nothing was ever detected goes back to the standard address", async () => {
    await sql()`update settings set detected_app_domain = null, ghl_app_domain = ${DEFAULT_APP_DOMAIN}, app_domain_source = 'default' where installation_id = ${inst}`;
    await updateSettings(inst, { appDomainOverride: "app.typed.test" });
    expect((await state())[1]).toBe("manual");
    await updateSettings(inst, { appDomainOverride: null });
    expect(await state()).toEqual([DEFAULT_APP_DOMAIN, "default", null]);
  });
});

describe("the install event and sign-in both feed it (read of the code)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the webhook route keeps the domain from an install event, for the install it belongs to", () => {
    const route = read("src/app/api/webhooks/ghl/route.ts");
    expect(route).toMatch(/event\.type === "AppInstall" && event\.whitelabelDomain && target/);
    expect(route).toMatch(/captureWhitelabelDomain\(target\.id, event\.whitelabelDomain, "install"\)/);
  });
  it("sign-in keeps it too, and the screen sends an address only as an override", () => {
    expect(read("src/app/api/sso/route.ts")).toMatch(/captureWhitelabelDomain\(installation\.id, user\.whitelabelDomain, "sso"\)/);
    const settings = read("src/app/app/views/settings.tsx");
    expect(settings).toMatch(/appDomainOverride/);
    expect(settings).not.toMatch(/appDomain: form\.appDomain/);
  });
});
