import test from "node:test";
import assert from "node:assert/strict";
import { tabletHttpEnabled, makeTabletOnlyHandler } from "../server/tablet-listener.js";

test("tabletHttpEnabled is false when OTTO_TABLET_HTTP is unset", () => {
  delete process.env.OTTO_TABLET_HTTP;
  assert.equal(tabletHttpEnabled(), false);
});

test("tabletHttpEnabled is false for any value other than '1'", () => {
  process.env.OTTO_TABLET_HTTP = "true";
  assert.equal(tabletHttpEnabled(), false);
  process.env.OTTO_TABLET_HTTP = "0";
  assert.equal(tabletHttpEnabled(), false);
  process.env.OTTO_TABLET_HTTP = "yes";
  assert.equal(tabletHttpEnabled(), false);
  delete process.env.OTTO_TABLET_HTTP;
});

test("tabletHttpEnabled is true only when exactly '1'", () => {
  process.env.OTTO_TABLET_HTTP = "1";
  assert.equal(tabletHttpEnabled(), true);
  delete process.env.OTTO_TABLET_HTTP;
});

function makeFakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      if (chunk) this.body += chunk;
    },
  };
}

test("makeTabletOnlyHandler returns 404 and does not call app for non-tablet paths", () => {
  let appCalled = false;
  const appSpy = (_req: any, _res: any) => {
    appCalled = true;
  };
  const handler = makeTabletOnlyHandler(appSpy as any);

  const req: any = { url: "/api/login" };
  const res: any = makeFakeRes();

  handler(req, res);

  assert.equal(appCalled, false);
  assert.equal(res.statusCode, 404);
});

test("makeTabletOnlyHandler delegates to app for /tablet/* paths", () => {
  let appCalled = false;
  let receivedReq: any = null;
  const appSpy = (req: any, _res: any) => {
    appCalled = true;
    receivedReq = req;
  };
  const handler = makeTabletOnlyHandler(appSpy as any);

  const req: any = { url: "/tablet/api/office-info" };
  const res: any = makeFakeRes();

  handler(req, res);

  assert.equal(appCalled, true);
  assert.equal(receivedReq, req);
});

test("makeTabletOnlyHandler delegates to app for exactly /tablet", () => {
  let appCalled = false;
  const appSpy = (_req: any, _res: any) => {
    appCalled = true;
  };
  const handler = makeTabletOnlyHandler(appSpy as any);

  const req: any = { url: "/tablet" };
  const res: any = makeFakeRes();

  handler(req, res);

  assert.equal(appCalled, true);
});

test("makeTabletOnlyHandler rejects paths that merely start with /tablet without a slash boundary", () => {
  let appCalled = false;
  const appSpy = (_req: any, _res: any) => {
    appCalled = true;
  };
  const handler = makeTabletOnlyHandler(appSpy as any);

  const req: any = { url: "/tabletxyz/hack" };
  const res: any = makeFakeRes();

  handler(req, res);

  assert.equal(appCalled, false);
  assert.equal(res.statusCode, 404);
});
