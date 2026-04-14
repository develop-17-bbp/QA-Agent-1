export async function loadKeywordLists() { return { lists: [] }; }
export async function saveKeywordList(name: string, keywords: string[]) { return { name, keywords }; }
export async function deleteKeywordList(name: string) { return { deleted: name }; }
export async function analyzeKeywordList(keywords: string[]) { return { clusters: [], priority: [] }; }
