import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

/** Formats de CV acceptés au premier lancement. */
export const CV_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

export class CvFileError extends Error {}

/** Texte d'un CV (PDF, Word .docx ou texte). Un PDF scanné (image) n'a pas de texte : on le dit clairement. */
export async function cvFileToText(fileName: string, data: Buffer): Promise<string> {
  const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  let text: string;
  if (ext === ".pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (ext === ".docx") {
    text = (await mammoth.extractRawText({ buffer: data })).value;
  } else if (ext === ".txt") {
    text = data.toString("utf8");
  } else if (ext === ".doc") {
    throw new CvFileError("Ancien format Word (.doc) : ouvre le CV dans Word et enregistre-le en .docx ou en PDF.");
  } else {
    throw new CvFileError("Format non pris en charge : envoie ton CV en PDF, en Word (.docx) ou en texte (.txt).");
  }
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length < 200) {
    throw new CvFileError(
      "Presque aucun texte trouvé dans ce fichier (CV scanné ou en image ?). Enregistre ton CV en PDF depuis Word / Canva, ou colle son texte à la main.",
    );
  }
  return clean.slice(0, 15_000);
}
