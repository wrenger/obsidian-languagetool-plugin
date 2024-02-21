import {
	App,
	DropdownComponent,
	Notice,
	PluginSettingTab,
	Setting,
	SliderComponent,
	TextComponent,
} from 'obsidian';
import LanguageToolPlugin from './main';

const autoCheckDelayMax = 5000;
const autoCheckDelayStep = 250;

class Endpoint {
	url: string;
	requestsPerSec: number;

	constructor(url: string, requestsPerSec: number) {
		this.url = url;
		this.requestsPerSec = requestsPerSec;
	}
	/** Return the minimum delay in ms */
	get minDelay() {
		return (60 / this.requestsPerSec) * 1000;
	}
}

/** See https://languagetool.org/http-api/swagger-ui */
const endpoints = {
	standard: new Endpoint('https://api.languagetool.org', 20),
	premium: new Endpoint('https://api.languagetoolplus.com', 80),
	custom: new Endpoint('', 120),
};
type EndpointType = keyof typeof endpoints;

function endpointFromUrl(url: string): EndpointType {
	for (const [key, value] of Object.entries(endpoints)) {
		if (value.url === url) return key as EndpointType;
	}
	return 'custom';
}

export interface Language {
	name: string;
	code: string;
	longCode: string;
}

export type EnglishVariety = 'en-US' | 'en-GB' | 'en-CA' | 'en-AU' | 'en-ZA' | 'en-NZ';
export type GermanVariety = 'de-DE' | 'de-AT' | 'de-CH';
export type PortugueseVariety = 'pt-BR' | 'pt-PT' | 'pt-AO' | 'pt-MZ';
export type CatalanVariety = 'ca-ES' | 'ca-ES-valencia';

export interface LTSettings {
	serverUrl: string;
	apikey?: string;
	username?: string;

	shouldAutoCheck: boolean;
	autoCheckDelay: number;
	synonyms: boolean;

	motherTongue?: string;
	staticLanguage?: string;
	englishVariety?: EnglishVariety;
	germanVariety?: GermanVariety;
	portugueseVariety?: PortugueseVariety;
	catalanVariety?: CatalanVariety;

	pickyMode: boolean;
	enabledCategories?: string;
	disabledCategories?: string;
	enabledRules?: string;
	disabledRules?: string;
}

export const DEFAULT_SETTINGS: LTSettings = {
	serverUrl: Object.keys(endpoints)[0],
	autoCheckDelay: endpoints.standard.minDelay,
	shouldAutoCheck: false,
	synonyms: false,
	pickyMode: false,
};

