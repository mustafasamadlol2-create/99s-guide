import fs from 'fs';
fs.writeFileSync('materials_db.json', fs.readFileSync('materials_db.json', 'utf8') + ' ');
console.log('Success');
