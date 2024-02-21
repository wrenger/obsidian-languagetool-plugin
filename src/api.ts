import * as Remark from 'annotatedtext-remark';
import { LTSettings } from './settingsTab';

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

interface LTResponse {
	// software: Software;
	// language: Language;
	matches?: MatchesEntity[];
}
interface MatchesEntity {
	message: string;
	shortMessage: string;
	replacements?: { value: string }[];
	offset: number;
	length: number;
	context: Context;
	sentence: string;
	rule: Rule;
}
interface Context {
	text: string;
	offset: number;
	length: number;
}
interface Rule {
	id: string;
	subId: string;
	description: string;
	urls: { value: string }[];
	issueType: string;
	category: Category;
}
interface Category {
	id: string;
	name: string;
}

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

	let preferredVariants = [];
	if (settings.englishVariety)
		preferredVariants.push(settings.englishVariety);
	if (settings.germanVariety)
		preferredVariants.push(settings.germanVariety);
	if (settings.portugueseVariety)
		preferredVariants.push(settings.portugueseVariety);
	if (settings.catalanVariety)
		preferredVariants.push(settings.catalanVariety);
	params.preferredVariants = preferredVariants.join(',');

	if (settings.apikey && settings.username) {
		params.username = settings.username;
		params.apiKey = settings.apikey;
	}

	let res: Response;
	try {
		res = await fetch(`${settings.serverUrl}/v2/check`, {
			method: 'POST',
			body: new URLSearchParams(params),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
		});
	} catch (e) {
		console.log(e);
		throw new Error(`Request to LanguageTool failed: Please check your connection and server URL.\n${e}`);
	}
	if (!res.ok) {
		throw new Error(`Request to LanguageTool failed: Unexpected response status: ${res.statusText}`);
	}

	let body: LTResponse;
	try {
		body = await res.json();
	} catch (e) {
		throw new Error(`Error processing response from LanguageTool server: ${e.message}`);
	}

	return body.matches?.map(match => {
		return {
			text: text.slice(match.offset, match.offset + match.length),
			from: offset + match.offset,
			to: offset + match.offset + match.length,
			title: match.shortMessage,
			message: match.message,
			replacements: match.replacements?.map(r => r.value) ?? [],
			categoryId: match.rule.category.id,
			ruleId: match.rule.id,
		};
	}) ?? [];
}

export async function synonyms(sentence: string, selection: { from: number; to: number }): Promise<string[]> {
	const URL = "https://qb-grammar-en.languagetool.org/phrasal-paraphraser/subscribe";

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

	let res: Response;
	try {
		res = await fetch(URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(request)
		});
	} catch (e) {
		return Promise.reject(e);
	}
	if (!res.ok) {
		return Promise.reject(new Error(`unexpected status ${res.status}`));
	}

	let body: any;
	try {
		body = await res.json();
	} catch (e) {
		return Promise.reject(e);
	}
	if (body.message !== "OK"
		|| body.data == undefined
		|| !(body.data.suggestions instanceof Object)
		|| !(body.data.suggestions[word] instanceof Array)) {
		return Promise.reject(new Error("Invalid response from server"));
	}
	return body.data.suggestions[word] as string[];
}
