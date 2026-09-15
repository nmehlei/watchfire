import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  AzureConfigSchema,
  AzureDevOpsConfigSchema,
  HetznerConfigSchema,
  HttpHealthConfigSchema,
  KubernetesConfigSchema,
  ObservabilityConfigSchema,
  ResourceSchema,
  SslConfigSchema,
  type ResourceGraph,
  type SystemConfig,
  type Tenant,
} from './types.js';

const SystemEntrySchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).length === 1, {
    message: 'Each system entry must have exactly one key (the system type).',
  });

function parseSystemEntry(raw: unknown): SystemConfig {
  const parsed = SystemEntrySchema.parse(raw);
  const entries = Object.entries(parsed);
  const entry = entries[0];
  if (!entry) throw new Error('System entry is empty.');
  const [typeKey, config] = entry;

  switch (typeKey) {
    case 'observability':
      return { type: 'observability', ...ObservabilityConfigSchema.parse(config) };
    case 'azure':
      return { type: 'azure', ...AzureConfigSchema.parse(config) };
    case 'azure_devops':
      return { type: 'azure_devops', ...AzureDevOpsConfigSchema.parse(config) };
    case 'hetzner':
      return { type: 'hetzner', ...HetznerConfigSchema.parse(config) };
    case 'kubernetes':
      return { type: 'kubernetes', ...KubernetesConfigSchema.parse(config) };
    case 'http_health':
      return { type: 'http_health', ...HttpHealthConfigSchema.parse(config) };
    case 'ssl':
      return { type: 'ssl', ...SslConfigSchema.parse(config) };
    default:
      throw new Error(`Unknown system type: ${typeKey}`);
  }
}

const TenantRawSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().min(1),
  systems: z.array(z.unknown()),
});

const TenantsFileSchema = z.object({
  tenants: z.array(TenantRawSchema),
});

export function parseTenants(yamlText: string): Tenant[] {
  const raw = parseYaml(yamlText);
  const { tenants } = TenantsFileSchema.parse(raw);
  return tenants.map((t) => ({
    id: t.id,
    display_name: t.display_name,
    systems: t.systems.map(parseSystemEntry),
  }));
}

/**
 * Read a config file, turning the bare ENOENT into something a first-time
 * operator can act on: the repo ships examples, the real files are theirs.
 */
function readConfig(path: string, example: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Config file not found: ${path}. Copy config/${example} to it and fill in your own values (see docs/usage.md).`,
      );
    }
    throw err;
  }
}

export function loadTenants(path: string): Tenant[] {
  return parseTenants(readConfig(path, 'tenants.example.yaml'));
}

const ResourcesFileSchema = z.object({
  resources: z.array(ResourceSchema),
});

export function parseResources(yamlText: string): ResourceGraph {
  const raw = parseYaml(yamlText);
  return ResourcesFileSchema.parse(raw);
}

export function loadResources(path: string): ResourceGraph {
  return parseResources(readConfig(path, 'resources.example.yaml'));
}
