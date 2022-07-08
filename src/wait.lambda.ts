/* eslint-disable import/no-extraneous-dependencies */
import * as AWS from 'aws-sdk';

const rds = new AWS.RDS();

interface Input {
  resourceType: 'snapshot' | 'cluster' | 'instance';
  databaseIdentifier: string;
  snapshotIdentifier?: string;
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

exports.handler = async function (event: Input) {
  console.log(event);

  if (event.resourceType == 'snapshot' && event.snapshotIdentifier) {
    // wait for snapshot
    const snapshots = await rds.describeDBClusterSnapshots({
      DBClusterIdentifier: event.databaseIdentifier,
      DBClusterSnapshotIdentifier: event.snapshotIdentifier,
    }).promise();

    console.log(snapshots);

    if (!snapshots.DBClusterSnapshots || snapshots.DBClusterSnapshots.length != 1) {
      throw new Error(`Unable to find snapshot ${event.snapshotIdentifier} of ${event.databaseIdentifier}`);
    }

    const status = snapshots.DBClusterSnapshots[0].Status ?? '';
    if (status == 'available') {
      return;
    }

    checkStatus(status, event.snapshotIdentifier);
  } else if (event.resourceType == 'cluster') {
    // wait for db
    const dbs = await rds.describeDBClusters({
      DBClusterIdentifier: event.databaseIdentifier,
    }).promise();

    console.log(dbs);

    if (!dbs.DBClusters || dbs.DBClusters.length != 1) {
      throw new Error(`Unable to find db clsuter ${event.databaseIdentifier}`);
    }

    const status = dbs.DBClusters[0].Status ?? '';
    if (status == 'available' && empty(dbs.DBClusters[0].PendingModifiedValues)) {
      return;
    }

    checkStatus(status, event.databaseIdentifier);
  } else if (event.resourceType == 'instance') {
    // wait for db
    const instances = await rds.describeDBInstances({
      DBInstanceIdentifier: event.databaseIdentifier,
    }).promise();

    console.log(instances);

    if (!instances.DBInstances || instances.DBInstances.length != 1) {
      throw new Error(`Unable to find db instance ${event.databaseIdentifier}`);
    }

    const status = instances.DBInstances[0].DBInstanceStatus ?? '';
    if (status == 'available' && empty(instances.DBInstances[0].PendingModifiedValues)) {
      return;
    }

    checkStatus(status, event.databaseIdentifier);
  } else {
    throw new Error('Bad parameters');
  }
};