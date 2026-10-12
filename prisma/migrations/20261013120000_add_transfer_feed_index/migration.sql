-- CreateIndex
CREATE INDEX "transfers_executed_at_id_idx" ON "transfers"("executed_at" DESC, "id" DESC);
