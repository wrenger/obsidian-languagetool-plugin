import * as Remark from 'annotatedtext-remark';
import { LTSettings } from './settings';
import { RequestUrlResponse, requestUrl } from "obsidian";
import { JSONPath } from "jsonpath-plus";

/** A typo or grammar issue detected by LanguageTool */
export interface LTMatch {
	text: string;
	from: number;
	to: number;
	title: string;
	message: string;
	replacements: string[];
	categoryId: string;
	ruleId: string;
}

// LanguageTool Check API: https://languagetool.org/http-api/swagger-ui
const C_MATCHES = "$.matches[*]";
const C_FROM = "$.offset@number()";
const C_LEN = "$.length@number()";
const C_TITLE = "$.shortMessage@string()";
const C_MESSAGE = "$.message@string()";
const C_REPLACEMENTS = "$.replacements[*].value@string()";
const C_CATEGORY_ID = "$.rule.category.id@string()";
const C_RULE_ID = "$.rule.id@string()";

export async function check(
	settings: LTSettings,
	offset: number,
	text: string,
): Promise<LTMatch[]> {
	const parsedText = Remark.build(text, {
		...Remark.defaults,
		interpretmarkup(text = ''): string {
			// Don't collapse inline code
			if (/^`[^`]+`$/.test(text)) {
				return text;
			}
			const linebreaks = '\n'.repeat(text.match(/\n/g)?.length ?? 0);

			// Support lists (annotation ends with marker)
			if (text.match(/^\s*(-|\d+\.) $/m)) {
				return linebreaks + '• '; // this is the character, the online editor uses
			}

			return linebreaks;
		},
	});

	const params: { [key: string]: string } = {
		data: JSON.stringify(parsedText),
		language: settings.staticLanguage ?? 'auto',
		enabledOnly: 'false',
		level: settings.pickyMode ? 'picky' : 'default',
	};

	if (settings.motherTongue)
		params.motherTongue = settings.motherTongue;

	if (settings.enabledCategories)
		params.enabledCategories = settings.enabledCategories;
	if (settings.disabledCategories)
		params.disabledCategories = settings.disabledCategories;

	if (settings.enabledRules)
		params.enabledRules = settings.enabledRules;
	if (settings.disabledRules)
		params.disabledRules = settings.disabledRules;

	params.preferredVariants = Object.values(settings.languageVariety).join(',');

	if (settings.apikey && settings.username) {
		params.username = settings.username;
		params.apiKey = settings.apikey;
	}

	let res: RequestUrlResponse;
	try {
		res = await requestUrl({
			url: `${settings.serverUrl}/v2/check`,
			method: 'POST',
			body: new URLSearchParams(params).toString(),
			throw: true,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
		});
	} catch (e) {
		console.log(e);
		throw new Error(`Request to LanguageTool failed: Please check your connection and server URL.\n${e}`);
	}
	if (res.json == null)
		throw new Error(`Error processing response from LanguageTool.`);

	let matches = jsonPathA<any>(C_MATCHES, res.json);
	return matches.map(match => {
		let from = jsonPath<number>(C_FROM, match);
		let to = from + jsonPath<number>(C_LEN, match);
		return {
			text: text.slice(from, to),
			from: offset + from,
			to: offset + to,
			title: jsonPath<string>(C_TITLE, match),
			message: jsonPath<string>(C_MESSAGE, match),
			replacements: jsonPathA<string>(C_REPLACEMENTS, match),
			categoryId: jsonPath<string>(C_CATEGORY_ID, match),
			ruleId: jsonPath<string>(C_RULE_ID, match),
		};
	});
}

export interface Language {
	name: string;
	code: string;
	longCode: string;
}

export async function languages(serverUrl: string): Promise<Language[]> {
	const languages = await requestUrl({ url: `${serverUrl}/v2/languages` }).json;
	if (languages == null || !(languages instanceof Array))
		throw new Error(`Error processing response from LanguageTool.`);
	return languages as Language[];
}

export interface SynonymApi {
	url: string;
	query: (sentence: string, selection: { from: number; to: number }) => Promise<string[]>;
}

class SynonymEn implements SynonymApi {
	url = "https://qb-grammar-en.languagetool.org/phrasal-paraphraser/subscribe";
	async query(sentence: string, selection: { from: number; to: number }): Promise<string[]> {
		const PATH = "$.data.suggestions[*][*]@string()";

		let index = sentence.slice(0, selection.from).split(/\s+/).length;
		let word = sentence.slice(selection.from, selection.to);

		let request = {
			message: {
				indices: [index],
				mode: 0,
				phrases: [word],
				text: sentence
			},
			meta: {
				clientStatus: "string",
				product: "string",
				traceID: "string",
				userID: "string",
			},
			response_queue: "string"
		};

		let res: any;
		try {
			res = await requestUrl({
				url: this.url,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(request)
			}).json;
		} catch (e) {
			throw new Error(`Requesting synonyms failed\n${e}`);
		}

		if (res == null)
			throw new Error(`Error processing response from LanguageTool.`);

		return jsonPathA<string>(PATH, res);
	}
}

class SynonymDe implements SynonymApi {
	url = "https://synonyms.languagetool.org/synonyms/de";
	async query(sentence: string, selection: { from: number; to: number }): Promise<string[]> {
		let word = sentence.slice(selection.from, selection.to).trim();
		let before = sentence.slice(0, selection.from).split(/\s+/).join("+");
		let after = sentence.slice(selection.to).split(/\s+/).join("+");

		let res: any;
		try {
			res = await requestUrl({
				url: `${this.url}/${word}?${new URLSearchParams({ before, after })}`,
				method: 'GET',
			}).json;
		} catch (e) {
			throw new Error(`Requesting synonyms failed\n${e}`);
		}

		if (res == null)
			throw new Error(`Error processing response.`);

		return jsonPathA<string>("$.synsets[*].terms[*].term@string()", res);
	}
}

export const SYNONYMS: { [key: string]: SynonymApi | undefined } = {
	en: new SynonymEn(),
	de: new SynonymDe()
};

function jsonPath<T>(path: string, json: Object): T {
	let res = JSONPath({ path: path, json: json, wrap: false, eval: false });
	if (res == null || res instanceof Array) {
		throw new Error(`JSONPath failed`);
	}
	return res as T;
}
function jsonPathA<T>(path: string, json: Object): T[] {
	let res = JSONPath({ path: path, json: json, wrap: true, eval: false });
	if (res == null || !(res instanceof Array)) {
		throw new Error(`JSONPath failed`);
	}
	return res as T[];
}
