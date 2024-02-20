
export function hashString(value: string): number {
	let hash = 0;
	if (value.length === 0) {
		return hash;
	}
	for (let i = 0; i < value.length; i++) {
		const char = value.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash &= hash; // Convert to 32bit integer
	}
	return hash;
}

// Assign a CSS class based on a rule's category ID
export function categoryCssClass(categoryId: string): string {
	switch (categoryId) {
		case 'COLLOQUIALISMS':
		case 'REDUNDANCY':
		case 'STYLE':
		case 'SYNONYMS':
			return 'lt-style';
		case 'PUNCTUATION':
		case 'TYPOS':
			return 'lt-major';
	}

	return 'lt-minor';
}
