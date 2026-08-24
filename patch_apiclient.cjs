const fs = require('fs');
const file = 'src/core/api/apiClient.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  'token = await SecureStorage.get("auth_token");',
  `token = await SecureStorage.get("auth_token");
      if (!token && typeof localStorage !== "undefined") {
        token = localStorage.getItem("auth_token");
      }`
);
fs.writeFileSync(file, code);
console.log("Patched apiClient.ts");
