import { z } from "zod";

const fieldSchema = z.object({
  name: z.string().optional(),
  selector: z.string(),
  value: z.string(),
  action: z.enum(["fill", "select", "check", "uncheck"]).default("fill"),
});

const formSchema = z.object({
  /** Scope locators to this form; if omitted, fields are resolved from the page */
  selector: z.string().optional(),
  fields: z.array(fieldSchema).min(1),
  submit: z.object({ selector: z.string() }),
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

export const siteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  url: z.string().url(),
  forms: z.array(formSchema).min(1),
  success: successSchema,
  /** Overrides defaultNotify for this site when present */
  notify: z
    .object({
      emails: z.array(z.string().email()).min(1),
    })
    .optional(),
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
