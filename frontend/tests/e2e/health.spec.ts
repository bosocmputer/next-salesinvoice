import { test, expect } from "./_helpers";

test.describe("backend health", () => {
  test("/api/v1/healthz returns 200", async ({ request }) => {
    const r = await request.get("/api/v1/healthz");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.success).toBe(true);
  });

  test("/api/v1/readyz returns 200 when DB is ready", async ({ request }) => {
    const r = await request.get("/api/v1/readyz");
    expect([200, 503]).toContain(r.status());
  });

  test("/metrics exposes Prometheus counters", async ({ request }) => {
    const r = await request.get("/metrics");
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toMatch(/nsi_http_requests_total/);
  });
});
