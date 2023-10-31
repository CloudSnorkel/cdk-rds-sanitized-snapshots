/* eslint-disable import/no-extraneous-dependencies */
import {
  DescribeDBClustersCommand,
  DescribeDBClusterSnapshotsCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  RDSClient,
} from '@aws-sdk/client-rds';

const rds = new RDSClient();

interface Input {
  resourceType: 'snapshot' | 'cluster' | 'instance';
  databaseIdentifier: string;
  snapshotIdentifier?: string;
  isCluster: boolean;
}

class NotReady extends Error {
  constructor() {
    super('Not ready');
    this.name = 'NotReady';
  }
}

function checkStatus(status: string, source: string) {
  for (const badStatus of ['stop', 'delet', 'fail', 'incompatible', 'inaccessible', 'error']) {
    if (status.indexOf(badStatus) >= 0) {
      throw new Error(`Invalid status ${status} for ${source}`);
    }
  }

  throw new NotReady();
}

function empty(obj: any) {
  return obj === undefined || obj === null || Object.keys(obj).length == 0;
}

exports.handler = async function (input: Input) {
  console.log(input);

  if (input.resourceType == 'snapshot' && input.snapshotIdentifier) {
    // wait for snapshot
    let status: string;
    if (input.isCluster) {
      // wait for cluster snapshot
      const snapshots = await rds.send(new DescribeDBClusterSnapshotsCommand({
        DBClusterIdentifier: input.databaseIdentifier,
        DBClusterSnapshotIdentifier: input.snapshotIdentifier,
      }));

      console.log(snapshots);

      if (!snapshots.DBClusterSnapshots || snapshots.DBClusterSnapshots.length != 1) {
        throw new Error(`Unable to find snapshot ${input.snapshotIdentifier} of ${input.databaseIdentifier}`);
      }

      status = snapshots.DBClusterSnapshots[0].Status ?? '';
    } else {
      // wait for instance snapshot
      const snapshots = await rds.send(new DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: input.databaseIdentifier,
        DBSnapshotIdentifier: input.snapshotIdentifier,
      }));

      console.log(snapshots);

      if (!snapshots.DBSnapshots || snapshots.DBSnapshots.length != 1) {
        throw new Error(`Unable to find snapshot ${input.snapshotIdentifier} of ${input.databaseIdentifier}`);
      }

      status = snapshots.DBSnapshots[0].Status ?? '';
    }

    if (status == 'available') {
      return;
    }

    checkStatus(status, input.snapshotIdentifier);
  } else if (input.resourceType == 'cluster') {
    // wait for db
    const dbs = await rds.send(new DescribeDBClustersCommand({
      DBClusterIdentifier: input.databaseIdentifier,
    }));

    console.log(dbs);

    if (!dbs.DBClusters || dbs.DBClusters.length != 1) {
      throw new Error(`Unable to find db clsuter ${input.databaseIdentifier}`);
    }

    const status = dbs.DBClusters[0].Status ?? '';
    if (status == 'available' && empty(dbs.DBClusters[0].PendingModifiedValues)) {
      return;
    }

    checkStatus(status, input.databaseIdentifier);
  } else if (input.resourceType == 'instance') {
    // wait for db
    const instances = await rds.send(new DescribeDBInstancesCommand({
      DBInstanceIdentifier: input.databaseIdentifier,
    }));

    console.log(instances);

    if (!instances.DBInstances || instances.DBInstances.length != 1) {
      throw new Error(`Unable to find db instance ${input.databaseIdentifier}`);
    }

    const status = instances.DBInstances[0].DBInstanceStatus ?? '';
    if (status == 'available' && empty(instances.DBInstances[0].PendingModifiedValues)) {
      return;
    }

    checkStatus(status, input.databaseIdentifier);
  } else {
    throw new Error('Bad parameters');
  }
};