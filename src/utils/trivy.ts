import {ResourceValidationError} from '@models/k8sresource';

import {CommandOptions, runCommandInMainThread} from './command';

export type SarifRule = {
  id: string;
  name: string;
  shortDescription: {
    text: string;
  };
  fullDescription: {
    text: string;
  };
  defaultConfiguration: {
    level: string;
  };
  helpUri: string;
  help: {
    text: string;
  };
  properties: {
    precision: string; // 'very-high' | others
    'security-severity': string; // 2.0 number?
    tags: string[];
  };
};

export type LogicalLocation = {
  kind: 'resource';
  name: string; // resource.name
  decoratedName: string; // resource.id
  fullyQualifiedName: string; // ${kind}.${namespace}.${resourceName}
};

export type SarifResult = {
  ruleId: string;
  ruleIndex: number;
  level: string; // note
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation?: {
      artifactLocation: {
        uri: string; // filepath
        uriBaseId: string;
      };
      region: {
        startLine: number;
      };
    };
    logicalLocation?: LogicalLocation[];
  }>;
};

export type SarifRun = {
  tool: {
    driver: {
      name: string;
      version: string;
      fullName: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
};

export type SarifOutput = {
  version: string;
  $schema: string;
  runs: SarifRun[];
};

export function buildTrivyCommand(filePath: string): string[] {
  const args = ['trivy', '--quiet', 'config', '--format=sarif', filePath];

  return args;
}

export function createTrivyResult(raw: string): SarifOutput {
  return JSON.parse(raw);
}

export async function runTrivy(filePath: string): Promise<SarifOutput> {
  const args = buildTrivyCommand(filePath);

  const commandOptions: CommandOptions = {
    cmd: 'trivy',
    args: args.splice(1),
  };

  const result = await runCommandInMainThread(commandOptions);

  if (result.error || !result.stdout) {
    console.error('TRIVY FAILED', result.error, result.stdout);
    throw new Error('trivy failed');
  }

  console.log('TRIVY RAW', result.stdout);
  return createTrivyResult(result.stdout);
}

export function mapToResourceValidationError(violation: SarifResult): ResourceValidationError {
  return {
    property: 'no property available',
    message: violation.ruleId,
    description: violation.message.text,
    errorPos: {
      line: 1,
      column: 0,
      length: 1,
    },
  };
}
