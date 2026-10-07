-- Infos d'une offre corrigées à la main : priment sur la source, jamais écrasées par la collecte.
ALTER TABLE "Job" ADD COLUMN "userEdits" JSONB;
ALTER TABLE "Job" ADD COLUMN "userEditsAt" TIMESTAMP(3);
