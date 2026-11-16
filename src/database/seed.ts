/**
 * Database seed: one Admin, one Regular User and a few sample rooms.
 *
 *   npm run seed        (development, TypeScript)
 *   npm run seed:prod   (compiled, inside the Docker image)
 *
 * Safe to run repeatedly: existing accounts and rooms are left untouched, so
 * a re-deploy never resets a password someone changed. Set
 * SEED_RESET_PASSWORDS=true to force the seed accounts back to the
 * configured passwords.
 *
 * Credentials come from SEED_* environment variables. The defaults below are
 * for local development only: in production the script refuses to run
 * without explicit passwords, so a public server never gets a known login.
 */
import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

interface SeedAccount {
  name: string;
  email: string;
  password: string;
  role: Role;
}

const DEV_DEFAULTS = {
  SEED_ADMIN_EMAIL: 'admin@hotel.test',
  SEED_ADMIN_PASSWORD: 'Admin12345',
  SEED_USER_EMAIL: 'user@hotel.test',
  SEED_USER_PASSWORD: 'User12345',
} as const;

const SAMPLE_ROOMS = [
  {
    name: 'Standard Twin 101',
    description: 'Two single beds, city view, 24 sqm.',
    capacity: 2,
    pricePerNight: 1200,
  },
  {
    name: 'Deluxe King 201',
    description: 'King bed, balcony, 32 sqm.',
    capacity: 2,
    pricePerNight: 2200,
  },
  {
    name: 'Family Suite 301',
    description: 'Two bedrooms and a living area, 55 sqm.',
    capacity: 4,
    pricePerNight: 3900,
  },
  {
    name: 'Executive Suite 401',
    description: 'Corner suite with workspace and lounge access, 60 sqm.',
    capacity: 3,
    pricePerNight: 5200,
  },
  {
    name: 'Group Loft 501',
    description: 'Open loft with six beds for groups, 70 sqm.',
    capacity: 6,
    pricePerNight: 4800,
  },
];

function readSetting(key: keyof typeof DEV_DEFAULTS): string {
  const value = process.env[key]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${key} must be set to seed a production database`);
  }
  return DEV_DEFAULTS[key];
}

async function seedAccount(
  prisma: PrismaClient,
  account: SeedAccount,
  rounds: number,
  resetPassword: boolean,
): Promise<void> {
  const email = account.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && !resetPassword) {
    console.log(`  = ${account.role} ${email} already exists, left unchanged`);
    return;
  }
  const passwordHash = await hash(account.password, rounds);
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { passwordHash, role: account.role },
    });
    console.log(`  ~ ${account.role} ${email} password reset`);
    return;
  }
  await prisma.user.create({
    data: { name: account.name, email, passwordHash, role: account.role },
  });
  console.log(`  + ${account.role} ${email} created`);
}

async function main(): Promise<void> {
  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const resetPasswords = process.env.SEED_RESET_PASSWORDS === 'true';
  const accounts: SeedAccount[] = [
    {
      name: 'Hotel Admin',
      email: readSetting('SEED_ADMIN_EMAIL'),
      password: readSetting('SEED_ADMIN_PASSWORD'),
      role: Role.ADMIN,
    },
    {
      name: 'Demo User',
      email: readSetting('SEED_USER_EMAIL'),
      password: readSetting('SEED_USER_PASSWORD'),
      role: Role.USER,
    },
  ];

  const prisma = new PrismaClient();
  try {
    console.log('Seeding accounts');
    for (const account of accounts) {
      await seedAccount(prisma, account, rounds, resetPasswords);
    }

    console.log('Seeding rooms');
    // Room.name is unique, so rooms that already exist are skipped.
    const { count } = await prisma.room.createMany({
      data: SAMPLE_ROOMS,
      skipDuplicates: true,
    });
    console.log(
      `  + ${count} room(s) created, ${SAMPLE_ROOMS.length - count} already present`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => console.log('Seed finished'))
  .catch((error: unknown) => {
    // Message only: a Prisma error object can carry the connection string.
    console.error(`Seed failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
