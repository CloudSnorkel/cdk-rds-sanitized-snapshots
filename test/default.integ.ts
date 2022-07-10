import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_iam as iam, aws_kms as kms, aws_logs as logs, aws_rds as rds, custom_resources, RemovalPolicy } from 'aws-cdk-lib';
import { RdsSanitizedSnapshotter } from '../src';
import { TestFunction } from '../src/test-function';
import { TestWaitFunction } from '../src/test-wait-function';

const app = new cdk.App();

// VPC
const vpcStack = new cdk.Stack(app, 'RDS-Sanitized-Snapshotter-VPC');
const vpc = new ec2.Vpc(vpcStack, 'VPC', {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      subnetType: ec2.SubnetType.PUBLIC,
      name: 'Public',
    },
    {
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      name: 'Private',
    },
    {
      subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      name: 'Isolated',
    },
  ],
});

// Databases
const rdsStack = new cdk.Stack(app, 'RDS-Sanitized-Snapshotter-RDS');
const mysqlDatabaseInstance = new rds.DatabaseInstance(rdsStack, 'MySQL Instance', {
  vpc,
  engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
  removalPolicy: RemovalPolicy.DESTROY,
  backupRetention: cdk.Duration.days(0),
  deleteAutomatedBackups: true,
});
const mysqlDatabaseCluster = new rds.DatabaseCluster(rdsStack, 'MySQL Cluster', {
  instanceProps: {
    vpc,
  },
  instances: 1,
  engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
  backup: {
    retention: cdk.Duration.days(1),
  },
  removalPolicy: RemovalPolicy.DESTROY,
});
const sourceKey = new kms.Key(rdsStack, 'Key', { description: 'RDS sanitize test source key' });
const postgresDatabaseInstance = new rds.DatabaseInstance(rdsStack, 'Postgres Instance', {
  vpc,
  engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_10 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
  storageEncryptionKey: sourceKey,
  removalPolicy: RemovalPolicy.DESTROY,
  backupRetention: cdk.Duration.days(0),
  deleteAutomatedBackups: true,
});
const postgresDatabaseCluster = new rds.DatabaseCluster(rdsStack, 'Postgres Cluster', {
  instanceProps: {
    vpc,
  },
  instances: 1,
  engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_12_4 }),
  storageEncryptionKey: sourceKey,
  backup: {
    retention: cdk.Duration.days(1),
  },
  removalPolicy: RemovalPolicy.DESTROY,
});

// Step Functions
const sfnStack = new cdk.Stack(app, 'RDS-Sanitized-Snapshotter-SFN');

const mysqlInstanceSfn = new RdsSanitizedSnapshotter(sfnStack, 'MySQL Instance Snapshotter', {
  vpc,
  databaseInstance: mysqlDatabaseInstance,
  script: 'SELECT 1',
  snapshotPrefix: 'mysql-instance-snapshot',
}).snapshotter;
const mysqlClusterSfn = new RdsSanitizedSnapshotter(sfnStack, 'MySQL Cluster Snapshotter', {
  vpc,
  databaseCluster: mysqlDatabaseCluster,
  script: 'SELECT 1',
  snapshotPrefix: 'mysql-cluster-snapshot',
}).snapshotter;
const postgresInstanceSfn = new RdsSanitizedSnapshotter(sfnStack, 'PostgreSQL Instance Snapshotter', {
  vpc,
  databaseInstance: postgresDatabaseInstance,
  script: 'SELECT 1',
  snapshotPrefix: 'psql-instance-snapshot',
  databaseKey: sourceKey, // test encrypted database
}).snapshotter;
const postgresClusterSfn = new RdsSanitizedSnapshotter(sfnStack, 'PostgreSQL Cluster Snapshotter', {
  vpc,
  databaseCluster: postgresDatabaseCluster,
  script: 'SELECT 1',
  snapshotPrefix: 'psql-cluster-snapshot',
  databaseKey: sourceKey,
  snapshotKey: new kms.Key(sfnStack, 'Snapshot Key', { description: 'RDS sanitize test target key' }), // test re-encryption
}).snapshotter;

// Trigger step functions
const testStack = new cdk.Stack(app, 'RDS-Sanitized-Snapshotter-Test');
const provider = new custom_resources.Provider(testStack, 'Provider', {
  onEventHandler: new TestFunction(testStack, 'Test', {
    logRetention: logs.RetentionDays.ONE_DAY,
    initialPolicy: [
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: ['*'],
      }),
    ],
  }),
  isCompleteHandler: new TestWaitFunction(testStack, 'Wait', {
    timeout: cdk.Duration.minutes(3),
    logRetention: logs.RetentionDays.ONE_DAY,
    initialPolicy: [
      new iam.PolicyStatement({
        actions: [
          'states:DescribeExecution',
          'rds:describeDBClusterSnapshots', 'rds:DeleteDBClusterSnapshot', 'rds:DescribeDBSnapshots', 'rds:DeleteDBSnapshot',
        ],
        resources: ['*'],
      }),
    ],
  }),
  logRetention: logs.RetentionDays.ONE_DAY,
});
new cdk.CustomResource(testStack, 'Test MySQL Instance', {
  serviceToken: provider.serviceToken,
  properties: {
    StepFunctionArn: mysqlInstanceSfn.stateMachineArn,
  },
});
new cdk.CustomResource(testStack, 'Test MySQL Cluster', {
  serviceToken: provider.serviceToken,
  properties: {
    StepFunctionArn: mysqlClusterSfn.stateMachineArn,
  },
});
new cdk.CustomResource(testStack, 'Test PostgreSQL Instance', {
  serviceToken: provider.serviceToken,
  properties: {
    StepFunctionArn: postgresInstanceSfn.stateMachineArn,
  },
});
new cdk.CustomResource(testStack, 'Test PostgreSQL Cluster', {
  serviceToken: provider.serviceToken,
  properties: {
    StepFunctionArn: postgresClusterSfn.stateMachineArn,
  },
});
