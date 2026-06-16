import { translate } from '../src/lib/authoring/rule-translator';
const vocab = JSON.parse(await Bun.file('docs/parts/vocabulary.json').text());
const term = process.argv[2] ?? 'shaft';
console.log(translate(term, vocab));
