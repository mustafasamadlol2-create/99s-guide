import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ take: 1 });
  if (!users.length) return console.log("No users.");
  
  const user = users[0];
  const token = jwt.sign({ userId: user.id, email: user.email, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET || "default", { algorithm: "HS256" });
  
  const res = await fetch("http://localhost:3000/api/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  
  console.log("Status /auth/me:", res.status);
  const text = await res.text();
  console.log("Response /auth/me:", text.substring(0, 500));
}
main().catch(console.error);
