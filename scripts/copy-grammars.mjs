// Copies the prebuilt tree-sitter grammars (.wasm) from their npm packages into grammars/, so the
// built package ships them and needs none of those packages at run time.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const grammars = [
	['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
	['tree-sitter-typescript', 'tree-sitter-tsx.wasm'],
	['tree-sitter-javascript', 'tree-sitter-javascript.wasm']
];
mkdirSync('grammars', { recursive: true });
for (const [pkg, file] of grammars) copyFileSync(require.resolve(`${pkg}/${file}`), `grammars/${file}`);
console.log(`wrote grammars/ (${grammars.length} files)`);
