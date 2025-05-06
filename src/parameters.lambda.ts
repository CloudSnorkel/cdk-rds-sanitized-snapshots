/* eslint-disable import/no-extraneous-dependencies */
import * as crypto from 'crypto';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';

const rds = new RDSClient();

export interface ParametersInput {
  executionId: string;
  isCluster: boolean;
  databaseIdentifier: string;
  databaseKey: string;
  snapshotPrefix: string;
  tempPrefix: string;
}

interface ParametersOutput {
  databaseIdentifier: string;
  isCluster: boolean;
  engine: string;
  tempSnapshotId: string;
  tempEncSnapshotId: string;
  tempDbId: string;
  tempDbInstanceId: string;
  tempDbInstanceClass: string;
  targetSnapshotId: string;
  dockerImage: string;
  tempDb: {
    host: {
      endpoint: string;
    };
    port: string;
    user: string;
    password: string;
  };
}

function getDockerImage(engine: string): string {
  if (engine.match(/(^aurora$|mysql|mariadb)/)) {
    return 'mysql';
  } else if (engine.match(/postgres/)) {
    return 'postgres';
    // } else if (engine.match(/oracle/)) {
    // } else if (engine.match(/sqlserver/)) {
  } else {
    throw new Error(`"${engine}" is not a supported database engine`);
  }
}

function confirmLength(name: string, value: string) {
  let error: string | undefined;
  if (value.length > 63) {
    error = 'is too long';
  }
  if (!value.charAt(0).match(/[a-z]/i)) {
    error = 'does not start with a letter';
  }
  if (value.indexOf('--') >= 0) {
    error = 'contains two consecutive hyphens';
  }
  if (error) {
    throw new Error(`"${name}" ${error}. Try adjusting 'tempPrefix' and/or 'snapshotPrefix'. Current value: ${value}`);
  }
}

export async function handler(input: ParametersInput): Promise<ParametersOutput> {
  let port: number;
  let user: string;
  let engine: string | undefined;
  let kmsKeyId: string | undefined;
  let instanceClass: string;

  if (input.isCluster) {
    const origDb = await rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: input.databaseIdentifier }));
    if (!origDb.DBClusters || origDb.DBClusters.length != 1) {
      throw new Error(`Unable to find ${input.databaseIdentifier}`);
    }

    const cluster = origDb.DBClusters[0];
    if (!cluster.Port || !cluster.MasterUsername || !cluster.DBClusterMembers) {
      throw new Error(`Database missing some required parameters: ${JSON.stringify(cluster)}`);
    }

    const origInstances = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: cluster.DBClusterMembers[0].DBInstanceIdentifier }));
    if (!origInstances.DBInstances || origInstances.DBInstances.length < 1) {
      throw new Error(`Unable to find instances for ${input.databaseIdentifier}`);
    }

    const instance = origInstances.DBInstances[0];
    if (!instance.DBInstanceClass) {
      throw new Error(`Database instance missing class: ${JSON.stringify(instance)}`);
    }

    port = cluster.Port;
    user = cluster.MasterUsername;
    engine = cluster.Engine;
    kmsKeyId = cluster.KmsKeyId;
    instanceClass = instance.DBInstanceClass;
  } else {
    const origDb = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: input.databaseIdentifier }));
    if (!origDb.DBInstances || origDb.DBInstances.length != 1) {
      throw new Error(`Unable to find ${input.databaseIdentifier}`);
    }

    const instance = origDb.DBInstances[0];
    if (!instance.Endpoint?.Address || !instance.Endpoint?.Port || !instance.MasterUsername) {
      throw new Error(`Database missing some required parameters: ${JSON.stringify(instance)}`);
    }

    port = instance.Endpoint.Port;
    user = instance.MasterUsername;
    engine = instance.Engine;
    kmsKeyId = instance.KmsKeyId;
    instanceClass = instance.DBInstanceClass ?? 'db.m5.large';
  }

  if (input.databaseKey && input.databaseKey !== '') {
    if (input.databaseKey !== kmsKeyId) {
      throw new Error(`Database key (${kmsKeyId}) doesn't match databaseKey parameter (${input.databaseKey})`);
    }
  }

  const timestamp = new Date();
  const snapshotSuffix = `-${timestamp.getUTCFullYear()}${(timestamp.getUTCMonth() + 1).toString().padStart(2, '0')}${timestamp.getUTCDate().toString().padStart(2, '0')}${timestamp.getUTCHours().toString().padStart(2, '0')}${timestamp.getUTCMinutes().toString().padStart(2, '0')}`;
  const targetSnapshotId = `${input.snapshotPrefix}${snapshotSuffix}`;

  const tempSuffix = crypto.randomBytes(8).toString('hex');

  const result: ParametersOutput = {
    databaseIdentifier: input.databaseIdentifier,
    isCluster: input.isCluster,
    engine: engine ?? 'unknown',
    tempSnapshotId: `${input.tempPrefix}-${tempSuffix}`,
    tempEncSnapshotId: `${input.tempPrefix}-enc-${tempSuffix}`,
    tempDbId: `${input.tempPrefix}-${tempSuffix}`,
    tempDbInstanceId: `${input.tempPrefix}-inst-${tempSuffix}`,
    tempDbInstanceClass: instanceClass,
    targetSnapshotId,
    dockerImage: getDockerImage(engine ?? ''),
    tempDb: {
      host: {
        endpoint: 'NOT KNOWN YET', // we want the temp db endpoint here
      },
      port: port.toString(),
      user: user,
      password: crypto.randomBytes(16).toString('hex'),
    },
  };

  confirmLength('tempSnapshotId', result.tempSnapshotId);
  confirmLength('tempEncSnapshotId', result.tempEncSnapshotId);
  confirmLength('tempDbId', result.tempDbId);
  confirmLength('tempDbInstanceId', result.tempDbInstanceId);
  confirmLength('targetSnapshotId', result.targetSnapshotId);

  return result;
}
