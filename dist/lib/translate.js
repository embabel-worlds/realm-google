"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._internals = void 0;
exports.translate = translate;
const outline_1 = require("./outline");
function translate(op, doc) {
    switch (op.kind) {
        case "ReplaceText":
            return translateReplaceText(op, doc);
        case "SetInlineStyle":
            return translateSetInlineStyle(op, doc);
        case "ReplaceSpan":
            return translateReplaceSpan(op, doc);
        case "InsertParagraph":
            return translateInsertParagraph(op, doc);
        case "DeleteSpan":
            return translateDeleteSpan(op, doc);
        case "SetStyle":
            return translateSetStyle(op, doc);
        case "MoveSpan":
            return translateMoveSpan(op, doc);
    }
}
// --- Per-op translators -----------------------------------------------
function translateReplaceText(op, doc) {
    const span = requireSpan(op.anchor, doc);
    const text = (0, outline_1.spanText)(doc, span);
    const occurrences = findAllOccurrences(text, op.find);
    if (occurrences.length === 0) {
        throw new Error(`ReplaceText: '${op.find}' not found in span ${op.anchor}`);
    }
    const targets = op.occurrence === "all"
        ? occurrences
        : [occurrences[(op.occurrence ?? 1) - 1]];
    // Back-to-front so multi-match within one span keeps offsets sane.
    return [...targets].reverse().map((relativeStart) => {
        const start = span.startIndex + relativeStart;
        const end = start + op.find.length;
        return {
            sortIndex: start,
            request: {
                deleteContentRange: { range: { startIndex: start, endIndex: end } },
            },
        };
    }).flatMap((deletion) => [
        deletion,
        {
            sortIndex: deletion.sortIndex,
            request: {
                insertText: {
                    location: { index: deletion.sortIndex },
                    text: op.replace,
                },
            },
        },
    ]);
}
function translateSetInlineStyle(op, doc) {
    const span = requireSpan(op.anchor, doc);
    const text = (0, outline_1.spanText)(doc, span);
    const occurrences = findAllOccurrences(text, op.find);
    const targetIndex = (op.occurrence ?? 1) - 1;
    const relativeStart = occurrences[targetIndex];
    if (relativeStart === undefined) {
        throw new Error(`SetInlineStyle: '${op.find}' occurrence ${targetIndex + 1} not found in span ${op.anchor}`);
    }
    const start = span.startIndex + relativeStart;
    const end = start + op.find.length;
    return [
        {
            sortIndex: start,
            request: {
                updateTextStyle: {
                    range: { startIndex: start, endIndex: end },
                    textStyle: inlineFormatToTextStyle(op.format),
                    fields: inlineFormatFields(op.format),
                },
            },
        },
    ];
}
function translateReplaceSpan(op, doc) {
    const span = requireSpan(op.anchor, doc);
    return [
        {
            sortIndex: span.startIndex,
            request: {
                deleteContentRange: {
                    range: { startIndex: span.startIndex, endIndex: span.endIndex },
                },
            },
        },
        {
            sortIndex: span.startIndex,
            request: {
                insertText: { location: { index: span.startIndex }, text: op.content },
            },
        },
    ];
}
function translateInsertParagraph(op, doc) {
    const span = requireSpan(op.anchor, doc);
    const insertIndex = resolvePositionedIndex(span, op.position);
    const text = op.content.endsWith("\n") ? op.content : `${op.content}\n`;
    const requests = [
        {
            sortIndex: insertIndex,
            request: { insertText: { location: { index: insertIndex }, text } },
        },
    ];
    if (op.style && op.style !== "Body") {
        requests.push({
            sortIndex: insertIndex,
            request: {
                updateParagraphStyle: {
                    range: { startIndex: insertIndex, endIndex: insertIndex + text.length },
                    paragraphStyle: { namedStyleType: namedStyleType(op.style) },
                    fields: "namedStyleType",
                },
            },
        });
    }
    return requests;
}
function translateDeleteSpan(op, doc) {
    const span = requireSpan(op.anchor, doc);
    return [
        {
            sortIndex: span.startIndex,
            request: {
                deleteContentRange: {
                    range: { startIndex: span.startIndex, endIndex: span.endIndex },
                },
            },
        },
    ];
}
function translateSetStyle(op, doc) {
    const span = requireSpan(op.anchor, doc);
    return [
        {
            sortIndex: span.startIndex,
            request: {
                updateParagraphStyle: {
                    range: { startIndex: span.startIndex, endIndex: span.endIndex },
                    paragraphStyle: { namedStyleType: namedStyleType(op.style) },
                    fields: "namedStyleType",
                },
            },
        },
    ];
}
function translateMoveSpan(op, doc) {
    const span = requireSpan(op.anchor, doc);
    const target = requireSpan(op.target, doc);
    const text = (0, outline_1.spanText)(doc, span);
    const insertIndex = resolvePositionedIndex(target, op.position);
    // Move = delete-then-insert. The back-to-front sort handles index
    // shifting between the two requests when they're submitted as one
    // batch.
    return [
        {
            sortIndex: span.startIndex,
            request: {
                deleteContentRange: {
                    range: { startIndex: span.startIndex, endIndex: span.endIndex },
                },
            },
        },
        {
            sortIndex: insertIndex,
            request: { insertText: { location: { index: insertIndex }, text } },
        },
    ];
}
// --- Helpers ----------------------------------------------------------
function requireSpan(anchor, doc) {
    const outline = (0, outline_1.buildOutline)(doc);
    const span = (0, outline_1.findSpan)(outline, anchor);
    if (!span)
        throw new Error(`anchor not found: ${anchor}`);
    return span;
}
function resolvePositionedIndex(span, position) {
    switch (position) {
        case "Before":
            return span.startIndex;
        case "After":
            return span.endIndex;
        case "FirstChild":
            // Right after the heading paragraph itself. For a content-derived
            // anchor we don't have the heading-paragraph end exactly, so we
            // approximate with startIndex+heading-text-length. Good enough for
            // the shape; named-range anchors will fix this in Phase 2.
            return span.startIndex + 1;
        case "LastChild":
            return span.endIndex - 1;
    }
}
function findAllOccurrences(haystack, needle) {
    if (!needle)
        return [];
    const out = [];
    let i = 0;
    while (true) {
        const idx = haystack.indexOf(needle, i);
        if (idx < 0)
            break;
        out.push(idx);
        i = idx + needle.length;
    }
    return out;
}
function namedStyleType(style) {
    switch (style) {
        case "Heading1": return "HEADING_1";
        case "Heading2": return "HEADING_2";
        case "Heading3": return "HEADING_3";
        case "Heading4": return "HEADING_4";
        case "Heading5": return "HEADING_5";
        case "Heading6": return "HEADING_6";
        case "Body": return "NORMAL_TEXT";
        case "Bullet": return "NORMAL_TEXT"; // bullets are list-applied, not a paragraphStyle
        case "Numbered": return "NORMAL_TEXT";
        case "Quote": return "NORMAL_TEXT";
    }
}
function inlineFormatToTextStyle(format) {
    const style = {};
    if (format.bold !== undefined)
        style.bold = format.bold;
    if (format.italic !== undefined)
        style.italic = format.italic;
    if (format.underline !== undefined)
        style.underline = format.underline;
    if (format.link !== undefined)
        style.link = { url: format.link };
    return style;
}
function inlineFormatFields(format) {
    const fields = [];
    if (format.bold !== undefined)
        fields.push("bold");
    if (format.italic !== undefined)
        fields.push("italic");
    if (format.underline !== undefined)
        fields.push("underline");
    if (format.link !== undefined)
        fields.push("link");
    return fields.join(",");
}
exports._internals = {
    findAllOccurrences,
    namedStyleType,
    inlineFormatFields,
};
