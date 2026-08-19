const fs = require('fs');
const file = 'server.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  'return res.status(401).json({ error: "Authentication required." });',
  `console.log("401 NO TOKEN"); return res.status(401).json({ error: "Authentication required." });`
);
code = code.replace(
  'return res.status(401).json({ error: "Access denied. Scoped PDF token cannot be used as an API session." });',
  `console.log("401 SCOPED PDF"); return res.status(401).json({ error: "Access denied. Scoped PDF token cannot be used as an API session." });`
);
code = code.replace(
  'return res.status(401).json({ error: "Access denied. Session has been revoked." });',
  `console.log("401 REVOKED"); return res.status(401).json({ error: "Access denied. Session has been revoked." });`
);
code = code.replace(
  'return res.status(401).json({ error: "Access denied. Student account not found." });',
  `console.log("401 NOT FOUND"); return res.status(401).json({ error: "Access denied. Student account not found." });`
);
code = code.replace(
  'return res.status(401).json({ error: "Access denied. Session is no longer valid." });',
  `console.log("401 INVALID SESSION", decoded.sessionVersion, user.sessionVersion); return res.status(401).json({ error: "Access denied. Session is no longer valid." });`
);
fs.writeFileSync(file, code);
