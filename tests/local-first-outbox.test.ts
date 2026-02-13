import test from "node:test";
import assert from "node:assert/strict";
import {
  clearOutboxItems,
  enqueueOutboxItem,
  flushOutbox,
  listOutboxItems,
} from "../client/src/lib/offline-outbox";

let store: any[] = [];

function installWindowBridge() {
  (globalThis as any).window = {
    location: { origin: "https://office.local" },
    otto: {
      outboxGet: async () => store,
      outboxReplace: async (items: unknown) => {
        store = Array.isArray(items) ? [...items] : [];
      },
    },
  };
}

test.beforeEach(async () => {
  store = [];
  installWindowBridge();
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  await clearOutboxItems();
});

test("clears the outbox and updates in-memory state", async () => {
  await enqueueOutboxItem({
    id: "item-1",
    origin: "https://office.local",
    method: "POST",
    url: "/api/jobs",
    body: { orderId: "ABC" },
  });

  const queued = await listOutboxItems();
  assert.equal(queued.length, 1);
  assert.equal(store.length, 1);

  await clearOutboxItems();

  const afterClear = await listOutboxItems();
  assert.equal(afterClear.length, 0);
  assert.equal(store.length, 0);
});

test("flushes queued changes when server responds successfully", async () => {
  await enqueueOutboxItem({
    id: "item-2",
    origin: "https://office.local",
    method: "PATCH",
    url: "/api/jobs/job-1",
    body: { status: "ordered" },
  });

  const result = await flushOutbox("https://office.local");

  assert.equal(result.flushed, 1);
  assert.equal(result.remaining, 0);
  assert.equal(result.lastError, null);
  assert.equal(store.length, 0);
});

test("keeps the first item and marks blockedByAuth on 401", async () => {
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  await enqueueOutboxItem({
    id: "item-3",
    origin: "https://office.local",
    method: "PUT",
    url: "/api/jobs/job-2/flag/note",
    body: { note: "Needs callback" },
  });

  const result = await flushOutbox("https://office.local");

  assert.equal(result.flushed, 0);
  assert.equal(result.blockedByAuth, true);
  assert.equal(result.remaining, 1);
  assert.ok(result.lastError?.toLowerCase().includes("sign in"));
  assert.equal(store.length, 1);
  assert.equal(Number(store[0]?.attempts), 1);
});
