// Writes the JSON Schemas (source of truth: src/lib/model/schema.ts) to schema/*.json for editors.
import { mkdirSync, writeFileSync } from 'node:fs';
import { modelSchema, profileSchema } from '../src/lib/model/schema.js';

mkdirSync('schema', { recursive: true });
writeFileSync('schema/model.schema.json', JSON.stringify(modelSchema, null, '\t') + '\n');
writeFileSync('schema/profile.schema.json', JSON.stringify(profileSchema, null, '\t') + '\n');
console.log('wrote schema/model.schema.json, schema/profile.schema.json');
