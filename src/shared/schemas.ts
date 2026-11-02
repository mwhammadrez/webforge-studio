import { z } from 'zod'

export const idSchema = z.string().min(1).max(200)
export const pathSchema = z.string().min(1).max(4096)

export const themeSchema = z.enum(['dark', 'light', 'system'])

export const extractionOptionsSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(1).max(120),
  outputRoot: pathSchema.optional(),
  maxFiles: z.number().int().min(1).max(20000),
  maxBytesMb: z.number().int().min(1).max(20480),
  maxDepth: z.number().int().min(0).max(20),
  timeoutSeconds: z.number().int().min(10).max(3600),
  concurrency: z.number().int().min(1).max(8).optional(),
  rendered: z.boolean(),
  includeExternalAssets: z.boolean(),
  respectRobots: z.boolean()
})

export const settingsPatchSchema = z
  .object({
    theme: themeSchema.optional(),
    projectsDir: pathSchema.optional(),
    pluginDir: pathSchema.optional(),
    portStart: z.number().int().min(1024).max(65535).optional(),
    portEnd: z.number().int().min(1024).max(65535).optional(),
    aiBaseUrl: z.string().url().max(2048).optional(),
    aiModel: z.string().min(1).max(120).optional(),
    aiKey: z.string().max(500).optional(),
    extraction: z
      .object({
        maxFiles: z.number().int().min(1).max(20000).optional(),
        maxBytesMb: z.number().int().min(1).max(20480).optional(),
        maxDepth: z.number().int().min(0).max(20).optional(),
        timeoutSeconds: z.number().int().min(10).max(3600).optional(),
        concurrency: z.number().int().min(1).max(8).optional()
      })
      .optional()
  })
  .refine(
    (value) =>
      value.portStart === undefined ||
      value.portEnd === undefined ||
      value.portStart <= value.portEnd,
    { message: 'بازهٔ پورت نامعتبر است.' }
  )

export const editActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(100000) }),
  z.object({ type: z.literal('attr'), name: z.string().min(1).max(100), value: z.string().max(100000) }),
  z.object({ type: z.literal('style'), name: z.string().min(1).max(100), value: z.string().max(2000) }),
  z.object({ type: z.literal('image'), src: z.string().min(1).max(2048), alt: z.string().max(500).optional() }),
  z.object({
    type: z.literal('link'),
    href: z.string().max(2048),
    target: z.string().max(50).optional()
  })
])

export const saveEditSchema = z.object({
  projectId: idSchema,
  file: z.string().min(1).max(1024),
  selector: z.string().min(1).max(4000),
  action: editActionSchema,
  fallbackText: z.string().max(2000).optional()
})

export const replaceImageSchema = z.object({
  projectId: idSchema,
  file: z.string().min(1).max(1024),
  selector: z.string().min(1).max(4000),
  sourcePath: pathSchema
})

export const pluginInputSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'url', 'number', 'boolean', 'select', 'projectPath', 'folder', 'file', 'textarea']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  placeholder: z.string().max(500).optional(),
  help: z.string().max(2000).optional()
})

export const pluginOutputSchema = z.object({
  key: z.string().min(1).max(100),
  type: z.enum(['file', 'folder', 'json']),
  path: z.string().min(1).max(1024),
  label: z.string().max(200).optional()
})

export const pluginManifestSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-_.]*$/i),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  version: z.string().min(1).max(50),
  runtime: z.enum(['node', 'python', 'executable', 'shell', 'builtin']),
  command: z.string().min(1).max(1024),
  args: z.array(z.string().max(2000)).default([]),
  cwd: z.string().max(1024).default('.'),
  inputs: z.array(pluginInputSchema).default([]),
  outputs: z.array(pluginOutputSchema).default([]),
  permissions: z
    .object({
      network: z.boolean().default(false),
      projectWrite: z.boolean().default(false),
      environment: z.array(z.string().max(100)).default([])
    })
    .default({ network: false, projectWrite: false, environment: [] }),
  timeoutSeconds: z.number().int().min(1).max(1800).default(300),
  builtin: z.string().max(100).optional(),
  icon: z.string().max(100).optional()
})

export const pluginRunSchema = z.object({
  pluginId: idSchema,
  projectId: idSchema.nullable().optional(),
  inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
})

export const aiBriefSchema = z.object({
  brief: z.string().min(10).max(20000),
  businessName: z.string().max(200).default(''),
  audience: z.string().max(500).default(''),
  language: z.enum(['fa', 'en']).default('fa'),
  pageCount: z.number().int().min(1).max(12),
  style: z.string().max(500).default(''),
  colors: z.string().max(500).default(''),
  sections: z.array(z.string().max(100)).max(30).default([]),
  outputRoot: pathSchema.optional()
})

export const aiPlanApproveSchema = z.object({
  brief: aiBriefSchema,
  plan: z.unknown()
})

export const githubSearchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  page: z.number().int().min(1).max(20).default(1),
  sort: z.enum(['stars', 'updated', 'best-match']).default('best-match')
})

export const qaRunSchema = z.object({
  projectId: idSchema,
  pages: z.array(z.string().max(1024)).max(60).default([]),
  checks: z
    .array(z.enum(['html', 'links', 'a11y', 'seo', 'performance', 'console', 'responsive', 'security']))
    .default(['html', 'links', 'a11y', 'seo', 'performance', 'console', 'responsive'])
})

export const projectIdSchema = z.object({ projectId: idSchema })
export const renameProjectSchema = z.object({ projectId: idSchema, name: z.string().trim().min(1).max(120) })
export const removeProjectSchema = z.object({ projectId: idSchema, deleteFiles: z.boolean().default(false) })
export const filePathSchema = z.object({ projectId: idSchema, relativePath: z.string().min(1).max(1024) })
export const pluginIdSchema = z.object({ pluginId: idSchema })
export const pluginToggleSchema = z.object({ pluginId: idSchema, enabled: z.boolean() })
export const pluginRemoveSchema = z.object({ pluginId: idSchema })
export const cancelRunSchema = z.object({ runId: idSchema })
export const aiCancelSchema = z.object({ jobId: idSchema })
export const openPathSchema = z.object({ path: pathSchema })
export const githubRepoSchema = z.object({ fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })

export type ExtractionOptionsInput = z.infer<typeof extractionOptionsSchema>
export type SaveEditInput = z.infer<typeof saveEditSchema>
export type PluginManifestInput = z.infer<typeof pluginManifestSchema>
export type AiBriefInput = z.infer<typeof aiBriefSchema>
