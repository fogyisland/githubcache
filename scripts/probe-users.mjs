// Temporary probe — list all users in the dev DB so we can find an operator
// (or confirm there isn't one and create one).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  select: { email: true, role: true, status: true },
});
console.log(JSON.stringify(users, null, 2));
await prisma.$disconnect();