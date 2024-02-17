import { tooltips } from '@codemirror/view';
import LanguageToolPlugin from 'src/main';
import { buildAutoCheckHandler } from './buildAutoCheckHandler';
import { buildTooltipField } from './tooltipField';
import { ignoredUnderlineField, underlineField } from './underlineStateField';

export function buildUnderlineExtension(plugin: LanguageToolPlugin) {
	return [
		tooltips({
			position: 'absolute',
			tooltipSpace: view => view.dom.getBoundingClientRect(),
		}),
		// ignoredUnderlineField must come before underlineField
		ignoredUnderlineField,
		underlineField,
		buildTooltipField(plugin),
		buildAutoCheckHandler(plugin),
	];
}
