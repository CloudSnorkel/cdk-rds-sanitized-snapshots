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
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      name: 'Isolated',
    },
  ],
});

// Databases
const rdsStack = new cdk.Stack(app, 'RDS-Sanitized-Snapshotter-RDS');
const mysqlDatabaseInstance = new rds.DatabaseInstance(rdsStack, 'MySQL Instance', {
  vpc,
  engine: rds.DatabaseInstanceEngine.MYSQL,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
  removalPolicy: RemovalPolicy.DESTROY,
  backupRetention: cdk.Duration.days(0),
  deleteAutomatedBackups: true,
});
const mysqlDatabaseCluster = new rds.DatabaseCluster(rdsStack, 'MySQL Cluster', {
  vpc,
  writer: rds.ClusterInstance.provisioned('writer'),
  engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
  backup: {
    retention: cdk.Duration.days(1),
  },
  removalPolicy: RemovalPolicy.DESTROY,
});
(mysqlDatabaseCluster.node.defaultChild as rds.CfnDBCluster).addPropertyDeletionOverride('DBClusterParameterGroupName');
const sourceKey = new kms.Key(rdsStack, 'Key', { description: 'RDS sanitize test source key', removalPolicy: RemovalPolicy.DESTROY });
const postgresDatabaseInstance = new rds.DatabaseInstance(rdsStack, 'Postgres Instance', {
  vpc,
  engine: rds.DatabaseInstanceEngine.POSTGRES,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
  storageEncryptionKey: sourceKey,
  removalPolicy: RemovalPolicy.DESTROY,
  backupRetention: cdk.Duration.days(0),
  deleteAutomatedBackups: true,
});
const postgresDatabaseCluster = new rds.DatabaseCluster(rdsStack, 'Postgres Cluster', {
  vpc,
  writer: rds.ClusterInstance.provisioned('writer'),
  engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
  parameterGroup: rds.ParameterGroup.fromParameterGroupName(rdsStack, 'Parameter Group', 'none'),
  storageEncryptionKey: sourceKey,
  backup: {
    retention: cdk.Duration.days(1),
  },
  removalPolicy: RemovalPolicy.DESTROY,
});
(postgresDatabaseCluster.node.defaultChild as rds.CfnDBCluster).addPropertyDeletionOverride('DBClusterParameterGroupName');

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
  snapshotKey: new kms.Key(sfnStack, 'Snapshot Key', { description: 'RDS sanitize test target key', removalPolicy: RemovalPolicy.DESTROY }), // test re-encryption
}).snapshotter;
// const postgresServerlessSfn = new RdsSanitizedSnapshotter(sfnStack, 'PostgreSQL Serverless Snapshotter', {
//   vpc,
//   databaseCluster: postgresDatabaseServerless,
//   script: 'SELECT 1',
//   snapshotPrefix: 'psql-serverless-snapshot',
// }).snapshotter;

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
  totalTimeout: cdk.Duration.minutes(59), // custom resource have 1 hour limit, so just below that
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
// new cdk.CustomResource(testStack, 'Test PostgreSQL Serverless', {
//   serviceToken: provider.serviceToken,
//   properties: {
//     StepFunctionArn: postgresServerlessSfn.stateMachineArn,
//   },
// });
