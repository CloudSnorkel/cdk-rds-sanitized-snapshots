/* eslint-disable import/no-extraneous-dependencies */
import * as crypto from 'crypto';
import * as AWS from 'aws-sdk';

const rds = new AWS.RDS();

interface Input {
  executionId: string;
  databaseIdentifier: string;
  databaseKey: string;
  snapshotPrefix: string;
  tempPrefix: string;
}

interface Parameters {
  databaseIdentifier: string;
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
    database: string;
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

exports.handler = async function (input: Input): Promise<Parameters> {
  const origDb = await rds.describeDBClusters({ DBClusterIdentifier: input.databaseIdentifier }).promise();
  if (!origDb.DBClusters || origDb.DBClusters.length != 1) {
    throw new Error(`Unable to find ${input.databaseIdentifier}`);
  }

  const cluster = origDb.DBClusters[0];
  if (!cluster.Endpoint || !cluster.Port || !cluster.MasterUsername || !cluster.DBClusterMembers) {
    throw new Error(`Database missing some required parameters: ${JSON.stringify(cluster)}`);
  }

  if (input.databaseKey && input.databaseKey !== '') {
    if (input.databaseKey !== cluster.KmsKeyId) {
      throw new Error(`Database key (${cluster.KmsKeyId}) doesn't match databaseKey parameter (${input.databaseKey})`);
    }
  }

  const origInstances = await rds.describeDBInstances({ DBInstanceIdentifier: cluster.DBClusterMembers[0].DBInstanceIdentifier }).promise();
  if (!origInstances.DBInstances || origInstances.DBInstances.length < 1) {
    throw new Error(`Unable to find instances for ${input.databaseIdentifier}`);
  }

  const instance = origInstances.DBInstances[0];
  if (!instance.DBInstanceClass) {
    throw new Error(`Database instance missing class: ${JSON.stringify(instance)}`);
  }

  const timestamp = new Date();
  const snapshotSuffix = `-${timestamp.getUTCFullYear()}${timestamp.getUTCMonth().toString().padStart(2, '0')}${timestamp.getUTCDay().toString().padStart(2, '0')}${timestamp.getUTCHours().toString().padStart(2, '0')}${timestamp.getUTCMinutes().toString().padStart(2, '0')}`;
  const targetSnapshotId = `${input.snapshotPrefix}${snapshotSuffix}`;

  const tempSuffix = crypto.randomBytes(8).toString('hex');

  const result = {
    databaseIdentifier: input.databaseIdentifier,
    engine: cluster.Engine || 'unknown',
    tempSnapshotId: `${input.tempPrefix}-${tempSuffix}`,
    tempEncSnapshotId: `${input.tempPrefix}-enc-${tempSuffix}`,
    tempDbId: `${input.tempPrefix}-${tempSuffix}`,
    tempDbInstanceId: `${input.tempPrefix}-inst-${tempSuffix}`,
    tempDbInstanceClass: instance.DBInstanceClass,
    targetSnapshotId,
    dockerImage: getDockerImage(cluster.Engine ?? ''),
    tempDb: {
      host: {
        endpoint: 'NOT KNOWN YET',
      },
      port: cluster.Port.toString(),
      user: cluster.MasterUsername,
      password: crypto.randomBytes(16).toString('hex'),
      database: cluster.DatabaseName ?? cluster.MasterUsername,
    },
  };

  confirmLength('tempSnapshotId', result.tempSnapshotId);
  confirmLength('tempEncSnapshotId', result.tempEncSnapshotId);
  confirmLength('tempDbId', result.tempDbId);
  confirmLength('tempDbInstanceId', result.tempDbInstanceId);
  confirmLength('targetSnapshotId', result.targetSnapshotId);

  return result;
};