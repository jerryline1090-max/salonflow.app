jest.mock("../../../lib/prisma");
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { appointmentTransaction, AppointmentConflictError } from "../appointmentTransaction";

const conflict = () => new Prisma.PrismaClientKnownRequestError("internal", { code: "P2034", clientVersion: "test" });
it("uses serializable isolation and retries only recognized conflicts", async () => {
  (prisma.$transaction as jest.Mock).mockRejectedValueOnce(conflict()).mockResolvedValueOnce("committed");
  expect(await appointmentTransaction(async () => "value")).toBe("committed");
  expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
});
it("stops after three attempts with a safe conflict", async () => {
  (prisma.$transaction as jest.Mock).mockRejectedValue(conflict());
  await expect(appointmentTransaction(async () => undefined)).rejects.toBeInstanceOf(AppointmentConflictError);
  expect(prisma.$transaction).toHaveBeenCalledTimes(3);
});
it("does not retry business or arbitrary database failures", async () => {
  const failure = new Error("validation");
  (prisma.$transaction as jest.Mock).mockRejectedValue(failure);
  await expect(appointmentTransaction(async () => undefined)).rejects.toBe(failure);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
