import fs from 'fs';
import path from 'path';

const docsDir = path.join('/Volumes/SSD/Projects/nikcli/packages/web/src/pages/docs');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.astro')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Additional cleanups for specific table, pre, and standard markdown elements
      // For instance, wrapping tables if not wrapped (prose handles this generally, but let's make sure code inside paragraphs doesn't break)
      
      fs.writeFileSync(fullPath, content);
    }
  }
}

processDir(docsDir);
