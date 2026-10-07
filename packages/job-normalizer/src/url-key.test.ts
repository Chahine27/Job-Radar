import { describe, expect, it } from "vitest";
import { urlKey } from "./text";

describe("urlKey : même annonce, liens différents", () => {
  it("LinkedIn : seul l'identifiant compte (fr./www., titre dans le lien, suivi)", () => {
    const key = "linkedin.com/jobs/view/4474244898";
    expect(urlKey("https://fr.linkedin.com/jobs/view/assistant-e-comptable-at-nordia-4474244898?position=6&pageNum=0&refId=x&trackingId=y")).toBe(key);
    expect(urlKey("https://www.linkedin.com/jobs/view/assistant-e-comptable-at-nordia-4474244898/?refId=z")).toBe(key);
    expect(urlKey("https://www.linkedin.com/jobs/view/4474244898")).toBe(key);
    expect(urlKey("https://www.linkedin.com/jobs/search/?currentJobId=4474244898&keywords=comptable")).toBe(key);
  });

  it("ailleurs : paramètres de suivi retirés, paramètres utiles gardés", () => {
    expect(urlKey("https://www.exemple-emploi.fr/fr-fr/emplois/83841806.html?utm_source=x")).toBe("exemple-emploi.fr/fr-fr/emplois/83841806.html");
    expect(urlKey("https://ex.fr/offre.php?id=1")).not.toBe(urlKey("https://ex.fr/offre.php?id=2"));
  });

  it("applications d'une seule page : l'offre est dans la route « #/… »", () => {
    const a = urlKey("https://recrutement.exemple.fr/p/#/apply/job/so1tfzjse98/aide-soignant");
    const b = urlKey("https://recrutement.exemple.fr/p/#/apply/job/dli4rf29eb8/aide-soignant");
    expect(a).not.toBe(b);
  });

  it("pas une URL → null", () => {
    expect(urlKey(null)).toBeNull();
    expect(urlKey("pas un lien")).toBeNull();
    expect(urlKey("mailto:rh@ex.fr")).toBeNull();
  });
});
