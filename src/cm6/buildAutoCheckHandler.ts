import { Extension } from "@codemirror/state";
import { EditorView } from '@codemirror/view';
import LanguageToolPlugin from 'src/main';

export function buildAutoCheckHandler(plugin: LanguageToolPlugin): Extension {
	let debounceTimer = -1;
	let minRange = Infinity;
	let maxRange = -Infinity;

	return EditorView.updateListener.of((update) => {
		if (!update.docChanged || !plugin.settings.shouldAutoCheck) return;

		update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
			minRange = Math.min(minRange, fromB, toB);
			maxRange = Math.max(maxRange, fromB, toB);
		})

		clearTimeout(debounceTimer);

		const view = update.view;
		debounceTimer = window.setTimeout(() => {
			const startLine = view.lineBlockAt(minRange);
			const endLine = view.lineBlockAt(maxRange);

			plugin.runDetection(view, {from: startLine.from, to: endLine.to}).catch(e => {
				console.error(e);
			});

			minRange = Infinity;
			maxRange = -Infinity;
		}, plugin.settings.autoCheckDelay);
	});
}