export class LTSettingsTab extends PluginSettingTab {
	private readonly plugin: LanguageToolPlugin;
	private languages: Language[];
	public constructor(app: App, plugin: LanguageToolPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private configureAutoCheckDelaySlider(delaySlider: SliderComponent, value: EndpointType) {
		const minAutoCheckDelay = endpoints[value].minDelay;
		this.plugin.settings.autoCheckDelay = Math.clamp(
			this.plugin.settings.autoCheckDelay, minAutoCheckDelay, autoCheckDelayMax);
		delaySlider.setLimits(minAutoCheckDelay, autoCheckDelayMax, autoCheckDelayStep);
	}

	public async requestLanguages(): Promise<Language[]> {
		if (this.languages) return this.languages;
		const languages = await fetch(`${this.plugin.settings.serverUrl}/v2/languages`).then(res => res.json());
		this.languages = languages;
		return this.languages;
	}

	public display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: this.plugin.manifest.name });
		const copyButton = containerEl.createEl('button', {
			text: 'Copy failed Request Logs',
			cls: "lt-settings-btn",
		});
		copyButton.onclick = async () => {
			await window.navigator.clipboard.writeText(this.plugin.logs.join('\n'));
			new Notice('Logs copied to clipboard');
		};

		let endpoint = endpointFromUrl(this.plugin.settings.serverUrl);
		let autoCheckDelaySlider: SliderComponent | null = null;

		new Setting(containerEl)
			.setName('Endpoint')
			.setDesc('Choose the LanguageTool server url')
			.then(setting => {
				setting.controlEl.classList.add('lt-settings-grid');

				let dropdown: DropdownComponent | null = null;
				let input: TextComponent | null = null;
				setting.addDropdown(component => {
					dropdown = component;
					component
						.addOptions({
							standard: '(Standard) api.languagetool.org',
							premium: '(Premium) api.languagetoolplus.com',
							custom: 'Custom URL',
						})
						.setValue(endpoint)
						.onChange(async value => {
							endpoint = value as EndpointType;
							this.plugin.settings.serverUrl = endpoints[endpoint].url;

							if (input)
								input.setValue(this.plugin.settings.serverUrl)
									.setDisabled(value !== 'custom');

							if (autoCheckDelaySlider)
								this.configureAutoCheckDelaySlider(autoCheckDelaySlider, endpoint);

							await this.plugin.saveSettings();
						});
				});
				setting.addText(text => {
					input = text;
					text
						.setPlaceholder('https://your-custom-url.com')
						.setValue(this.plugin.settings.serverUrl)
						.setDisabled(endpoint !== 'custom')
						.onChange(async value => {
							this.plugin.settings.serverUrl = value.replace(/\/v2\/check\/$/, '').replace(/\/$/, '');

							endpoint = endpointFromUrl(this.plugin.settings.serverUrl);
							if (endpoint !== 'custom') {
								dropdown?.setValue(endpoint);
								input?.setDisabled(true);
							}
							await this.plugin.saveSettings();
						});
				});
			});

		new Setting(containerEl)
			.setName('API Username')
			.setDesc('Enter a username/email for API Access')
			.addText(text =>
				text
					.setPlaceholder('peterlustig@gmail.com')
					.setValue(this.plugin.settings.username || '')
					.onChange(async value => {
						this.plugin.settings.username = value.replace(/\s+/g, '');
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Enter an API Key')
			.addText(text =>
				text.setValue(this.plugin.settings.apikey || '').onChange(async value => {
					this.plugin.settings.apikey = value.replace(/\s+/g, '');
					if (this.plugin.settings.apikey && endpoint !== 'premium') {
						new Notice('You have entered an API Key but you are not using the Premium Endpoint');
					}
					await this.plugin.saveSettings();
				}),
			)
			.then(setting => {
				setting.descEl.createEl('br');
				setting.descEl.createEl('a', {
					text: 'Click here for information about Premium Access',
					href: 'https://github.com/wrenger/obsidian-languagetool#premium-accounts',
					attr: { target: '_blank' },
				});
			});
		new Setting(containerEl)
			.setName('AutoCheck Text')
			.setDesc('Check text as you type')
			.addToggle(component => {
				component.setValue(this.plugin.settings.shouldAutoCheck).onChange(async value => {
					this.plugin.settings.shouldAutoCheck = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('AutoCheck Delay (ms)')
			.setDesc('Time to wait for AutoCheck after the last key press')
			.addSlider(component => {
				autoCheckDelaySlider = component;

				this.configureAutoCheckDelaySlider(component, endpoint);
				component
					.setValue(this.plugin.settings.autoCheckDelay)
					.onChange(async value => {
						this.plugin.settings.autoCheckDelay = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip();
			});
		new Setting(containerEl)
			.setName('Find Synonyms')
			.setDesc('Enables the context menu for synonyms fetched from')
			.addToggle(component => {
				component.setValue(this.plugin.settings.synonyms).onChange(async value => {
					this.plugin.settings.synonyms = value;
					await this.plugin.saveSettings();
				});
			})
			.then(setting => {
				setting.descEl.createEl('br');
				setting.descEl.createEl('a', {
					href: "https://qb-grammar-en.languagetool.org/phrasal-paraphraser/subscribe",
					text: "https://qb-grammar-en.languagetool.org/phrasal-paraphraser/subscribe",
					attr: { target: '_blank' },
				});
			});

		containerEl.createEl('h3', { text: 'Language Settings' });

		new Setting(containerEl)
			.setName('Mother Tongue')
			.setDesc('Set mother tongue if you want to be warned about false friends when writing in other languages. This setting will also be used for automatic language detection.')
			.addDropdown(component => {
				this.requestLanguages()
					.then(languages => {
						component
							.addOption('none', '---')
							.addOptions(Object.fromEntries(languages.map(v => [v.longCode, v.name])))
							.onChange(async value => {
								this.plugin.settings.motherTongue = value !== "none" ? value : undefined;
								await this.plugin.saveSettings();
							});
					})
					.catch(console.error);
			});

		let staticLanguageComponent: DropdownComponent | null;
		let englishVarietyDropdown: DropdownComponent | null;
		let germanVarietyDropdown: DropdownComponent | null;
		let portugueseVarietyDropdown: DropdownComponent | null;
		let catalanVarietyDropdown: DropdownComponent | null;

		new Setting(containerEl)
			.setName('Static Language')
			.setDesc(
				'Set a static language that will always be used (LanguageTool tries to auto detect the language, this is usually not necessary)',
			)
			.addDropdown(component => {
				staticLanguageComponent = component;
				this.requestLanguages()
					.then(languages => {
						component
							.addOption('auto', 'Auto Detect')
							.addOptions(Object.fromEntries(languages.map(v => [v.longCode, v.name])))
							.setValue(this.plugin.settings.staticLanguage ?? 'auto')
							.onChange(async value => {
								this.plugin.settings.staticLanguage = value !== "auto" ? value : undefined;
								if (value !== 'auto') {
									this.plugin.settings.englishVariety = undefined;
									englishVarietyDropdown?.setValue('default');
									this.plugin.settings.germanVariety = undefined;
									germanVarietyDropdown?.setValue('default');
									this.plugin.settings.portugueseVariety = undefined;
									portugueseVarietyDropdown?.setValue('default');
									this.plugin.settings.catalanVariety = undefined;
									catalanVarietyDropdown?.setValue('default');
								}
								await this.plugin.saveSettings();
							});
					})
					.catch(console.error);
			});

		containerEl.createEl('h3', { text: 'Language Varieties' });
		containerEl.createEl('p', {
			text: 'Some languages have varieties depending on the country they are spoken in.'
		});


		new Setting(containerEl).setName('Interpret English as').addDropdown(component => {
			englishVarietyDropdown = component;
			component
				.addOptions({
					default: '---',
					'en-US': 'English (US)',
					'en-GB': 'English (British)',
					'en-CA': 'English (Canada)',
					'en-AU': 'English (Australia)',
					'en-ZA': 'English (South Africa)',
					'en-NZ': 'English (New Zealand)',
				})
				.setValue(this.plugin.settings.englishVariety ?? 'default')
				.onChange(async value => {
					if (value === 'default') {
						this.plugin.settings.englishVariety = undefined;
					} else {
						this.plugin.settings.staticLanguage = 'auto';
						staticLanguageComponent?.setValue('auto');
						this.plugin.settings.englishVariety = value as EnglishVariety;
					}
					await this.plugin.saveSettings();
				});
		});

		new Setting(containerEl).setName('Interpret German as').addDropdown(component => {
			germanVarietyDropdown = component;
			component
				.addOptions({
					default: '---',
					'de-DE': 'German (Germany)',
					'de-CH': 'German (Switzerland)',
					'de-AT': 'German (Austria)',
				})
				.setValue(this.plugin.settings.germanVariety ?? 'default')
				.onChange(async value => {
					if (value === 'default') {
						this.plugin.settings.germanVariety = undefined;
					} else {
						this.plugin.settings.staticLanguage = 'auto';
						staticLanguageComponent?.setValue('auto');
						this.plugin.settings.germanVariety = value as GermanVariety;
					}
					await this.plugin.saveSettings();
				});
		});

		new Setting(containerEl).setName('Interpret Portuguese as').addDropdown(component => {
			portugueseVarietyDropdown = component;
			component
				.addOptions({
					default: '---',
					'pt-BR': 'Portuguese (Brazil)',
					'pt-PT': 'Portuguese (Portugal)',
					'pt-AO': 'Portuguese (Angola)',
					'pt-MZ': 'Portuguese (Mozambique)',
				})
				.setValue(this.plugin.settings.portugueseVariety ?? 'default')
				.onChange(async value => {
					if (value === 'default') {
						this.plugin.settings.portugueseVariety = undefined;
					} else {
						this.plugin.settings.staticLanguage = 'auto';
						staticLanguageComponent?.setValue('auto');
						this.plugin.settings.portugueseVariety = value as PortugueseVariety;
					}
					await this.plugin.saveSettings();
				});
		});

		new Setting(containerEl).setName('Interpret Catalan as').addDropdown(component => {
			catalanVarietyDropdown = component;
			component
				.addOptions({
					default: '---',
					'ca-ES': 'Catalan',
					'ca-ES-valencia': 'Catalan (Valencian)',
				})
				.setValue(this.plugin.settings.catalanVariety ?? 'default')
				.onChange(async value => {
					if (value === 'default') {
						this.plugin.settings.catalanVariety = undefined;
					} else {
						this.plugin.settings.staticLanguage = 'auto';
						staticLanguageComponent?.setValue('auto');
						this.plugin.settings.catalanVariety = value as CatalanVariety;
					}
					await this.plugin.saveSettings();
				});
		});

		containerEl.createEl('h3', { text: 'Rule Categories' });
		containerEl.createEl('p', { text: 'The Picky mode enables a lot of extra categories and rules. Additionally, you can enable or disable specific ones down below:' }, el => {
			el.createEl('br');
			el.createEl('a', {
				text: 'Click here for a list of rules and categories',
				href: 'https://community.languagetool.org/rule/list',
				attr: { target: '_blank' },
			});
		});

		new Setting(containerEl)
			.setName('Picky Mode')
			.setDesc(
				'Provides more style and tonality suggestions, detects long or complex sentences, recognizes colloquialism and redundancies, proactively suggests synonyms for commonly overused words',
			)
			.addToggle(component => {
				component.setValue(this.plugin.settings.pickyMode).onChange(async value => {
					this.plugin.settings.pickyMode = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Enabled Categories')
			.setDesc('Comma-separated list of categories')
			.addText(text =>
				text
					.setPlaceholder('CATEGORY_1,CATEGORY_2')
					.setValue(this.plugin.settings.enabledCategories ?? '')
					.onChange(async value => {
						this.plugin.settings.enabledCategories = value.replace(/\s+/g, '');
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Disabled Categories')
			.setDesc('Comma-separated list of categories')
			.addText(text =>
				text
					.setPlaceholder('CATEGORY_1,CATEGORY_2')
					.setValue(this.plugin.settings.disabledCategories ?? '')
					.onChange(async value => {
						this.plugin.settings.disabledCategories = value.replace(/\s+/g, '');
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Enabled Rules')
			.setDesc('Comma-separated list of rules')
			.addText(text =>
				text
					.setPlaceholder('RULE_1,RULE_2')
					.setValue(this.plugin.settings.enabledRules ?? '')
					.onChange(async value => {
						this.plugin.settings.enabledRules = value.replace(/\s+/g, '');
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Disabled Rules')
			.setDesc('Comma-separated list of rules')
			.addText(text =>
				text
					.setPlaceholder('RULE_1,RULE_2')
					.setValue(this.plugin.settings.disabledRules ?? '')
					.onChange(async value => {
						this.plugin.settings.disabledRules = value.replace(/\s+/g, '');
						await this.plugin.saveSettings();
					}),
			);
	}
}
