const { PrismaClient } = require("@prisma/client");

// Prevent exhausting connection limit in dev with nodemon/hot reload
const globalForPrisma = global;

const prisma = globalForPrisma.__prismaClient || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaClient = prisma;
}

module.exports = prisma;
