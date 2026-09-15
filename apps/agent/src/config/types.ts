import { z } from 'zod';

export const ObservabilityConfigSchema = z.object({
  stream: z.string(),
  token_env: z.string(),
});

export const AzureConfigSchema = z.object({
  subscription_id: z.string(),
  tenant_id: z.string(),
  sp_env: z.string(),
});

export const AzureDevOpsConfigSchema = z.object({
  org_url: z.string().url(),
  project: z.string(),
  pat_env: z.string(),
});

export const HetznerConfigSchema = z.object({
  account: z.string(),
  token_env: z.string(),
  ssh_hosts: z.array(z.string()).default([]),
});

export const KubernetesConfigSchema = z.object({
  kubeconfig_env: z.string(),
  context: z.string(),
});

export const HttpHealthEndpointSchema = z.object({
  name: z.string(),
  url: z.string().url(),
});

export const HttpHealthConfigSchema = z.object({
  endpoints: z.array(HttpHealthEndpointSchema),
});

export const SslConfigSchema = z.object({
  hosts: z.array(z.string()),
});

export type SystemType =
  | 'observability'
  | 'azure'
  | 'azure_devops'
  | 'hetzner'
  | 'kubernetes'
  | 'http_health'
  | 'ssl';

export type SystemConfig =
  | ({ type: 'observability' } & z.infer<typeof ObservabilityConfigSchema>)
  | ({ type: 'azure' } & z.infer<typeof AzureConfigSchema>)
  | ({ type: 'azure_devops' } & z.infer<typeof AzureDevOpsConfigSchema>)
  | ({ type: 'hetzner' } & z.infer<typeof HetznerConfigSchema>)
  | ({ type: 'kubernetes' } & z.infer<typeof KubernetesConfigSchema>)
  | ({ type: 'http_health' } & z.infer<typeof HttpHealthConfigSchema>)
  | ({ type: 'ssl' } & z.infer<typeof SslConfigSchema>);

export interface Tenant {
  id: string;
  display_name: string;
  systems: SystemConfig[];
}

export const ResourceSchema = z.object({
  id: z.string(),
  type: z.string(),
  owner: z.string(),
  affects: z.array(z.string()),
  notes: z.string().optional(),
});

export type Resource = z.infer<typeof ResourceSchema>;

export interface ResourceGraph {
  resources: Resource[];
}
