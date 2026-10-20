"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOutline = getOutline;
exports.readSection = readSection;
exports.findInDocument = findInDocument;
exports.proposeEdits = proposeEdits;
exports.applyEdits = applyEdits;
const outline_1 = require("../lib/outline");
const translate_1 = require("../lib/translate");
const validate_1 = require("../lib/validate");
// --- Read methods -----------------------------------------------------
/**
 * Return the heading outline of a Google Doc — a flat list of spans
 * with level, heading text, and stable anchors. PREFER this over
 * pulling the whole document via `docs.documentsGet` when you only
 * need to reason about structure; it returns far less data and gives
 * you anchors you can pass to `readSection`, `proposeEdits`, and
 * other docsEditor methods.
 */
async function getOutline(ctx, args) {
    const doc = await ctx.docs.documentsGet({ documentId: args.documentId });
    return (0, outline_1.buildOutline)(doc);
}
/**
 * Return the text under one heading until the next heading. Use the
 * anchor returned by `getOutline`. Lets you read one section of a long
 * document without pulling the entire body into the LLM context.
 */
async function readSection(ctx, args) {
    const doc = await ctx.docs.documentsGet({ documentId: args.documentId });
    const outline = (0, outline_1.buildOutline)(doc);
    const span = (0, outline_1.findSpan)(outline, args.anchor);
    if (!span)
        throw new Error(`anchor not found: ${args.anchor}`);
    return {
        anchor: args.anchor,
        text: (0, outline_1.spanText)(doc, span),
        revisionId: doc.revisionId ?? "",
    };
}
/**
 * Find every occurrence of `query` in the document body and return
 * the match positions along with their enclosing heading anchor.
 * Case-insensitive substring match. PREFER this over scanning the
 * raw document text yourself — it returns just the matches and
 * gives you anchors you can use with the editing methods below.
 */
async function findInDocument(ctx, args) {
    if (!args.query) {
        return { matches: [], revisionId: "" };
    }
    const doc = await ctx.docs.documentsGet({ documentId: args.documentId });
    const outline = (0, outline_1.buildOutline)(doc);
    const needleLower = args.query.toLowerCase();
    const max = args.maxResults ?? 50;
    // Iterate the document paragraph-by-paragraph so we still find matches
    // in preamble (content before the first heading) and in docs without
    // any styled headings. Each match is attributed to the span whose
    // range contains the paragraph's startIndex — undefined when the
    // paragraph isn't inside any heading span.
    const matches = [];
    const content = doc.body?.content ?? [];
    outer: for (const element of content) {
        const paragraph = element.paragraph;
        if (!paragraph)
            continue;
        const paragraphStart = element.startIndex ?? 0;
        const enclosing = outline.spans.find((s) => s.startIndex <= paragraphStart && paragraphStart < s.endIndex);
        const text = (paragraph.elements ?? [])
            .map((el) => el.textRun?.content ?? "")
            .join("");
        const lower = text.toLowerCase();
        let i = 0;
        while (true) {
            if (matches.length >= max)
                break outer;
            const idx = lower.indexOf(needleLower, i);
            if (idx < 0)
                break;
            matches.push({
                startIndex: paragraphStart + idx,
                text: args.query,
                enclosingAnchor: enclosing?.anchor,
                context: contextSnippet(text, idx, args.query.length),
            });
            i = idx + args.query.length;
        }
    }
    return { matches, revisionId: doc.revisionId ?? "" };
}
// --- Edit methods -----------------------------------------------------
/**
 * Validate a list of EditOps against the current document and return
 * a stamped EditPlan. Does NOT mutate. Step 1 of the two-step
 * propose/apply edit flow — use this together with `applyEdits` to
 * make user-reviewable edits. NEVER use `docs.documentsBatchUpdate`
 * directly; it bypasses validation and the revisionId guard.
 */
async function proposeEdits(ctx, args) {
    const doc = await ctx.docs.documentsGet({ documentId: args.documentId });
    const planned = args.edits.map((op, i) => ({
        id: `e${i + 1}`,
        op,
        status: (0, validate_1.validateOp)(op, doc),
        preview: buildPreview(op, doc),
    }));
    return {
        documentId: args.documentId,
        revisionId: doc.revisionId ?? "",
        edits: planned,
    };
}
/**
 * Apply the accepted ops from an EditPlan as a single guarded
 * batchUpdate. Step 2 of the propose/apply edit flow. Sends
 * `requiredRevisionId` so the write fails cleanly if the document
 * moved since `proposeEdits` was called — caller should then
 * re-propose against the current state.
 */
async function applyEdits(ctx, args) {
    // Re-pull just before mutating so we either send `requiredRevisionId`
    // that matches reality or surface a clean conflict to the caller.
    const fresh = await ctx.docs.documentsGet({ documentId: args.documentId });
    const freshRevision = fresh.revisionId ?? "";
    if (freshRevision !== args.plan.revisionId) {
        return {
            documentId: args.documentId,
            revisionIdUsed: args.plan.revisionId,
            applied: [],
            conflict: { observedRevisionId: freshRevision },
        };
    }
    const acceptedSet = new Set(args.acceptedEditIds);
    const opsToApply = args.plan.edits.filter((e) => acceptedSet.has(e.id) && e.status.kind === "Ok");
    const translated = opsToApply.flatMap((e) => (0, translate_1.translate)(e.op, fresh));
    // Back-to-front so earlier mutations don't shift the index space of
    // later ones in the same batch.
    translated.sort((a, b) => b.sortIndex - a.sortIndex);
    if (translated.length === 0) {
        return {
            documentId: args.documentId,
            revisionIdUsed: freshRevision,
            applied: [],
        };
    }
    await ctx.docs.documentsBatchUpdate({
        documentId: args.documentId,
        requests: translated.map((t) => t.request),
        writeControl: { requiredRevisionId: freshRevision },
    });
    return {
        documentId: args.documentId,
        revisionIdUsed: freshRevision,
        applied: opsToApply.map((e) => e.id),
    };
}
// --- Helpers ----------------------------------------------------------
function contextSnippet(text, start, length) {
    const PAD = 32;
    const from = Math.max(0, start - PAD);
    const to = Math.min(text.length, start + length + PAD);
    return text.slice(from, to);
}
function buildPreview(op, doc) {
    // Best-effort: compute a short before/after pair for the review card.
    // Full fidelity arrives in Phase 2 with named-range anchors. For now
    // we omit the preview when the snapshot doesn't hold the data we need
    // — the UI falls back to rendering the op summary.
    const outline = (0, outline_1.buildOutline)(doc);
    const span = (0, outline_1.findSpan)(outline, op.anchor);
    if (!span)
        return undefined;
    switch (op.kind) {
        case "ReplaceText":
            return { before: op.find, after: op.replace };
        case "ReplaceSpan":
            return { before: span.text, after: op.content.split("\n")[0] ?? op.content };
        case "DeleteSpan":
            return { before: span.text, after: "" };
        case "InsertParagraph":
            return { before: "", after: op.content };
        case "SetStyle":
            return { before: `(level ${span.level}) ${span.text}`, after: `(${op.style}) ${span.text}` };
        default:
            return undefined;
    }
}
