import nodemailer from "nodemailer";

export class EmailService {
  /**
   * Helper to obtain active SMTP transporter.
   * Uses variables from the environment if configured.
   * If not configured, returns null to perform sandbox logging.
   */
  private static getTransporter() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === "true";

    if (!user || !pass) {
      return null;
    }

    return nodemailer.createTransport({
      host: host || "smtp.gmail.com",
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  /**
   * Send academic password reset email securely.
   */
  static async sendResetPasswordEmail(
    to: string,
    resetLink: string,
    userName: string
  ): Promise<{ success: boolean; sandbox?: boolean; message?: string }> {
    const from = process.env.SMTP_FROM || '"Medical Portal Reset" <no-reply@example.com>';
    const transporter = this.getTransporter();

    const subject = "🔐 [Security] Reset Your Medical Portal Password";
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fc; padding: 2.5rem; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; color: #1e2d4a;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <h2 style="color: #1e2d4a; margin: 0; font-size: 1.5rem; letter-spacing: -0.025em; font-weight: 700;">Medical Portal</h2>
          <p style="color: #64748b; font-size: 0.875rem; margin-top: 0.25rem;">Academic Password Recovery Department</p>
        </div>
        
        <div style="background-color: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.02); border: 1px solid #edf2f7;">
          <p style="margin-top: 0; color: #1e2d4a; font-size: 1rem; line-height: 1.5;">Hello <strong>${userName}</strong>,</p>
          <p style="color: #4a5568; font-size: 0.95rem; line-height: 1.6;">
            A password reset request was initiated for your peer account. To confirm this request and create your new secure credential, please click the verified authorization button below:
          </p>
          
          <div style="text-align: center; margin: 2rem 0;">
            <a href="${resetLink}" target="_blank" style="background-color: #1e2d4a; color: #fef3c7; text-decoration: none; padding: 12px 28px; font-weight: 600; border-radius: 8px; font-size: 0.95rem; display: inline-block; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); transition: background-color 0.2s;">
              Reset Password Account
            </a>
          </div>
          
          <p style="color: #718096; font-size: 0.85rem; line-height: 1.6; margin-bottom: 0;">
            This security code link is configured for <strong>one-time use</strong> and will expire in <strong>15 minutes</strong> for your safety. If you didn't trigger this recovery, you can safely ignore this correspondence.
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 2rem; border-top: 1px solid #e2e8f0; padding-top: 1.5rem;">
          <p style="color: #a0aec0; font-size: 0.75rem; margin: 0;">Medical Portal Support</p>
          <p style="color: #cbd5e0; font-size: 0.70rem; margin-top: 0.25rem;">Secure connection encrypted natively</p>
        </div>
      </div>
    `;

    if (!transporter) {
      // Do NOT log the reset link or token — even in development, tokens in logs
      // are a security risk (log aggregators, CI output, screenshots).
      console.warn(`[SMTP Sandbox Mode] SMTP is not configured. Reset email NOT sent to: ${to}. Configure SMTP_HOST/SMTP_USER/SMTP_PASS to enable delivery.`);
      
      return {
        success: true,
        sandbox: true,
        message: "Email simulated because SMTP keys are not set in the environment.",
      };
    }

    try {
      await transporter.sendMail({
        from,
        to,
        subject,
        html,
      });
      return { success: true };
    } catch (err: any) {
      console.error("Transporter sendMail error:", "[REDACTED_ERROR]");
      return {
        success: false,
        message: err.message || "Failed to dispatch email via SMTP server.",
      };
    }
  }
}
