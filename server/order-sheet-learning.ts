// Server side of order-sheet learning: extract positioned text from the
// PDF the renderer already ships with each ingest, and bridge it to the
// pure fingerprint/anchor logic in shared/order-sheet-layout.ts.
//
// Layout is deliberately NEVER persisted — the ledger row keeps only the
// extracted fields (PHI minimization), and the full PDF already lives in
// <data>/order-sheet-attachments/. At ingest time we have the bytes in
// memory; at correction time we re-read the stored attachment. Both paths
// degrade silently to "no learning" when no PDF is available (txt sheets,
// oversized files, attachment already deleted on archive).

import type { OrderSheetOption, ParsedOrderSheetFields } from "@shared/order-sheet-parser";
import {
  applyOrderSheetAnchorRules,
  computeOrderSheetFingerprint,
  deriveOrderSheetAnchorRules,
  type OrderSheetAnchorRule,
  type OrderSheetCorrection,
  type OrderSheetLayout,
  type OrderSheetLayoutItem,
  type OrderSheetLearnableField,
} from "@shared/order-sheet-layout";
import fs from "fs";
import type { DatabaseStorage } from "./storage";

// An order sheet is 1–2 pages; anything past this is a misfiled document
// and would only slow ingest down.
const MAX_LAYOUT_PAGES = 5;
const MAX_LAYOUT_ITEMS = 4000;

/**
 * Positioned text items per page, via the same unpdf build the desktop
 * watcher uses for line text. Returns null for anything unreadable —
 * callers treat null as "no learning available", never as an error.
 */
export async function extractOrderSheetLayoutFromPdf(buffer: Buffer): Promise<OrderSheetLayout | null> {
  try {
    // Lazy import for the same reason the watcher does it: unpdf carries
    // a ~1MB pdf.js bundle the server shouldn't load until first use.
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const layout: OrderSheetLayout = [];
    let totalItems = 0;
    const pageCount = Math.min(doc.numPages, MAX_LAYOUT_PAGES);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: OrderSheetLayoutItem[] = [];
      for (const item of (content.items || []) as any[]) {
        if (typeof item?.str !== "string" || !item.str.trim()) continue;
        if (++totalItems > MAX_LAYOUT_ITEMS) break;
        items.push({
          str: item.str,
          x: Math.round((item.transform?.[4] ?? 0) * 10) / 10,
          y: Math.round((item.transform?.[5] ?? 0) * 10) / 10,
          w: Math.round((typeof item.width === "number" ? item.width : 0) * 10) / 10,
          fs: Math.abs(item.transform?.[0] ?? 10),
        });
      }
      layout.push(items);
      if (totalItems > MAX_LAYOUT_ITEMS) break;
    }
    return layout.some((page) => page.length > 0) ? layout : null;
  } catch {
    return null;
  }
}

export interface LearnedTemplateApplication {
  fields: Partial<ParsedOrderSheetFields>;
  applied: OrderSheetLearnableField[];
  fingerprint: string;
}

/**
 * Look up this office's learned rules for the form and extract whatever
 * they cover. Called from ingest, before confidence is decided.
 */
export async function applyLearnedOrderSheetTemplates(params: {
  storage: DatabaseStorage;
  officeId: string;
  layout: OrderSheetLayout;
  options: { jobTypes: OrderSheetOption[]; destinations: OrderSheetOption[] };
}): Promise<LearnedTemplateApplication> {
  const fingerprint = computeOrderSheetFingerprint(params.layout);
  if (!fingerprint) return { fields: {}, applied: [], fingerprint: "" };

  const templates = await params.storage.getOrderSheetTemplates(params.officeId, fingerprint);
  if (templates.length === 0) return { fields: {}, applied: [], fingerprint };

  const rules = templates
    .map((row) => row.rule as unknown as OrderSheetAnchorRule)
    .filter((rule) => rule && typeof rule.field === "string");
  const result = applyOrderSheetAnchorRules(params.layout, rules, params.options);
  return { ...result, fingerprint };
}

/**
 * Learn from a completed review: diff what staff submitted against what
 * the parser had extracted, derive anchor rules for the corrected
 * fields, and store them for this form. Fire-and-forget from the job
 * route — learning never blocks or fails job creation.
 */
export async function learnFromOrderSheetCorrection(params: {
  storage: DatabaseStorage;
  importRecord: {
    id: string;
    officeId: string;
    parsed: Record<string, any> | null;
    attachmentPath: string | null;
  };
  corrected: OrderSheetCorrection;
  userId?: string | null;
}): Promise<{ learnedFields: OrderSheetLearnableField[] }> {
  const { storage, importRecord } = params;
  if (!importRecord.attachmentPath || !importRecord.attachmentPath.toLowerCase().endsWith(".pdf")) {
    return { learnedFields: [] };
  }
  const absolutePath = storage.resolveOrderSheetAttachmentPath(importRecord as any);
  if (!absolutePath) return { learnedFields: [] };

  const buffer = await fs.promises.readFile(absolutePath);
  const layout = await extractOrderSheetLayoutFromPdf(buffer);
  if (!layout) return { learnedFields: [] };

  const fingerprint = computeOrderSheetFingerprint(layout);
  if (!fingerprint) return { learnedFields: [] };

  const originalFields = (importRecord.parsed?.fields as ParsedOrderSheetFields | undefined) || null;
  const rules = deriveOrderSheetAnchorRules(layout, originalFields, params.corrected);
  if (rules.length === 0) return { learnedFields: [] };

  await storage.upsertOrderSheetTemplateRules(importRecord.officeId, fingerprint, rules, params.userId);
  return { learnedFields: rules.map((rule) => rule.field) };
}
