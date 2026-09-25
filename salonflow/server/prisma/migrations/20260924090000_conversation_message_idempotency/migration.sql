-- Meta can retry an already-delivered inbound webhook. Keep the provider
-- message id unique within the normalized SalonFlow conversation.
CREATE UNIQUE INDEX "ConversationMessage_conversationId_externalMessageId_key"
ON "ConversationMessage"("conversationId", "externalMessageId");
