import { config as loadEnv } from "dotenv";
const envFromFile: Record<string, string> = {};
loadEnv({ processEnv: envFromFile });
console.log(envFromFile.DATABASE_URL);
