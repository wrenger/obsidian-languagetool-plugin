import { Command, MarkdownView, Menu, Notice, Plugin, setIcon } from 'obsidian';
import { Decoration, EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { DEFAULT_SETTINGS, LTSettings, LTSettingsTab } from './settingsTab';
import { LTMatch, check, synonyms } from './api';
import { buildUnderlineExtension } from './cm6/underlineExtension';
import { LTRange, addUnderline, clearAllUnderlines, clearUnderlinesInRange, underlineField } from './cm6/underlineStateField';
import { syntaxTree } from "@codemirror/language";

export default class LanguageToolPlugin extends Plugin {
	public settings: LTSettings;
	private statusBarText: HTMLElement;

	private isLoading = false;

	public logs: string[] = [];

	public async onload(): Promise<void> {
		// Settings
		await this.loadSettings();

		this.addSettingTab(new LTSettingsTab(this.app, this));

		// Status bar
		this.app.workspace.onLayoutReady(() => {
			this.statusBarText = this.addStatusBarItem();
			this.setStatusBarReady();
			this.registerDomEvent(this.statusBarText, 'click', this.handleStatusBarClick);
		});

		// Editor functionality
		this.registerEditorExtension(buildUnderlineExtension(this));

		// Commands
		this.registerCommands();

		this.registerMenuItems();
	}

	public onunload() {
		this.logs = [];
		this.isLoading = false;
	}

	private registerCommands() {
		this.addCommand({
			id: 'check',
			name: 'Check Text',
			editorCallback: (editor, view) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;
				this.runDetection(editorView).catch(e => {
					console.error(e);
				});
			},
		});
		this.addCommand({
			id: 'toggle-auto-check',
			name: 'Toggle Automatic Checking',
			callback: async () => {
				this.settings.shouldAutoCheck = !this.settings.shouldAutoCheck;
				await this.saveSettings();
			},
		});
		this.addCommand({
			id: 'clear',
			name: 'Clear Suggestions',
			editorCallback: editor => {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;
				editorView.dispatch({
					effects: [clearAllUnderlines.of(null)],
				});
			},
		});
		this.addCommand({
			id: 'next',
			name: 'Jump to next Suggestion',
			editorCheckCallback: (checking, editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;
				const cursorOffset = editor.posToOffset(editor.getCursor());
				let firstMatch = null as { from: number; to: number } | null;
				editorView.state.field(underlineField).between(cursorOffset + 1, Infinity, (from, to) => {
					if (!firstMatch || firstMatch.from > from) {
						firstMatch = { from, to };
					}
				});
				if (checking) {
					return firstMatch != null;
				}
				if (firstMatch != null) {
					editorView.dispatch({ selection: { anchor: firstMatch.from, head: firstMatch.to } });
				}
			},
		});
		this.addCommand(this.applySuggestionCommand(1));
		this.addCommand(this.applySuggestionCommand(2));
		this.addCommand(this.applySuggestionCommand(3));
		this.addCommand(this.applySuggestionCommand(4));
		this.addCommand(this.applySuggestionCommand(5));
	}

	private applySuggestionCommand(n: number): Command {
		return {
			id: `accept-${n}`,
			name: `Accept suggestion #${n} when the cursor is within a Language-Tool-Hint`,
			editorCheckCallback(checking, editor) {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;
				const cursorOffset = editor.posToOffset(editor.getCursor());

				const matches: {
					from: number;
					to: number;
					value: Decoration;
				}[] = [];

				// Get underline-matches at cursor
				editorView.state.field(underlineField).between(cursorOffset, cursorOffset, (from, to, value) => {
					matches.push({ from, to, value });
				});

				// Check that there is exactly one match that has a replacement in the slot that is called.
				const preconditions =
					matches.length === 1 && matches[0].value.spec?.underline?.replacements?.length >= n;

				if (checking) return preconditions;
				if (!preconditions)
					return;

				// At this point, the check must have been successful.
				const { from, to, value } = matches[0];
				const change = {
					from,
					to,
					insert: value.spec.underline.replacements[n - 1],
				};

				// Insert the text of the match
				editorView.dispatch({
					changes: [change],
					effects: [clearUnderlinesInRange.of({ from, to })],
				});
			},
		};
	}

	private registerMenuItems() {
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
			if (!this.settings.synonyms) return;

			// @ts-expect-error, not typed
			const editorView = editor.cm as EditorView;
			let selection = editorView.state.selection.main;
			if (selection.empty) return;

			let word = editorView.state.sliceDoc(
				editorView.state.selection.main.from,
				editorView.state.selection.main.to);
			if (word.match(/[\s\.]/)) return;

			menu.addItem(item => {
				item.setTitle('Synonyms');
				item.setIcon('square-stack');
				item.onClick(async () => {
					let line = editorView.state.doc.lineAt(selection.from);

					let prefix = line.text.slice(0, selection.from - line.from).lastIndexOf('.') + 1;
					let sentence_raw = line.text.slice(prefix);
					let sentence = sentence_raw.trimStart();
					let offset = line.from + prefix + sentence_raw.length - sentence.length;
					let sel = { from: selection.from - offset, to: selection.to - offset };

					sentence = sentence.trimEnd();
					let suffix = sentence.indexOf('.');
					if (suffix !== -1) sentence = sentence.slice(0, suffix + 1);

					let replacements = await synonyms(sentence, sel);
					editorView.dispatch({
						effects: [
							addUnderline.of({
								text: word,
								from: selection.from,
								to: selection.to,
								title: 'Synonyms',
								message: '',
								categoryId: 'SYNONYMS',
								ruleId: 'SYNONYMS',
								replacements,
							})
						]
					});
				});
			});
		}));
	}

	public setStatusBarReady() {
		this.isLoading = false;
		this.statusBarText.empty();
		this.statusBarText.createSpan({ cls: 'lt-status-bar-btn' }, span => {
			span.createSpan({
				cls: 'lt-status-bar-check-icon',
				text: 'Aa',
			});
		});
	}

	public setStatusBarWorking() {
		if (this.isLoading) return;

		this.isLoading = true;
		this.statusBarText.empty();
		this.statusBarText.createSpan({ cls: ['lt-status-bar-btn', 'lt-loading'] }, span => {
			setIcon(span, 'sync-small');
		});
	}

	private readonly handleStatusBarClick = () => {
		const statusBarRect = this.statusBarText.parentElement?.getBoundingClientRect();
		const statusBarIconRect = this.statusBarText.getBoundingClientRect();

		new Menu()
			.addItem(item => {
				item.setTitle('Check current document');
				item.setIcon('checkbox-glyph');
				item.onClick(async () => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view && view.getMode() === 'source') {
						try {
							// @ts-expect-error, not typed
							const editorView = view.editor.cm as EditorView;
							await this.runDetection(editorView);
						} catch (e) {
							console.error(e);
						}
					}
				});
			})
			.addItem(item => {
				item.setTitle(this.settings.shouldAutoCheck ? 'Disable automatic checking' : 'Enable automatic checking');
				item.setIcon('uppercase-lowercase-a');
				item.onClick(async () => {
					this.settings.shouldAutoCheck = !this.settings.shouldAutoCheck;
					await this.saveSettings();
				});
			})
			.addItem(item => {
				item.setTitle('Clear suggestions');
				item.setIcon('reset');
				item.onClick(() => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!view) return;

					// @ts-expect-error, not typed
					const editorView = view.editor.cm as EditorView;
					editorView.dispatch({
						effects: [clearAllUnderlines.of(null)],
					});
				});
			})
			.showAtPosition({
				x: statusBarIconRect.right + 5,
				y: (statusBarRect?.top || 0) - 5,
			});
	};

	private increaseSelection(editor: EditorView, range: LTRange): LTRange {
		// TODO: Find the actual block with a markdown parser like mdast-util-from-markdown

		let tree = null;
		if (range.from > 0) {
			tree = syntaxTree(editor.state);
			let node = tree.resolveInner(range.from, -1);
			// Skip list indentation so that remark doesn't interpret this as code block
			if (node.type.name.startsWith('list-')) {
				range.from = node.from;
			} else {
				range.from = editor.state.doc.lineAt(range.from).from;
			}
		} else {
			range.from = 0;
		}

		if (range.to < editor.state.doc.length) {
			range.to = editor.state.doc.lineAt(range.to).to;
		} else {
			range.to = editor.state.doc.length;
		}

		return range;
	}

	public async runDetection(editor: EditorView, range?: LTRange): Promise<void> {
		const selection = editor.state.selection.main;
		if (!range && !selection.empty) {
			range = { ...selection };
		}

		let offset = 0;
		let text = '';
		if (range) {
			range = this.increaseSelection(editor, range);
			offset = range.from;
			text = editor.state.sliceDoc(range.from, range.to);
		} else {
			text = editor.state.sliceDoc(0);
		}

		if (!text.trim())
			return;

		let matches: LTMatch[];
		try {
			this.setStatusBarWorking();
			matches = await check(this.settings, offset, text);
		} catch (e) {
			console.error(e);
			if (e instanceof Error) {
				this.pushLogs(e, this.settings);
				new Notice(e.message, 5000);
			}
			return;
		} finally {
			this.setStatusBarReady();
		}

		const effects: StateEffect<any>[] = [];

		if (range) {
			effects.push(clearUnderlinesInRange.of(range));
		} else {
			effects.push(clearAllUnderlines.of(null));
		}

		if (matches) {
			// TODO: Allow removing words from the dictionary
			const spellcheckDictionary: string[] = (this.app.vault as any).getConfig('spellcheckDictionary') || [];

			for (const match of matches) {
				// Fixes a bug where the match is outside the document
				if (match.to > editor.state.doc.length)
					continue;

				// Ignore typos that are in the spellcheck dictionary
				if (match.categoryId === 'TYPOS' && spellcheckDictionary.includes(match.text)) {
					continue;
				}

				effects.push(addUnderline.of(match));
			}
		}

		if (effects.length) {
			editor.dispatch({ effects });
		}
	}

	private async pushLogs(e: Error, settings: LTSettings): Promise<void> {
		let debugString = `${new Date().toLocaleString()}:
Error: '${e.message}'
Settings: ${JSON.stringify({ ...settings, username: 'REDACTED', apikey: 'REDACTED' })}
`;
		if (settings.username || settings.apikey) {
			debugString = debugString
				.replaceAll(settings.username ?? 'username', '<<username>>')
				.replaceAll(settings.apikey ?? 'apiKey', '<<apikey>>');
		}

		this.logs.push(debugString);
		if (this.logs.length > 10) {
			this.logs.shift();
		}
	}

	public async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
