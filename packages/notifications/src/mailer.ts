import nodemailer from "nodemailer";

export type MailAttachment = { filename: string; content: Buffer };
export type OutgoingMail = {
  /** Nom affiché de l'expéditeur (ex. « Prénom NOM ») ; l'adresse est celle du compte SMTP. */
  fromName: string;
  to: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
};

export type Mailer = {
  isConfigured(): boolean;
  /** Adresse d'envoi (compte SMTP). */
  address(): string | null;
  send(mail: OutgoingMail): Promise<void>;
};

type Transport = (msg: { from: string; to: string; subject: string; text: string; attachments: MailAttachment[] }) => Promise<unknown>;

export type SmtpConfig = { host?: string | undefined; port?: number | undefined; user?: string | undefined; password?: string | undefined };

/** Bouton « Tester » des Réglages : se connecte au serveur d'envoi et s'identifie, sans envoyer d'email. */
export async function verifySmtp(cfg: SmtpConfig): Promise<void> {
  if (!cfg.host || !cfg.user || !cfg.password) throw new Error("Serveur, adresse ou mot de passe manquant.");
  const port = cfg.port ?? 587;
  const tr = nodemailer.createTransport({
    host: cfg.host,
    port,
    secure: port === 465,
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  try {
    await tr.verify();
  } finally {
    tr.close();
  }
}

/**
 * Envoi d'emails en ton nom (candidatures spontanées), par le même compte SMTP que les notifications (Gmail).
 * Avec Gmail, le message apparaît aussi dans « Messages envoyés ».
 */
export function createMailer(
  cfg: { host?: string | undefined; port?: number | undefined; user?: string | undefined; password?: string | undefined },
  transport?: Transport,
): Mailer {
  const configured = Boolean(cfg.host && cfg.user && cfg.password);
  let t: Transport | undefined = transport;
  const get = (): Transport => {
    if (!t) {
      const tr = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: (cfg.port ?? 587) === 465,
        auth: { user: cfg.user!, pass: cfg.password! },
      });
      t = (msg) => tr.sendMail(msg);
    }
    return t;
  };
  return {
    isConfigured: () => configured || Boolean(transport),
    address: () => cfg.user ?? null,
    async send(mail) {
      if (!configured && !transport) throw new Error("Envoi d'email non configuré (SMTP_HOST, SMTP_USER, SMTP_PASSWORD dans .env).");
      const name = mail.fromName.replace(/["<>]/g, "").trim();
      await get()({
        from: name ? `"${name}" <${cfg.user}>` : cfg.user!,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments,
      });
    },
  };
}
