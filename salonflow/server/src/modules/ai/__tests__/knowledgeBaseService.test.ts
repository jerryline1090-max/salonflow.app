jest.mock("../../../lib/prisma");
jest.mock("../../../core/auditLog");

import { prisma } from "../../../lib/prisma";
import { writeAuditLog } from "../../../core/auditLog";
import { createKnowledgeBaseEntry, updateKnowledgeBaseEntry, deleteKnowledgeBaseEntry } from "../knowledgeBaseService";

beforeEach(() => {
  (writeAuditLog as jest.Mock).mockResolvedValue(undefined);
});

describe("createKnowledgeBaseEntry", () => {
  it("creates the entry tagged with source OWNER and audits it", async () => {
    const entry = { id: "kb_1", businessId: "biz_1", topic: "parking", answer: "Free parking behind the building" };
    (prisma.knowledgeBaseEntry.create as jest.Mock).mockResolvedValue(entry);

    const result = await createKnowledgeBaseEntry({
      businessId: "biz_1",
      topic: "parking",
      answer: "Free parking behind the building",
      actorUserId: "owner_1",
    });

    expect(result).toBe(entry);
    expect(prisma.knowledgeBaseEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "OWNER" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "create_knowledge_entry" }));
  });
});

describe("updateKnowledgeBaseEntry", () => {
  it("rejects updating an entry from a different business", async () => {
    (prisma.knowledgeBaseEntry.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "kb_1", businessId: "other_biz" });

    await expect(
      updateKnowledgeBaseEntry({ entryId: "kb_1", businessId: "biz_1", actorUserId: "owner_1", updates: { answer: "x" } })
    ).rejects.toThrow(/not found/i);
    expect(prisma.knowledgeBaseEntry.update).not.toHaveBeenCalled();
  });

  it("applies the update", async () => {
    (prisma.knowledgeBaseEntry.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "kb_1", businessId: "biz_1", answer: "old" });
    (prisma.knowledgeBaseEntry.update as jest.Mock).mockResolvedValue({ id: "kb_1", businessId: "biz_1", answer: "new" });

    const updated = await updateKnowledgeBaseEntry({ entryId: "kb_1", businessId: "biz_1", actorUserId: "owner_1", updates: { answer: "new" } });

    expect(updated.answer).toBe("new");
  });
});

describe("deleteKnowledgeBaseEntry", () => {
  it("rejects deleting an entry from a different business", async () => {
    (prisma.knowledgeBaseEntry.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "kb_1", businessId: "other_biz" });

    await expect(deleteKnowledgeBaseEntry("kb_1", "biz_1", "owner_1")).rejects.toThrow(/not found/i);
    expect(prisma.knowledgeBaseEntry.delete).not.toHaveBeenCalled();
  });

  it("deletes the entry and audits it with the previous value preserved", async () => {
    const existing = { id: "kb_1", businessId: "biz_1", answer: "gone soon" };
    (prisma.knowledgeBaseEntry.findUniqueOrThrow as jest.Mock).mockResolvedValue(existing);

    await deleteKnowledgeBaseEntry("kb_1", "biz_1", "owner_1");

    expect(prisma.knowledgeBaseEntry.delete).toHaveBeenCalledWith({ where: { id: "kb_1" } });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "delete_knowledge_entry", previousValue: existing }));
  });
});
