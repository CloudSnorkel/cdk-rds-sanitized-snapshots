const { awscdk } = require('projen');
const { Stability } = require('projen/lib/cdk/jsii-project');

const project = new awscdk.AwsCdkConstructLibrary({
  author: 'Amir Szekely',
  authorAddress: 'amir@cloudsnorkel.com',
  stability: Stability.EXPERIMENTAL,
  cdkVersion: '2.146.0', // 2.85.0 for no more deprecated nodejs 14 in integration test, 2.217.0 for lambda log settings, 2.146.0 for determineLatestNodeRuntime
  defaultReleaseBranch: 'main',
  name: '@cloudsnorkel/cdk-rds-sanitized-snapshots',
  repositoryUrl: 'https://github.com/CloudSnorkel/cdk-rds-sanitized-snapshots.git',
  license: 'Apache-2.0',
  description: 'CDK construct to periodically take snapshots of RDS databases, sanitize them, and share with selected accounts.',
  devDeps: [
    'esbuild', // for faster NodejsFunction bundling
    '@aws-sdk/client-resource-groups-tagging-api',
    '@aws-sdk/client-rds',
    '@aws-sdk/client-sfn',
    '@types/aws-lambda',
  ],
  deps: [
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
  publishToPypi: {
    distName: 'cloudsnorkel.cdk-rds-sanitized-snapshots',
    module: 'cloudsnorkel.cdk_rds_sanitized_snapshots',
    trustedPublishing: true,
  },
  publishToGo: {
    moduleName: 'github.com/CloudSnorkel/cdk-rds-sanitized-snapshots-go',
  },
  publishToMaven: {
    mavenGroupId: 'com.cloudsnorkel',
    mavenArtifactId: 'cdk.rds.sanitized-snapshots',
    javaPackage: 'com.cloudsnorkel.cdk.rds.sanitizedsnapshots',
    mavenServerId: 'central-ossrh',
  },
  publishToNuget: {
    dotNetNamespace: 'CloudSnorkel',
    packageId: 'CloudSnorkel.Cdk.Rds.SanitizedSnapshots',
    trustedPublishing: true,
  },
  keywords: [
    'aws',
    'aws-cdk',
    'aws-cdk-construct',
    'cdk',
    'rds',
    'snapshots',
  ],
  gitignore: [
    'cdk.out',
    'cdk.context.json',
    '/.idea',
  ],
  sampleCode: false,
  compat: true,
  autoApproveOptions: {
    allowedUsernames: ['kichik', 'CloudSnorkelBot'],
  },
  depsUpgradeOptions: {
    workflowOptions: {
      labels: ['auto-approve'],
      schedule: {
        cron: ['0 0 1 * *'],
      },
    },
  },
  githubOptions: {
    pullRequestLintOptions: {
      semanticTitleOptions: {
        types: [
          'feat',
          'fix',
          'chore',
          'docs',
        ],
      },
    },
  },
  jestOptions: {
    jestVersion: '^27.0.0', // 28 requires a later typescript version
  },
  pullRequestTemplate: false,
});

// disable automatic releases, but keep workflow that can be triggered manually
const releaseWorkflow = project.github.tryFindWorkflow('release');
releaseWorkflow.file.addDeletionOverride('on.push');

// set proper line endings
project.gitattributes.addAttributes('.git*', 'eol=lf');
project.gitattributes.addAttributes('.npmignore', 'eol=lf');
project.gitattributes.addAttributes('yarn.lock', 'eol=lf');
project.gitattributes.addAttributes('*.md', 'eol=lf');
project.gitattributes.addAttributes('*.ts', 'eol=lf');
project.gitattributes.addAttributes('*.js', 'eol=lf');
project.gitattributes.addAttributes('*.json', 'eol=lf');
project.gitattributes.addAttributes('*.sh', 'eol=lf');
project.gitattributes.addAttributes('*.yml', 'eol=lf');

// funding
project.package.addField('funding', 'https://github.com/sponsors/CloudSnorkel');

project.synth();
