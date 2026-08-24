import { getPrisma } from "./server/services/prismaClient.js";

async function main() {
  const prisma = getPrisma();
  const users = await prisma.user.findMany();
  console.log(users.length, "users found.");
}
main().catch(console.error);
