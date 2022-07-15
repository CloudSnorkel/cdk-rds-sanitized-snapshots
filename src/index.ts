import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_events as events,
  aws_events_targets as events_targets,
  aws_iam as iam,
  aws_kms as kms,
  aws_logs as logs,
  aws_rds as rds,
  aws_stepfunctions as stepfunctions,
  aws_stepfunctions_tasks as stepfunctions_tasks,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeleteOldFunction } from './delete-old-function';
import { ParametersFunction } from './parameters-function';
import { WaitFunction } from './wait-function';

export interface IRdsSanitizedSnapshotter {
  /**
   * Database cluster to snapshot and sanitize.
   *
   * Only one of `databaseCluster` and `databaseInstance` can be specified.
   */
  readonly databaseCluster?: rds.IDatabaseCluster;

  /**
   * Database instance to snapshot and sanitize.
   *
   * Only one of `databaseCluster` and `databaseInstance` can be specified.
   */
  readonly databaseInstance?: rds.IDatabaseInstance;

  /**
   * KMS key used to encrypt original database, if any.
   */
  readonly databaseKey?: kms.IKey;

  /**
   * VPC where temporary database and sanitizing task will be created.
   */
  readonly vpc: ec2.IVpc;

  /**
   * VPC subnets to use for temporary databases.
   *
   * @default ec2.SubnetType.PRIVATE_ISOLATED
   */
  readonly dbSubnets?: ec2.SubnetSelection;

  /**
   * VPC subnets to use for sanitization task.
   *
   * @default ec2.SubnetType.PRIVATE_WITH_NAT
   */
  readonly sanitizeSubnets?: ec2.SubnetSelection;

  /**
   * Cluster where sanitization task will be executed.
   *
   * @default a new cluster running on given VPC
   */
  readonly fargateCluster?: ecs.ICluster;

  /**
   * SQL script used to sanitize the database. It will be executed against the temporary database.
   *
   * You would usually want to start this with `USE mydatabase;`.
   */
  readonly script: string;

  /**
   * Optional KMS key to encrypt target snapshot.
   */
  readonly snapshotKey?: kms.IKey;

  /**
   * Prefix for sanitized snapshot name. The current date and time will be added to it.
   *
   * @default cluster identifier (which might be too long)
   */
  readonly snapshotPrefix?: string;

  /**
   * Prefix for all temporary snapshots and databases. The step function execution id will be added to it.
   *
   * @default 'sanitize'
   */
  readonly tempPrefix?: string;

  /**
   * The schedule or rate (frequency) that determines when the sanitized snapshot runs automatically.
   */
  readonly schedule?: events.Schedule;

  /**
   * Limit the number of snapshot history. Set this to delete old snapshots and only leave a certain number of snapshots.
   */
  readonly snapshotHistoryLimit?: number;
}

/**
 * A process to create sanitized snapshots of RDS instance or cluster, optionally on a schedule. The process is handled by a step function.
 *
 * 1. Snapshot the source database
 * 2. Optionally re-ncrypt the snapshot with a different key in case you want to share it with an account that doesn't have access to the original key
 * 3. Create a temporary database
 * 4. Run a Fargate task to connect to the temporary database and execute an arbitrary SQL script to sanitize it
 * 5. Snapshot the sanitized database
 * 6. Clean-up temporary snapshots and databases
 */
export class RdsSanitizedSnapshotter extends Construct {
  private waitFn: WaitFunction | undefined;

  private readonly securityGroup: ec2.SecurityGroup;
  private readonly subnetGroup: rds.SubnetGroup;
  private readonly subnets: ec2.SubnetSelection;
  private readonly fargateCluster: ecs.ICluster;
  private readonly sqlScript: string;
  private readonly reencrypt: boolean;

  private readonly generalTags: {Key: string; Value: string}[];
  private readonly finalSnapshotTags: {Key: string; Value: string}[];
  private readonly databaseIdentifier: string;
  private readonly snapshotPrefix: string;
  private readonly tempPrefix: string;
  private readonly isCluster: boolean;
  private readonly dbClusterArn: string;
  private readonly dbInstanceArn: string;
  private readonly targetSnapshotArn: string;
  private readonly tempSnapshotArn: string;
  private readonly tempDbClusterArn: string;
  private readonly tempDbInstanceArn: string;

