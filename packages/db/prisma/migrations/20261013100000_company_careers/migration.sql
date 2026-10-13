-- Sites carrières d'entreprises remis : liste des entreprises suivies, source désactivée par défaut.
CREATE TABLE "CompanyTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ats" TEXT NOT NULL,
    "boardKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CompanyTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyTarget_ats_boardKey_key" ON "CompanyTarget"("ats", "boardKey");

INSERT INTO "SourceState" ("source", "enabled", "intervalMinutes", "failures", "nextRunAt")
VALUES ('company-careers', false, 30, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("source") DO NOTHING;
