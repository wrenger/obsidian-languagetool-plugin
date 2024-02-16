import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { syntaxTree, tokenClassNodeProp } from '@codemirror/language';
import { Tree } from '@lezer/common';
import { categoryCssClass } from '../helpers';
import { LTMatch } from "src/api";

export const ignoreListRegEx = /frontmatter|code|math|templater|blockid|hashtag|internal/;

export interface LTRange {
	from: number;
	to: number;
};

export const addUnderline = StateEffect.define<LTMatch>();
export const clearUnderlines = StateEffect.define();
export const clearUnderlinesInRange = StateEffect.define<LTRange>();
export const ignoreUnderline = StateEffect.define<LTRange>();

function rangeOverlapping(first: LTRange, second: LTRange): boolean {
	return (
		first.from <= second.from && second.from <= first.to ||
		first.from <= second.to && second.to <= first.to ||
		second.from <= first.from && first.from <= second.to ||
		second.from <= first.to && first.to <= second.to
	);
}

export const ignoredUnderlineField = StateField.define<{
	marks: DecorationSet;
	ignoredRanges: Set<string>;
}>({
	create() {
		return {
			// Using a decoration set allows us to update ignored ranges
			// when the document around them is changed
			marks: Decoration.none,

			// But we use this set to check if a range is ignored. See
			// underlineField below
			ignoredRanges: new Set(),
		};
	},
	update(state, tr) {
		state.marks = state.marks.map(tr.changes);

		// Rebuild ignoredRanges to account for tr.changes
		state.ignoredRanges.clear();
		state.marks.between(0, tr.newDoc.length, (from, to) => {
			state.ignoredRanges.add(`${from},${to}`);
		});

		// Clear out any decorations when their contents are edited
		if (tr.docChanged && tr.selection && state.marks.size) {
			state.marks = state.marks.update({
				filter: (from, to) => {
					const overlapping = rangeOverlapping({ from, to }, tr.selection!.main);
					if (overlapping) {
						state.ignoredRanges.delete(`${from},${to}`);
					}
					return !overlapping;
				},
			});
		}

		for (const e of tr.effects) {
			if (e.is(ignoreUnderline)) {
				const { from, to } = e.value;

				state.ignoredRanges.add(`${from},${to}`);
				state.marks = state.marks.update({
					add: [Decoration.mark({}).range(from, to)],
				});
			}
		}

		return state;
	},
});

export const underlineField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(underlines, tr) {
		underlines = underlines.map(tr.changes);

		const { ignoredRanges } = tr.state.field(ignoredUnderlineField);
		const seenRanges = new Set<string>();

		// Memoize any positions we check so we can avoid some work
		const seenPositions: Record<number, boolean> = {};
		let tree: Tree | null = null;

		// Prevent decorations in codeblocks, etc...
		const canDecorate = (pos: number) => {
			if (seenPositions[pos] !== undefined) {
				return seenPositions[pos];
			}

			if (!tree) tree = syntaxTree(tr.state);

			const nodeProps = tree.resolveInner(pos, 1).type.prop(tokenClassNodeProp);

			if (nodeProps && ignoreListRegEx.test(nodeProps)) {
				seenPositions[pos] = false;
			} else {
				seenPositions[pos] = true;
			}

			return seenPositions[pos];
		};

		// Ignore certain rules in special cases
		const isRuleAllowed = (underline: LTMatch) => {
			// Don't show spelling errors for entries in the user dictionary
			if (underline.categoryId === 'TYPOS') {
				const spellcheckDictionary: string[] = ((window as any).app.vault as any).getConfig('spellcheckDictionary');
				const str = tr.state.sliceDoc(underline.from, underline.to);

				if (spellcheckDictionary && spellcheckDictionary.includes(str)) {
					return false;
				}
			}

			// Don't display whitespace rules in tables
			if (!tree) tree = syntaxTree(tr.state);

			const lineNodeProp = tree.resolve(tr.newDoc.lineAt(underline.from).from, 1).type.prop(tokenClassNodeProp);

			if (lineNodeProp?.includes('table')) {
				if (underline.ruleId === 'WHITESPACE_RULE') {
					return false;
				}
			}

			return true;
		};

		// Clear out any decorations when their contents are edited
		if (tr.docChanged && tr.selection && underlines.size) {
			underlines = underlines.update({
				filter: (from, to) => !rangeOverlapping({ from, to }, tr.selection!.main),
			});
		}

		for (const e of tr.effects) {
			if (e.is(addUnderline)) {
				const underline = e.value;
				const key = `${underline.from},${underline.to}`;

				if (
					!ignoredRanges.has(key) &&
					!seenRanges.has(key) &&
					canDecorate(underline.from) &&
					canDecorate(underline.to) &&
					isRuleAllowed(underline)
				) {
					seenRanges.add(key);
					underlines = underlines.update({
						add: [
							Decoration.mark({
								class: `lt-underline ${categoryCssClass(underline.categoryId)}`,
								underline,
							}).range(underline.from, underline.to),
						],
					});
				}
			} else if (e.is(clearUnderlines)) {
				underlines = Decoration.none;
			} else if (e.is(clearUnderlinesInRange) || e.is(ignoreUnderline)) {
				underlines = underlines.update({
					filter: (from, to) => !rangeOverlapping({ from, to }, e.value),
				});
			}
		}

		return underlines;
	},
	provide: f => EditorView.decorations.from(f),
});
