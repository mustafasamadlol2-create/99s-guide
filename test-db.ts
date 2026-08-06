import { getPrisma } from "./server/services/prismaClient.js";
async function run() {
  const prisma = getPrisma();
  console.log(await prisma.$queryRaw`SELECT 1 as result`);
}
run();
