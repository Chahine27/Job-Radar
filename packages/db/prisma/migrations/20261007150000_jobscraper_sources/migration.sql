-- ESSAI JobScraper : sources désactivées par défaut, une collecte par jour (réglable jusqu'à 20 min).
INSERT INTO "SourceState" ("source", "enabled", "intervalMinutes", "failures", "nextRunAt")
VALUES
  ('jobscraper:linkedin', false, 1440, 0, CURRENT_TIMESTAMP),
  ('jobscraper:hellowork', false, 1440, 0, CURRENT_TIMESTAMP),
  ('jobscraper:wttj', false, 1440, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("source") DO NOTHING;
