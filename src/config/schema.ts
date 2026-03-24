import { z } from "zod";

const fieldSchema = z.object({
  name: z.string().optional(),
  selector: z.string(),
  value: z.string(),
  action: z.enum(["fill", "select", "check", "uncheck", "click"]).default("fill"),
  /** Wait after this field action (ms) — useful for widgets that validate async */
  delayAfterMs: z.number().int().nonnegative().optional(),
});

const captchaSchema = z.object({
  /**
   * none — no extra step (default).
   * pause_after_fields — after fields, wait pauseMs so a human can solve CAPTCHA in a headed browser, then submit is clicked.
   * wait_for_selector — wait until waitSelector matches (e.g. token ready) before submit.
   */
  strategy: z.enum(["none", "pause_after_fields", "wait_for_selector"]).default("none"),
  /** pause_after_fields: wait duration (ms). Headed only; headless throws unless you use wait_for_selector. */
  pauseMs: z.number().int().positive().optional(),
  waitSelector: z.string().optional(),
  waitTimeoutMs: z.number().int().positive().optional(),
});

const formSchema = z.object({
  /** Scope locators to this form; if omitted, fields are resolved from the page */
  selector: z.string().optional(),
  fields: z.array(fieldSchema).min(1),
  captcha: captchaSchema.optional(),
  submit: z.object({ selector: z.string() }),
});

const liveAgentSchema = z.object({
  /** If false, block is ignored */
  enabled: z.boolean().optional().default(true),
  /** Run live-agent steps before form fills (default: after all forms) */
  runBeforeForms: z.boolean().optional().default(false),
  /** Optional: scope all selectors inside this iframe (e.g. vendor chat embed) */
  frameSelector: z.string().optional(),
  openChatSelector: z.string(),
  messageInputSelector: z.string(),
  /** If omitted, Enter is pressed on the input */
  sendSelector: z.string().optional(),
  visitorMessage: z.string(),
  /**
   * Assert the first agent-side message appears (substring match, visible).
   * Use a distinctive phrase your routing/bot sends when an agent joins.
   */
  agentMessageContains: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});

const successSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_contains"), value: z.string() }),
  z.object({
    type: z.literal("text_visible"),
    value: z.string(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("selector_visible"),
    selector: z.string(),
    timeoutMs: z.number().int().positive().optional(),
  }),
]);

export const siteSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean().optional().default(true),
    url: z.string().url(),
    forms: z.array(formSchema).default([]),
    liveAgent: liveAgentSchema.optional(),
    success: successSchema,
    /** Overrides defaultNotify for this site when present */
    notify: z
      .object({
        emails: z.array(z.string().email()).min(1),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasForms = data.forms.length > 0;
    const hasLive =
      data.liveAgent !== undefined && (data.liveAgent.enabled === undefined || data.liveAgent.enabled !== false);
    if (!hasForms && !hasLive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one form or a liveAgent block (chat smoke test)",
        path: ["forms"],
      });
    }
  });

export const sitesConfigSchema = z.object({
  sites: z.array(siteSchema).min(1),
  defaultNotify: z
    .object({
      /** May be empty (e.g. local fixture configs that never send email). */
      emails: z.array(z.string().email()),
    })
    .optional(),
});

export type SitesConfig = z.infer<typeof sitesConfigSchema>;
export type SiteConfig = z.infer<typeof siteSchema>;
export type FormConfig = z.infer<typeof formSchema>;
export type FieldConfig = z.infer<typeof fieldSchema>;
export type SuccessCheck = z.infer<typeof successSchema>;
