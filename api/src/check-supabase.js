import { createSupabaseStorage } from './storage.js';
import { entrySchemas, resources } from '@bep-nha/shared';

// Read only: no insert, update, delete, migration or seed against the user's project.
try {
  const storage = createSupabaseStorage();
  let valid = true;
  for (const resource of resources) {
    try {
      const rows = await storage.list(resource, '');
      const incompatible = rows.filter(row => !entrySchemas[resource].safeParse(row).success).length;
      console.log(`${resource}: ${rows.length} records; ${incompatible} records do not match the application fields.`);
      if (incompatible) valid = false;
    } catch { console.error(`${resource}: cannot read. Check table name, schema, columns, key and access permissions.`); valid = false; }
  }
  process.exitCode = valid ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
