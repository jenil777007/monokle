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

export type SarifResult = {
  ruleId: string;
  ruleIndex: number;
  level: string; // note
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string; // filepath
        uriBaseId: string;
      };
      region: {
        startLine: number;
      };
    };
  }>;
};

export type SarifOutput = {
  version: string;
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        fullName: string;
        informationUri: string;
        rules: SarifRule[];
      };
      results: SarifResult[];
    };
  }>;
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
