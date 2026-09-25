import { prisma } from "../../lib/prisma";
import { Channel } from "../ai/channels/types";

/**
 * Section 10–11 of the multi-channel spec: a phone number or Instagram
 * account should always resolve to the SAME SalonFlow client, whichever
 * channel they message from, and a client must never be silently
 * duplicated. The lookup order is:
 *
 *   1. Do we already have a ClientChannelIdentity for this exact
 *      (business, channel, externalUserId)? → that client, done.
 *   2. For WhatsApp specifically, the externalUserId IS a phone number —
 *      try to match an existing Client by phone before creating a new one
 *      (e.g. they were already a walk-in client in the system).
 *   3. Otherwise, create a new Client and link this channel identity to it.
 */
export interface ResolveClientInput {
  businessId: string;
  channel: Channel;
  externalUserId: string;
  displayName?: string;
  phone?: string; // WhatsApp's externalUserId already IS a phone number; Instagram may supply one via profile info
}

export async function resolveOrCreateClientForChannel(input: ResolveClientInput) {
  const existingIdentity = await prisma.clientChannelIdentity.findUnique({
    where: {
      businessId_channel_externalUserId: {
        businessId: input.businessId,
        channel: input.channel,
        externalUserId: input.externalUserId,
      },
    },
  });
  if (existingIdentity) {
    return prisma.client.findUniqueOrThrow({ where: { id: existingIdentity.clientId } });
  }

  const phoneToMatch = input.channel === "WHATSAPP" ? input.externalUserId : input.phone;

  let client = phoneToMatch
    ? await prisma.client.findFirst({ where: { businessId: input.businessId, phone: phoneToMatch } })
    : null;

  if (!client) {
    client = await prisma.client.create({
      data: {
        businessId: input.businessId,
        name: input.displayName ?? "New Client",
        phone: phoneToMatch,
      },
    });
  }

  await prisma.clientChannelIdentity.create({
    data: {
      clientId: client.id,
      businessId: input.businessId,
      channel: input.channel,
      externalUserId: input.externalUserId,
    },
  });

  return client;
}
