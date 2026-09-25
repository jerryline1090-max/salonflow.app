import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.create({
    data: {
      name: "Big Kitchen Hair Studio",
      mode: "BOTH",
      homeServiceTravelBufferMins: 30,
      workingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          openTime: "09:00",
          closeTime: "18:00",
          isClosed: dayOfWeek === 0, // closed Sundays
        })),
      },
    },
  });

  const owner = await prisma.user.create({
    data: {
      businessId: business.id,
      name: "Amaka Owner",
      email: "owner@bigkitchen.test",
      passwordHash: await bcrypt.hash("changeme", 10),
      role: "OWNER",
    },
  });

  const knotlessBraids = await prisma.service.create({
    data: {
      businessId: business.id,
      name: "Knotless Braids",
      price: 4_000_000, // ₦40,000 in kobo
      durationMinutes: 180,
      bufferMinutes: 15,
      availableAtSalon: true,
      availableAtHome: true,
      homeTravelBufferMins: 45,
      requiredSkills: ["braiding"],
    },
  });

  const ada = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: "Ada",
      skills: ["braiding"],
      homeServiceEligible: true,
      schedule: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          startTime: "09:00",
          endTime: "18:00",
          isOff: dayOfWeek === 0,
        })),
      },
      services: { create: [{ serviceId: knotlessBraids.id }] },
    },
  });

  await prisma.client.create({
    data: {
      businessId: business.id,
      name: "Sarah Client",
      phone: "+2348000000000",
    },
  });

  console.log("Seeded:", { businessId: business.id, ownerId: owner.id, staffId: ada.id, serviceId: knotlessBraids.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
