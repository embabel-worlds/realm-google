"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOutline = buildOutline;
exports.paragraphText = paragraphText;
exports.spanText = spanText;
exports.findSpan = findSpan;
/**
 * Build a flat span list from a document body. Each "span" here is a
 * heading paragraph plus the content under it until the next heading
 * of equal-or-higher level.
 *
 * Anchors are content-derived: `idx:<startIndex>`. Stable across reads
 * but NOT stable across edits — a Phase-2 follow-up will mint Docs
 * named ranges and use those ids instead.
 */
function buildOutline(doc) {
    const content = doc.body?.content ?? [];
    const headings = [];
    for (const element of content) {
        const paragraph = element.paragraph;
        if (!paragraph)
            continue;
        const styleType = paragraph.paragraphStyle?.namedStyleType;
        if (!styleType?.startsWith("HEADING_"))
            continue;
        const level = Number.parseInt(styleType.slice("HEADING_".length), 10);
        if (Number.isNaN(level))
            continue;
        headings.push({
            level,
            text: paragraphText(paragraph).trim(),
            startIndex: element.startIndex ?? 0,
            endIndex: element.endIndex ?? 0,
        });
    }
    // Each heading's span ends where the next heading (any level) begins,
    // or at the document end if it's the last.
    const documentEnd = content.length > 0
        ? (content[content.length - 1]?.endIndex ?? 0)
        : 0;
    const spans = headings.map((h, i) => {
        const next = headings[i + 1];
        return {
            anchor: `idx:${h.startIndex}`,
            level: h.level,
            text: h.text,
            startIndex: h.startIndex,
            endIndex: next?.startIndex ?? documentEnd,
        };
    });
    return { revisionId: doc.revisionId ?? "", spans };
}
/**
 * Plain-text content of a paragraph, joining every textRun.
 */
function paragraphText(paragraph) {
    if (!paragraph)
        return "";
    return (paragraph.elements ?? [])
        .map((el) => el.textRun?.content ?? "")
        .join("");
}
/**
 * Text content of an entire span — the heading plus everything beneath
 * it up to (but not including) the next sibling-or-higher heading.
 */
function spanText(doc, span) {
    const content = doc.body?.content ?? [];
    const pieces = [];
    for (const element of content) {
        const start = element.startIndex ?? 0;
        if (start < span.startIndex)
            continue;
        if (start >= span.endIndex)
            break;
        if (element.paragraph)
            pieces.push(paragraphText(element.paragraph));
    }
    return pieces.join("");
}
/**
 * Look up a span by its anchor id. Returns undefined when the anchor
 * isn't in the outline — proposeEdits surfaces that as Invalid.
 */
function findSpan(outline, anchor) {
    return outline.spans.find((s) => s.anchor === anchor);
}
