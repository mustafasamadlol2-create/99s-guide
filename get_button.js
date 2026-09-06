import fs from 'fs';
const html = fs.readFileSync('index.html', 'utf8'); // Wait, index.html doesn't have the rendered DOM.
// We need to look at the React source code.
