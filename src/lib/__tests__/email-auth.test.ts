import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDomain,
  extractDomain,
  parseDkim,
  parseDmarc,
  parseSpf,
  type DnsResolver,
} from "../dns/email-auth.ts";

const fake = (txt: Record<string, string[]>, mx: Array<{ exchange: string; priority: number }> = []): DnsResolver => ({
  async txt(name) {
    if (!(name in txt)) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return txt[name];
  },
  async mx() {
    return mx;
  },
});

test("extractDomain handles emails, urls and junk", () => {
  assert.equal(extractDomain("Hello@Example.COM"), "example.com");
  assert.equal(extractDomain("https://www.acme.co.uk/contact?x=1"), "acme.co.uk");
  assert.equal(extractDomain("acme.com:8080"), "acme.com");
  assert.equal(extractDomain("not a domain"), null);
  assert.equal(extractDomain(""), null);
  assert.equal(extractDomain(null), null);
});

test("parseSpf reads the all mechanism and counts lookups", () => {
  const spf = parseSpf(["v=spf1 include:_spf.google.com include:mailgun.org a mx ip4:1.2.3.4 -all"]);
  assert.equal(spf.found, true);
  assert.equal(spf.all, "-all");
  assert.equal(spf.lookups, 4);
  assert.deepEqual(spf.issues, []);
});

test("parseSpf flags more than 10 lookups and duplicate records", () => {
  const many = "v=spf1 " + Array.from({ length: 11 }, (_, i) => `include:s${i}.example.com`).join(" ") + " ~all";
  assert.match(parseSpf([many]).issues[0], /11 DNS lookups/);
  assert.match(parseSpf(["v=spf1 ~all", "v=spf1 -all"]).issues[0], /More than one/);
  assert.equal(parseSpf(["google-site-verification=abc"]).found, false);
});

test("parseDmarc reads policy, pct and reporting", () => {
  const d = parseDmarc(["v=DMARC1; p=quarantine; pct=50; rua=mailto:a@x.com"]);
  assert.deepEqual([d.policy, d.pct, d.reporting], ["quarantine", 50, true]);
  assert.equal(parseDmarc(["v=spf1 -all"]).found, false);
  assert.equal(parseDmarc(["v=DMARC1; p=banana"]).policy, null);
});

test("parseDkim detects keys and revoked keys", () => {
  assert.deepEqual(parseDkim(["v=DKIM1; k=rsa; p=MIGfMA0"]), { found: true, revoked: false });
  assert.deepEqual(parseDkim(["v=DKIM1; p="]), { found: true, revoked: true });
  assert.deepEqual(parseDkim(["something else"]), { found: false, revoked: false });
});

test("a fully configured domain is ok", async () => {
  const r = await checkDomain(
    "good.com",
    fake(
      {
        "good.com": ["v=spf1 include:_spf.google.com -all"],
        "_dmarc.good.com": ["v=DMARC1; p=reject; rua=mailto:d@good.com"],
        "google._domainkey.good.com": ["v=DKIM1; k=rsa; p=ABCDEF"],
      },
      [{ exchange: "mx.good.com", priority: 10 }],
    ),
  );
  assert.equal(r.status, "ok");
  assert.equal(r.dkim.selector, "google");
  assert.deepEqual(r.mx.hosts, ["mx.good.com"]);
});

test("missing SPF and DMARC is critical with fixes", async () => {
  const r = await checkDomain("bad.com", fake({}));
  assert.equal(r.status, "critical");
  const areas = r.findings.filter((f) => f.severity === "critical").map((f) => f.area).sort();
  assert.deepEqual(areas, ["dmarc", "spf"]);
  assert.ok(r.findings.every((f) => f.severity !== "critical" || f.fix));
});

test("p=none DMARC and unknown DKIM selector are warnings", async () => {
  const r = await checkDomain(
    "meh.com",
    fake({ "meh.com": ["v=spf1 ~all"], "_dmarc.meh.com": ["v=DMARC1; p=none; rua=mailto:x@meh.com"] }),
  );
  assert.equal(r.status, "warning");
  assert.ok(r.findings.some((f) => f.area === "dmarc" && f.severity === "warning"));
  assert.ok(r.findings.some((f) => f.area === "dkim" && f.severity === "warning"));
});

test("+all SPF is critical", async () => {
  const r = await checkDomain("open.com", fake({ "open.com": ["v=spf1 +all"] }));
  assert.ok(r.findings.some((f) => f.severity === "critical" && /anyone/.test(f.message)));
});

test("resolver failures do not throw", async () => {
  const boom: DnsResolver = {
    async txt() { throw new Error("SERVFAIL"); },
    async mx() { throw new Error("SERVFAIL"); },
  };
  const r = await checkDomain("down.com", boom);
  assert.equal(r.status, "critical");
});
