import { describe, expect, it } from 'vitest';
import { loadResources, loadTenants, parseResources, parseTenants } from './tenants.js';

describe('parseTenants', () => {
  it('parses a tenant with every system type', () => {
    const yaml = `
tenants:
  - id: acme
    display_name: ACME
    systems:
      - observability:
          stream: acme
          token_env: OBS_TOKEN_ACME
      - azure:
          subscription_id: sub-123
          tenant_id: tenant-456
          sp_env: AZ_SP_MAIN
      - hetzner:
          account: acme
          token_env: HCLOUD_TOKEN_ACME
          ssh_hosts:
            - a.acme.internal
            - b.acme.internal
      - kubernetes:
          kubeconfig_env: KUBECONFIG_ACME
          context: acme-prod
      - ssl:
          hosts: [acme.example, mail.acme.example]
      - http_health:
          endpoints:
            - name: public
              url: https://acme.example
`;
    const tenants = parseTenants(yaml);
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.id).toBe('acme');
    expect(tenants[0]!.display_name).toBe('ACME');
    expect(tenants[0]!.systems).toHaveLength(6);

    const byType = Object.fromEntries(tenants[0]!.systems.map((s) => [s.type, s]));

    expect(byType.observability).toEqual({
      type: 'observability',
      stream: 'acme',
      token_env: 'OBS_TOKEN_ACME',
    });
    expect(byType.hetzner).toMatchObject({
      type: 'hetzner',
      ssh_hosts: ['a.acme.internal', 'b.acme.internal'],
    });
    expect(byType.ssl).toMatchObject({ hosts: ['acme.example', 'mail.acme.example'] });
    expect(byType.http_health).toMatchObject({ endpoints: [{ name: 'public', url: 'https://acme.example' }] });
  });

  it('parses an azure_devops system entry', () => {
    const yaml = `
tenants:
  - id: acme
    display_name: ACME
    systems:
      - azure_devops:
          org_url: https://dev.azure.com/example-org
          project: Platform
          pat_env: ADO_PAT_ACME
`;
    expect(parseTenants(yaml)[0]!.systems[0]!).toEqual({
      type: 'azure_devops',
      org_url: 'https://dev.azure.com/example-org',
      project: 'Platform',
      pat_env: 'ADO_PAT_ACME',
    });
  });

  it('rejects an azure_devops entry with a malformed org_url', () => {
    const yaml = `
tenants:
  - id: acme
    display_name: ACME
    systems:
      - azure_devops:
          org_url: not-a-url
          project: Platform
          pat_env: ADO_PAT_ACME
`;
    expect(() => parseTenants(yaml)).toThrow();
  });

  it('parses multiple tenants', () => {
    const yaml = `
tenants:
  - id: a
    display_name: A
    systems: []
  - id: b
    display_name: B
    systems: []
`;
    expect(parseTenants(yaml)).toHaveLength(2);
  });

  it('rejects a system entry with multiple keys', () => {
    const yaml = `
tenants:
  - id: x
    display_name: X
    systems:
      - observability:
          stream: x
          token_env: T
        azure:
          subscription_id: s
          tenant_id: t
          sp_env: sp
`;
    expect(() => parseTenants(yaml)).toThrow();
  });

  it('rejects an unknown system type', () => {
    const yaml = `
tenants:
  - id: x
    display_name: X
    systems:
      - mystery:
          foo: bar
`;
    expect(() => parseTenants(yaml)).toThrow(/Unknown system type: mystery/);
  });

  it('defaults missing ssh_hosts to an empty array', () => {
    const yaml = `
tenants:
  - id: x
    display_name: X
    systems:
      - hetzner:
          account: x
          token_env: T
`;
    const [tenant] = parseTenants(yaml);
    const h = tenant!.systems[0];
    expect(h).toMatchObject({ type: 'hetzner', ssh_hosts: [] });
  });

  it('rejects an empty id', () => {
    const yaml = `
tenants:
  - id: ""
    display_name: X
    systems: []
`;
    expect(() => parseTenants(yaml)).toThrow();
  });

  it('rejects malformed http_health url', () => {
    const yaml = `
tenants:
  - id: x
    display_name: X
    systems:
      - http_health:
          endpoints:
            - name: bad
              url: not-a-url
`;
    expect(() => parseTenants(yaml)).toThrow();
  });
});

describe('parseResources', () => {
  it('parses the resource graph', () => {
    const yaml = `
resources:
  - id: sql.acme.internal
    type: mssql-server
    owner: acme
    affects: [acme, globex, initech]
    notes: "Shared MSSQL"
  - id: mail.acme.example
    type: smtp-relay
    owner: acme
    affects: [acme, globex, initech, umbrella]
`;
    const graph = parseResources(yaml);
    expect(graph.resources).toHaveLength(2);
    expect(graph.resources[0]).toMatchObject({
      id: 'sql.acme.internal',
      owner: 'acme',
      affects: ['acme', 'globex', 'initech'],
      notes: 'Shared MSSQL',
    });
    expect(graph.resources[1]!.notes).toBeUndefined();
  });

  it('accepts an empty resource list', () => {
    expect(parseResources('resources: []').resources).toEqual([]);
  });

  it('rejects a missing affects field', () => {
    const yaml = `
resources:
  - id: x
    type: y
    owner: z
`;
    expect(() => parseResources(yaml)).toThrow();
  });
});

describe('loadTenants', () => {
  it('explains how to create the file when it is missing', () => {
    expect(() => loadTenants('/nonexistent/tenants.yaml')).toThrow(/tenants\.example\.yaml/);
  });
});

describe('loadResources', () => {
  it('explains how to create the file when it is missing', () => {
    expect(() => loadResources('/nonexistent/resources.yaml')).toThrow(/resources\.example\.yaml/);
  });
});
