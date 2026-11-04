"use strict";
/**
 * Edit vocabulary for structured document editing — the seven ops plus
 * supporting types. See `specs/PACK_COMPILER.md` and `plans/DOC_EDIT.md`
 * in the assistant repo.
 *
 * Three categories, split along the axes that matter (substring vs span
 * vs structure × content vs style × replace vs insert vs delete):
 *
 *   substring:        ReplaceText, SetInlineStyle
 *   span content:     ReplaceSpan, InsertParagraph, DeleteSpan
 *   structure only:   SetStyle, MoveSpan
 *
 * Each op is a discriminated-union variant tagged by `kind`. Every op
 * carries a non-empty `reason` for the review UI.
 */
Object.defineProperty(exports, "__esModule", { value: true });
