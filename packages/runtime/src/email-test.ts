import { createEmailSender, loadEmailConfig } from "./email.js";

/** Operator-only synthetic check; no database reads, OTPs or reporter records. */
export async function runEmailTest(
  scope: "STAFF" | "PRIVACY",
  recipient = process.argv[2],
) {
  const mail = createEmailSender(loadEmailConfig(scope));
  try {
    if (!recipient || process.argv.length !== 3) throw new Error();
    await mail.send({
      to: recipient,
      subject: `Speak Up ${scope === "STAFF" ? "staff" : "private service"} email test`,
      text: "This is a synthetic email configuration check. It contains no report, verification code or account link.",
    });
    console.log(
      "Email accepted by the configured provider; inbox receipt is not yet confirmed.",
    );
  } catch {
    console.error(
      "Email test failed. Check provider configuration; no private details were logged.",
    );
    process.exitCode = 1;
  } finally {
    mail.close();
  }
}