  /**
   * Step function in charge of the entire process including snapshotting, sanitizing, and cleanup. Trigger this step function to get a new snapshot.
   */
  public snapshotter: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, readonly props: IRdsSanitizedSnapshotter) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, 'SG', {
      description: 'Group for communication between sanitizing job and database',
      vpc: props.vpc,
    });
    cdk.Tags.of(this.securityGroup).add('Name', 'RDS-sanitized-snapshots');

    this.subnetGroup = new rds.SubnetGroup(this, 'Subnet group', {
      description: 'Temporary database used for RDS-sanitize-snapshots',
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets(props.dbSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }),
    });

    this.subnets = props.sanitizeSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT };
    this.fargateCluster = props.fargateCluster ?? new ecs.Cluster(this, 'cluster', { vpc: props.vpc });
    this.sqlScript = props.script;

    if (this.subnets.subnetType === ec2.SubnetType.PRIVATE_ISOLATED) {
      cdk.Annotations.of(this).addWarning('Isolated subnets may not work for sanitization task as it requires access to public ECR');
    }

    if (props.databaseCluster) {
      this.isCluster = true;
      this.databaseIdentifier = props.databaseCluster.clusterIdentifier;
    } else if (props.databaseInstance) {
      this.isCluster = false;
      this.databaseIdentifier = props.databaseInstance.instanceIdentifier;
    } else {
      throw new Error('One of `databaseCluster` or `databaseInstance` must be specified');
    }

    this.tempPrefix = props.tempPrefix ?? 'sanitize';
    this.snapshotPrefix = props.snapshotPrefix ?? this.databaseIdentifier;

    this.reencrypt = props.snapshotKey !== undefined;

    this.dbClusterArn = cdk.Stack.of(this).formatArn({
      service: 'rds',
      resource: 'cluster',
      resourceName: this.databaseIdentifier,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.dbInstanceArn = cdk.Stack.of(this).formatArn({
      service: 'rds',
      resource: 'db',
      resourceName: this.databaseIdentifier,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.tempSnapshotArn = cdk.Stack.of(this).formatArn({
      service: 'rds',
      resource: this.isCluster ? 'cluster-snapshot' : 'snapshot',
      resourceName: `${this.tempPrefix}-*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.tempDbClusterArn = cdk.Stack.of(this).formatArn({
      service: 'rds',
      resource: 'cluster',
      resourceName: `${this.tempPrefix}-*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.tempDbInstanceArn = cdk.Stack.of(this).formatArn({
      service: 'rds',
      resource: 'db',
      resourceName: `${this.tempPrefix}-*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    this.targetSnapshotArn = cdk.Stack.of(this).formatArn({
      service: 'rds',
      resource: this.isCluster ? 'cluster-snapshot' : 'snapshot',
      resourceName: `${this.snapshotPrefix}-*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });

    this.generalTags = [
      {
        Key: 'RDS-sanitized-snapshots',
        Value: this.databaseIdentifier,
      },
    ];
    this.finalSnapshotTags = this.generalTags.concat([{
      Key: 'Final',
      Value: 'true',
    }]);

    const parametersState = this.dbParametersTask(props.databaseKey);
    const errorCatcher = new stepfunctions.Parallel(this, 'Error Catcher', { resultPath: stepfunctions.JsonPath.DISCARD });

    let c: stepfunctions.IChainable;
    let s: stepfunctions.INextable;
    s = c = this.createSnapshot('Create Temporary Snapshot', '$.databaseIdentifier', '$.tempSnapshotId', this.generalTags);
    s = s.next(this.waitForOperation('Wait for Snapshot', 'snapshot', '$.databaseIdentifier', '$.tempSnapshotId'));
    if (props.snapshotKey) {
      s = s.next(this.reencryptSnapshot(props.snapshotKey));
      s = s.next(this.waitForOperation('Wait for Re-encrypt', 'snapshot', '$.databaseIdentifier', '$.tempEncSnapshotId'));
      s = s.next(this.createTemporaryDatabase('$.tempEncSnapshotId'));
    } else {
      s = s.next(this.createTemporaryDatabase('$.tempSnapshotId'));
    }
    s = s.next(this.waitForOperation('Wait for Temporary Database', this.isCluster ? 'cluster' : 'instance', '$.tempDbId'));
    s = s.next(this.setPassword());
    s = s.next(this.waitForOperation('Wait for Temporary Password', this.isCluster ? 'cluster' : 'instance', '$.tempDbId'));
    if (this.isCluster) {
      s = s.next(this.createTemporaryDatabaseInstance());
      s = s.next(this.waitForOperation('Wait for Temporary Instance', 'instance', '$.tempDbInstanceId'));
      s = s.next(this.getTempDbClusterEndpoint());
    } else {
      s = s.next(this.getTempDbEndpoint());
    }
    s = s.next(this.sanitize());
    s = s.next(this.finalSnapshot());
    s = s.next(this.waitForOperation('Wait for Final Snapshot', 'snapshot', '$.tempDbId', '$.targetSnapshotId'));

    if (props.snapshotHistoryLimit) {
      s.next(this.deleteOldSnapshots(props.snapshotHistoryLimit));
    }

    errorCatcher.branch(c);

    const cleanupTasks = this.cleanup();
    this.snapshotter = new stepfunctions.StateMachine(this, 'Director', {
      definition: parametersState.next(errorCatcher.addCatch(cleanupTasks, { resultPath: stepfunctions.JsonPath.DISCARD })).next(cleanupTasks),
    });

    // needed for creating a snapshot with tags
    this.snapshotter.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rds:AddTagsToResource'],
      resources: [this.tempSnapshotArn, this.targetSnapshotArn, this.tempDbClusterArn],
    }));

    // key permissions
    if (props.snapshotKey) {
      props.snapshotKey.grant(this.snapshotter, 'kms:CreateGrant', 'kms:DescribeKey');
    }
    if (props.databaseKey) {
      props.databaseKey.grant(this.snapshotter, 'kms:CreateGrant', 'kms:DescribeKey');
    }

    // allow fargate to access RDS
    this.securityGroup.connections.allowFrom(this.securityGroup.connections, ec2.Port.allTcp());

    // schedule
    if (props.schedule) {
      new events.Rule(this, 'Schedule', {
        description: `Sanitized snapshot of RDS ${this.databaseIdentifier}`,
        schedule: props.schedule,
        targets: [
          new events_targets.SfnStateMachine(this.snapshotter),
        ],
      });
    }
  }

  private dbParametersTask(databaseKey?: kms.IKey) {
    const parametersFn = new ParametersFunction(this, 'parameters', { logRetention: logs.RetentionDays.ONE_MONTH });
    const parametersState = new stepfunctions_tasks.LambdaInvoke(this, 'Get Parameters', {
      lambdaFunction: parametersFn,
      payload: stepfunctions.TaskInput.fromObject({
        executionId: stepfunctions.JsonPath.stringAt('$$.Execution.Id'),
        isCluster: this.isCluster,
        databaseIdentifier: this.databaseIdentifier,
        databaseKey: databaseKey?.keyArn || '',
        snapshotPrefix: this.snapshotPrefix,
        tempPrefix: this.tempPrefix,
      }),
      payloadResponseOnly: true,
    });
    if (this.isCluster) {
      parametersFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['rds:DescribeDBClusters'],
        resources: [this.dbClusterArn],
      }));
      parametersFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['rds:DescribeDBInstances'],
        resources: ['*'], // TODO can we do better without knowing the cluster instance name ahead of time?
      }));
    } else {
      parametersFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['rds:DescribeDBInstances'],
        resources: [this.dbInstanceArn],
      }));
    }
    return parametersState;
  }

  private createSnapshot(id: string, databaseId: string, snapshotId: string, tags: { Key: string; Value: string }[]) {
    return new stepfunctions_tasks.CallAwsService(this, id, {
      service: 'rds',
      action: this.isCluster ? 'createDBClusterSnapshot' : 'createDBSnapshot',
      parameters: {
        DbClusterIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt(databaseId) : undefined,
        DbClusterSnapshotIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt(snapshotId) : undefined,
        DbInstanceIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt(databaseId),
        DbSnapshotIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt(snapshotId),
        Tags: tags,
      },
      iamResources: ['*'],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });
  }

  private waitForOperation(id: string, resourceType: 'snapshot' | 'cluster' | 'instance', databaseIdentifier: string, snapshotId?: string) {
    this.waitFn = this.waitFn ?? new WaitFunction(this, 'wait', {
      logRetention: logs.RetentionDays.ONE_MONTH,
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['rds:DescribeDBClusters', 'rds:DescribeDBClusterSnapshots', 'rds:DescribeDBSnapshots', 'rds:DescribeDBInstances'],
          resources: [this.dbClusterArn, this.dbInstanceArn, this.tempDbClusterArn,
            this.tempSnapshotArn, this.targetSnapshotArn, this.tempDbInstanceArn],
        }),
      ],
    });

    let payload = {
      resourceType,
      databaseIdentifier: stepfunctions.JsonPath.stringAt(databaseIdentifier),
      snapshotIdentifier: undefined as String | undefined,
      isCluster: this.isCluster,
    };
    if (snapshotId) {
      payload.snapshotIdentifier = stepfunctions.JsonPath.stringAt(snapshotId);
    }

    return new stepfunctions_tasks.LambdaInvoke(this, id, {
      lambdaFunction: this.waitFn,
      payloadResponseOnly: true,
      payload: stepfunctions.TaskInput.fromObject(payload),
      resultPath: stepfunctions.JsonPath.DISCARD,
    }).addRetry({
      errors: ['NotReady'],
      interval: cdk.Duration.minutes(1),
      maxAttempts: 300,
      backoffRate: 1,
    });
  }

  private reencryptSnapshot(key: kms.IKey) {
    return new stepfunctions_tasks.CallAwsService(this, 'Re-encrypt Snapshot', {
      service: 'rds',
      action: this.isCluster ? 'copyDBClusterSnapshot' : 'copyDBSnapshot',
      parameters: {
        SourceDBClusterSnapshotIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt('$.tempSnapshotId') : undefined,
        TargetDBClusterSnapshotIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt('$.tempEncSnapshotId') : undefined,
        SourceDBSnapshotIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt('$.tempSnapshotId'),
        TargetDBSnapshotIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt('$.tempEncSnapshotId'),
        KmsKeyId: key.keyId,
        CopyTags: false,
        Tags: this.generalTags,
      },
      iamResources: [this.tempSnapshotArn],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });
  }

  private createTemporaryDatabase(snapshotIdentifier: string) {
    return new stepfunctions_tasks.CallAwsService(this, 'Create Temporary Database', {
      service: 'rds',
      action: this.isCluster ? 'restoreDBClusterFromSnapshot' : 'restoreDBInstanceFromDBSnapshot',
      parameters: {
        DbClusterIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt('$.tempDbId') : undefined,
        DbInstanceIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt('$.tempDbId'),
        Engine: stepfunctions.JsonPath.stringAt('$.engine'),
        SnapshotIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt(snapshotIdentifier) : undefined,
        DbSnapshotIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt(snapshotIdentifier),
        PubliclyAccessible: false,
        VpcSecurityGroupIds: [this.securityGroup.securityGroupId],
        DbSubnetGroupName: this.subnetGroup.subnetGroupName,
        Tags: this.generalTags,
      },
      iamResources: [
        this.tempDbClusterArn,
        this.tempDbInstanceArn,
        this.tempSnapshotArn,
        cdk.Stack.of(this).formatArn({
          service: 'rds',
          resource: 'subgrp',
          resourceName: this.subnetGroup.subnetGroupName,
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });
  }

  private setPassword() {
    return new stepfunctions_tasks.CallAwsService(this, 'Set Temporary Password', {
      service: 'rds',
      action: this.isCluster ? 'modifyDBCluster' : 'modifyDBInstance',
      parameters: {
        DbClusterIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt('$.tempDbId') : undefined,
        DbInstanceIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt('$.tempDbId'),
        MasterUserPassword: stepfunctions.JsonPath.stringAt('$.tempDb.password'),
        ApplyImmediately: true,
        BackupRetentionPeriod: this.isCluster ? undefined : 0,
      },
      iamResources: [this.isCluster ? this.tempDbClusterArn : this.tempDbInstanceArn],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });
  }

  private createTemporaryDatabaseInstance() {
    return new stepfunctions_tasks.CallAwsService(this, 'Create Temporary Instance', {
      service: 'rds',
      action: 'createDBInstance',
      parameters: {
        DbClusterIdentifier: stepfunctions.JsonPath.stringAt('$.tempDbId'),
        DbInstanceIdentifier: stepfunctions.JsonPath.stringAt('$.tempDbInstanceId'),
        DbInstanceClass: stepfunctions.JsonPath.stringAt('$.tempDbInstanceClass'),
        Engine: stepfunctions.JsonPath.stringAt('$.engine'),
      },
      iamResources: [this.tempDbClusterArn, this.tempDbInstanceArn],
      resultPath: stepfunctions.JsonPath.DISCARD,
    });
  }

  private getTempDbClusterEndpoint() {
    return new stepfunctions_tasks.CallAwsService(this, 'Get Temporary Cluster Endpoint', {
      service: 'rds',
      action: 'describeDBClusters',
      parameters: {
        DbClusterIdentifier: stepfunctions.JsonPath.stringAt('$.tempDbId'),
      },
      iamResources: [this.tempDbClusterArn],
      resultSelector: {
        endpoint: stepfunctions.JsonPath.stringAt('$.DbClusters[0].Endpoint'),
      },
      resultPath: stepfunctions.JsonPath.stringAt('$.tempDb.host'),
    });
  }

  private getTempDbEndpoint() {
    return new stepfunctions_tasks.CallAwsService(this, 'Get Temporary Endpoint', {
      service: 'rds',
      action: 'describeDBInstances',
      parameters: {
        DbInstanceIdentifier: stepfunctions.JsonPath.stringAt('$.tempDbId'),
      },
      iamResources: [this.tempDbInstanceArn],
      resultSelector: {
        endpoint: stepfunctions.JsonPath.stringAt('$.DbInstances[0].Endpoint.Address'),
      },
      resultPath: stepfunctions.JsonPath.stringAt('$.tempDb.host'),
    });
  }

  private sanitize(): stepfunctions.IChainable {
    const logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const mysqlTask = new ecs.FargateTaskDefinition(this, 'MySQL Task', {
      volumes: [{ name: 'config', host: {} }],
    });
    const mysqlConfigContainer = mysqlTask.addContainer('config', {
      image: ecs.AssetImage.fromRegistry('public.ecr.aws/docker/library/bash:4-alpine3.15'),
      command: ['bash', '-c', 'echo "[client]\nuser=$MYSQL_USER\nhost=$MYSQL_HOST\nport=$MYSQL_PORT\npassword=$MYSQL_PASSWORD" > ~/.my.cnf && chmod 700 ~/.my.cnf'],
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'mysql-config',
      }),
      essential: false,
    });
    mysqlConfigContainer.addMountPoints({ sourceVolume: 'config', containerPath: '/root', readOnly: false });
    const mysqlContainer = mysqlTask.addContainer('mysql', {
      image: ecs.AssetImage.fromRegistry('public.ecr.aws/lts/mysql:latest'),
      command: ['mysql', '-e', this.sqlScript],
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'mysql-sanitize',
      }),
    });
    mysqlContainer.addMountPoints({ sourceVolume: 'config', containerPath: '/root', readOnly: true });
    mysqlContainer.addContainerDependencies({ container: mysqlConfigContainer, condition: ecs.ContainerDependencyCondition.SUCCESS });

    const postgresTask = new ecs.FargateTaskDefinition(this, 'PostreSQL Task');
    const postgresContainer = postgresTask.addContainer('postgres', {
      image: ecs.AssetImage.fromRegistry('public.ecr.aws/lts/postgres:latest'),
      command: ['psql', '-c', this.sqlScript],
      logging: ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'psql-sanitize',
      }),
    });

    const choice = new stepfunctions.Choice(this, 'Sanitize')
      .when(
        stepfunctions.Condition.stringEquals('$.dockerImage', 'mysql'),
        new stepfunctions_tasks.EcsRunTask(this, 'Sanitize MySQL', {
          integrationPattern: stepfunctions.IntegrationPattern.RUN_JOB, // sync
          launchTarget: new stepfunctions_tasks.EcsFargateLaunchTarget(),
          cluster: this.fargateCluster,
          subnets: this.subnets,
          securityGroups: [this.securityGroup],
          taskDefinition: mysqlTask,
          containerOverrides: [
            {
              containerDefinition: mysqlConfigContainer,
              environment: [
                {
                  name: 'MYSQL_HOST',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.host.endpoint'),
                },
                {
                  name: 'MYSQL_PORT',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.port'),
                },
                {
                  name: 'MYSQL_USER',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.user'),
                },
                {
                  name: 'MYSQL_PASSWORD',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.password'),
                },
              ],
            },
          ],
          resultPath: stepfunctions.JsonPath.DISCARD,
        }),
      )
      .when(
        stepfunctions.Condition.stringEquals('$.dockerImage', 'postgres'),
        new stepfunctions_tasks.EcsRunTask(this, 'Sanitize Postgres', {
          integrationPattern: stepfunctions.IntegrationPattern.RUN_JOB, // sync
          launchTarget: new stepfunctions_tasks.EcsFargateLaunchTarget(),
          cluster: this.fargateCluster,
          subnets: this.subnets,
          securityGroups: [this.securityGroup],
          taskDefinition: postgresTask,
          containerOverrides: [
            {
              containerDefinition: postgresContainer,
              environment: [
                {
                  name: 'PGHOST',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.host.endpoint'),
                },
                {
                  name: 'PGPORT',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.port'),
                },
                {
                  name: 'PGUSER',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.user'),
                },
                {
                  name: 'PGPASSWORD',
                  value: stepfunctions.JsonPath.stringAt('$.tempDb.password'),
                },
                {
                  name: 'PGCONNECT_TIMEOUT',
                  value: '30',
                },
              ],
            },
          ],
          resultPath: stepfunctions.JsonPath.DISCARD,
        }),
      );

    return choice.afterwards();
  }

  private finalSnapshot() {
    return this.createSnapshot('Create Final Snapshot', '$.tempDbId', '$.targetSnapshotId', this.finalSnapshotTags);
  }

  // private waitForSnapshotSfn(id: string, snapshotId: string) {
  //   const describeSnapshot = new stepfunctions_tasks.CallAwsService(this, id, {
  //     service: 'rds',
  //     action: 'describeDBClusterSnapshots',
  //     parameters: {
  //       DbClusterIdentifier: stepfunctions.JsonPath.stringAt('$.databaseIdentifier'),
  //       DbClusterSnapshotIdentifier: stepfunctions.JsonPath.stringAt(snapshotId),
  //     },
  //     iamResources: [this.dbArn, this.tempSnapshotArn, this.targetSnapshotArn],
  //     resultPath: '$.results.waitSnapshot',
  //   });
  //
  //   return describeSnapshot.next(
  //     new stepfunctions.Choice(this, `${id} (check)`)
  //       .when(stepfunctions.Condition.or(
  //         stepfunctions.Condition.stringMatches('$.results.waitSnapshot', '*stop*'),
  //         stepfunctions.Condition.stringMatches('$.results.waitSnapshot', '*delet*'), // both delete and deleting
  //         stepfunctions.Condition.stringMatches('$.results.waitSnapshot', '*fail*'),
  //         stepfunctions.Condition.stringMatches('$.results.waitSnapshot', '*incompatible*'),
  //         stepfunctions.Condition.stringMatches('$.results.waitSnapshot', '*inaccessible*'),
  //         stepfunctions.Condition.stringMatches('$.results.waitSnapshot', '*error*'),
  //       ), new stepfunctions.Fail(this, `${id} (bad status)`))
  //       .when(
  //         stepfunctions.Condition.stringEquals('$.results.waitSnapshot', 'available'),
  //         new stepfunctions.Succeed(this, `${id} (done)`),
  //       )
  //       .otherwise(describeSnapshot),
  //   );
  // }

  private deleteOldSnapshots(historyLimit: number) {
    const deleteOldFn = new DeleteOldFunction(this, 'delete-old', {
      logRetention: logs.RetentionDays.ONE_MONTH,
      timeout: cdk.Duration.minutes(5),
    });
    deleteOldFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['tag:GetResources'],
      resources: ['*'],
    }));
    deleteOldFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rds:DeleteDBClusterSnapshot', 'rds:DeleteDBSnapshot'],
      resources: [this.targetSnapshotArn],
    }));
    return new stepfunctions_tasks.LambdaInvoke(this, 'Delete Old Snapshots', {
      lambdaFunction: deleteOldFn,
      payload: stepfunctions.TaskInput.fromObject({
        tags: this.finalSnapshotTags,
        historyLimit: historyLimit,
        resourceType: 'rds:cluster-snapshot',
      }),
      payloadResponseOnly: true,
      resultPath: stepfunctions.JsonPath.DISCARD,
    });
  }

  private cleanup() {
    // We retry everything because when any branch fails, all other branches are cancelled.
    // Retrying gives other branches an opportunity to start and hopefully at least run.
    const p = new stepfunctions.Parallel(this, 'Cleanup', { resultPath: stepfunctions.JsonPath.DISCARD });
    p.branch(
      new stepfunctions_tasks.CallAwsService(this, 'Temporary Snapshot', {
        service: 'rds',
        action: this.isCluster ? 'deleteDBClusterSnapshot' : 'deleteDBSnapshot',
        parameters: {
          DbClusterSnapshotIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt('$.tempSnapshotId') : undefined,
          DbSnapshotIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt('$.tempSnapshotId'),
        },
        iamResources: [this.tempSnapshotArn],
        resultPath: stepfunctions.JsonPath.DISCARD,
      }).addRetry({ maxAttempts: 5, interval: cdk.Duration.seconds(10) }),
    );
    if (this.reencrypt) {
      p.branch(
        new stepfunctions_tasks.CallAwsService(this, 'Re-encrypted Snapshot', {
          service: 'rds',
          action: this.isCluster ? 'deleteDBClusterSnapshot' : 'deleteDBSnapshot',
          parameters: {
            DbClusterSnapshotIdentifier: this.isCluster ? stepfunctions.JsonPath.stringAt('$.tempEncSnapshotId') : undefined,
            DbSnapshotIdentifier: this.isCluster ? undefined : stepfunctions.JsonPath.stringAt('$.tempEncSnapshotId'),
          },
          iamResources: [this.tempSnapshotArn],
          resultPath: stepfunctions.JsonPath.DISCARD,
        }).addRetry({ maxAttempts: 5, interval: cdk.Duration.seconds(10) }),
      );
    }
    p.branch(
      new stepfunctions_tasks.CallAwsService(this, 'Temporary Database Instance', {
        service: 'rds',
        action: 'deleteDBInstance',
        parameters: {
          DbInstanceIdentifier: stepfunctions.JsonPath.stringAt(this.isCluster ? '$.tempDbInstanceId' : '$.tempDbId'),
          SkipFinalSnapshot: true,
        },
        iamResources: [this.tempDbInstanceArn],
        resultPath: stepfunctions.JsonPath.DISCARD,
      }).addRetry({
        maxAttempts: 5,
        interval: cdk.Duration.seconds(10),
      }),
    );
    if (this.isCluster) {
      p.branch(
        new stepfunctions_tasks.CallAwsService(this, 'Temporary Database', {
          service: 'rds',
          action: 'deleteDBCluster',
          parameters: {
            DbClusterIdentifier: stepfunctions.JsonPath.stringAt('$.tempDbId'),
            SkipFinalSnapshot: true,
          },
          iamResources: [this.tempDbClusterArn],
          resultPath: stepfunctions.JsonPath.DISCARD,
        }).addRetry({
          maxAttempts: 5,
          interval: cdk.Duration.seconds(10),
        }),
      );
    }
    return p;
  }
}