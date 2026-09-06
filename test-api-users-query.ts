import { PrismaClient } from "@prisma/client";
const client = new PrismaClient();
async function main() {
  try {
    const prismaUsers = await client.user.findMany({
      take: 200,
      orderBy: [{ isOnline: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        avatarUrl: true,
         role: true,
         isPrimaryOwner: true,
         isOnline: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
        studentGroup: true,
        accountStatus: true,
      },
    });
    console.log("Success! Found", prismaUsers.length);
  } catch (err) {
    console.error("Failed:", err);
  }
}
main().catch(console.error);
