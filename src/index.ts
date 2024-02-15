import { Command, MarkdownView, Menu, Notice, Plugin, setIcon } from 'obsidian';
import { Decoration, EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import QuickLRU from 'quick-lru';
import { DEFAULT_SETTINGS, LTSettings, LTSettingsTab } from './settingsTab';
import { hashString } from './helpers';
import { LTMatch, getDetectionResult, synonyms } from './api';
import { buildUnderlineExtension } from './cm6/underlineExtension';
import { addUnderline, clearUnderlines, clearUnderlinesInRange, underlineField } from './cm6/underlineStateField';

export default class LanguageToolPlugin extends Plugin {
	public settings: LTSettings;
	private statusBarText: HTMLElement;

	private hashLru: QuickLRU<number, LTMatch[]>;
	private isLoading = false;

	public async onload(): Promise<void> {
		// Settings
		await this.loadSettings();
		let unmodifiedSettings = await this.loadData();
		if (!unmodifiedSettings || Object.keys(unmodifiedSettings).length === 0) {
			unmodifiedSettings = this.settings;
		}
		if (!unmodifiedSettings.urlMode || unmodifiedSettings.urlMode.length === 0) {
			const { serverUrl } = this.settings;
			this.settings.urlMode =
				serverUrl === 'https://api.languagetool.org'
					? 'standard'
					: serverUrl === 'https://api.languagetoolplus.com'
						? 'premium'
						: 'custom';
			try {
				await this.saveSettings();
				await this.loadSettings();
				new Notice('updated LanguageTool Settings, please confirm your server URL in the settings tab', 10000);
			} catch (e) {
				console.error(e);
			}
		}

		if (this.settings.serverUrl.endsWith('/v2/check')) {
			new Notice(
				"invalid or outdated LanguageTool Settings, I'm trying to fix it.\nIf it does not work, simply reinstall the plugin",
				10000,
			);
			this.settings.serverUrl = this.settings.serverUrl.replace('/v2/check', '');
			try {
				await this.saveSettings();
			} catch (e) {
				console.error(e);
			}
		}

		this.addSettingTab(new LTSettingsTab(this.app, this));

		// Status bar
		this.app.workspace.onLayoutReady(() => {
			this.statusBarText = this.addStatusBarItem();
			this.setStatusBarReady();
			this.registerDomEvent(this.statusBarText, 'click', this.handleStatusBarClick);
		});

		// Editor functionality
		this.hashLru = new QuickLRU<number, LTMatch[]>({
			maxSize: 10,
		});
		this.registerEditorExtension(buildUnderlineExtension(this));

		// Commands
		this.registerCommands();

		this.registerMenuItems();
	}

	public onunload() {
		this.hashLru.clear();
	}

	private registerCommands() {
		this.addCommand({
			id: 'ltcheck-text',
			name: 'Check Text',
			editorCallback: (editor, view) => {
				this.runDetection((editor as any).cm as EditorView, view).catch(e => {
					console.error(e);
				});
			},
		});

		this.addCommand({
			id: 'ltautocheck-text',
			name: 'Toggle Automatic Checking',
			callback: async () => {
				this.settings.shouldAutoCheck = !this.settings.shouldAutoCheck;
				await this.saveSettings();
			},
		});

		this.addCommand({
			id: 'ltclear',
			name: 'Clear Suggestions',
			editorCallback: editor => {
				const cm = (editor as any).cm as EditorView;
				cm.dispatch({
					effects: [clearUnderlines.of(null)],
				});
			},
		});

		this.addCommand({
			id: 'ltjump-to-next-suggestion',
			name: 'Jump to next Suggestion',
			editorCheckCallback: (checking, editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;
				const cursorOffset = editor.posToOffset(editor.getCursor());
				let firstMatch: { from: number; to: number } | null = null;
				editorView.state.field(underlineField).between(cursorOffset + 1, Infinity, (from, to) => {
					if (!firstMatch || firstMatch.from > from) {
						firstMatch = { from, to };
					}
				});
				if (checking) {
					return Boolean(firstMatch);
				}
				if (!firstMatch) {
					return;
				}
				// @ts-expect-error 2339
				// ts cant handle that the variable gets assigned in a callback
				editorView.dispatch({ selection: { anchor: firstMatch.from, head: firstMatch.to } });
			},
		});
		this.addCommand(this.getApplySuggestionCommand(1));
		this.addCommand(this.getApplySuggestionCommand(2));
		this.addCommand(this.getApplySuggestionCommand(3));
		this.addCommand(this.getApplySuggestionCommand(4));
		this.addCommand(this.getApplySuggestionCommand(5));
	}

	private getApplySuggestionCommand(n: number): Command {
		return {
			id: `ltaccept-suggestion-${n}`,
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
				const preconditionsSuccessfull =
					matches.length === 1 && matches[0]?.value?.spec?.underline?.replacements?.length >= n;

				if (checking) return preconditionsSuccessfull;

				if (!preconditionsSuccessfull) {
					console.error('Preconditions were not successfull to apply LT-suggestions.');
					return;
				}

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
		this.app.workspace.on('editor-menu', (menu, editor, view) => {
			if (!this.settings.synonyms) return;

			let cm = (editor as any).cm as EditorView;
			let selection = cm.state.selection.main;
			if (selection.empty) return;

			let word = cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to);
			if (word.match(/[\s\.]/)) return;

			menu.addItem(item => {
				item.setTitle('Synonyms');
				item.setIcon('square-stack');
				item.onClick(() => {
					let line = cm.state.doc.lineAt(selection.from);

					let prefix = line.text.slice(0, selection.from - line.from).lastIndexOf('.') + 1;
					let sentence_raw = line.text.slice(prefix);
					let sentence = sentence_raw.trimLeft();
					let offset = line.from + prefix + sentence_raw.length - sentence.length;
					let sel = { from: selection.from - offset, to: selection.to - offset };

					sentence = sentence.trimRight();
					let suffix = sentence.indexOf('.');
					if (suffix !== -1) sentence = sentence.slice(0, suffix + 1);

					synonyms(sentence, sel).then(synonyms => {
						cm.dispatch({
							effects: [
								addUnderline.of({
									from: selection.from,
									to: selection.to,
									title: 'Synonyms',
									message: '',
									categoryId: 'SYNONYMS',
									ruleId: 'SYNONYMS',
									replacements: synonyms,
								})
							]
						});
					});
				});
			});
		})
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

		new Menu(this.app)
			.addItem(item => {
				item.setTitle('Check current document');
				item.setIcon('checkbox-glyph');
				item.onClick(async () => {
					const activeLeaf = this.app.workspace.activeLeaf;
					if (activeLeaf?.view instanceof MarkdownView && activeLeaf.view.getMode() === 'source') {
						try {
							await this.runDetection((activeLeaf.view.editor as any).cm, activeLeaf.view);
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

					const cm = (view.editor as any).cm as EditorView;
					cm.dispatch({
						effects: [clearUnderlines.of(null)],
					});
				});
			})
			.showAtPosition({
				x: statusBarIconRect.right + 5,
				y: (statusBarRect?.top || 0) - 5,
			});
	};

	public async runDetection(editor: EditorView, view: MarkdownView, from?: number, to?: number): Promise<void> {
		this.setStatusBarWorking();

		const selection = editor.state.selection.main;

		let text = view.data;
		let offset = 0;
		let isRange = false;
		let rangeFrom = 0;
		let rangeTo = 0;

		if (from === undefined && selection && selection.from !== selection.to) {
			from = selection.from;
			to = selection.to;
		}

		if (from !== undefined && to !== undefined) {
			text = editor.state.sliceDoc(from, to);
			offset = from;
			rangeFrom = from;
			rangeTo = to;
			isRange = true;
		}

		const hash = hashString(text);

		let matches: LTMatch[];
		if (this.hashLru.has(hash)) {
			matches = this.hashLru.get(hash)!;
		} else {
			try {
				matches = await getDetectionResult(text, () => this.settings);
				this.hashLru.set(hash, matches);
			} catch (e) {
				this.setStatusBarReady();
				return Promise.reject(e);
			}
		}

		const effects: StateEffect<any>[] = [];

		if (isRange) {
			effects.push(
				clearUnderlinesInRange.of({
					from: rangeFrom,
					to: rangeTo,
				}),
			);
		} else {
			effects.push(clearUnderlines.of(null));
		}

		if (matches) {
			for (const match of matches) {
				effects.push(addUnderline.of(match));
			}
		}

		if (effects.length) {
			editor.dispatch({ effects });
		}

		this.setStatusBarReady();
	}

	public async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
