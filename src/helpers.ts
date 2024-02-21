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
