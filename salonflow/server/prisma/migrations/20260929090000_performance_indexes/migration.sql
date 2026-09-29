-- Supports tenant-scoped operational list ordering and dashboard/report filters.
CREATE INDEX "Service_businessId_idx" ON "Service"("businessId");
CREATE INDEX "Staff_businessId_idx" ON "Staff"("businessId");
CREATE INDEX "Client_businessId_createdAt_idx" ON "Client"("businessId", "createdAt");
CREATE INDEX "Appointment_businessId_status_startsAt_idx" ON "Appointment"("businessId", "status", "startsAt");
CREATE INDEX "Appointment_businessId_needsAttention_idx" ON "Appointment"("businessId", "needsAttention");
CREATE INDEX "Payment_businessId_createdAt_idx" ON "Payment"("businessId", "createdAt");
CREATE INDEX "Payment_businessId_status_paidAt_idx" ON "Payment"("businessId", "status", "paidAt");
CREATE INDEX "Notification_businessId_isRead_createdAt_idx" ON "Notification"("businessId", "isRead", "createdAt");
CREATE INDEX "Notification_businessId_audience_audienceUserId_createdAt_idx" ON "Notification"("businessId", "audience", "audienceUserId", "createdAt");
