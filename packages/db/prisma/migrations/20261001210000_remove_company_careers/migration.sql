-- Pages carrières retirées : liste des entreprises suivies et réglage de la source supprimés.
-- Les offres déjà collectées restent (elles expirent seules).
DROP TABLE "CompanyTarget";
DELETE FROM "SourceState" WHERE "source" = 'company-careers';
