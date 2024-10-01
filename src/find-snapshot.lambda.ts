/* eslint-disable import/no-extraneous-dependencies */
import { DescribeDBClusterSnapshotsCommand, DescribeDBSnapshotsCommand, DescribeDBSnapshotsCommandOutput, RDSClient } from '@aws-sdk/client-rds';

const rds = new RDSClient();

interface Input {
  databaseIdentifier: string;
  isCluster: boolean;
}

exports.handler = async function (input: Input) {
  let marker: string | undefined = undefined;
  let lastSnapshotId = '';
  let lastSnapshotTime = 0;

  do {
    if (!input.isCluster) {
      const snapshots: DescribeDBSnapshotsCommandOutput = await rds.send(new DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: input.databaseIdentifier,
        Marker: marker,
      }));
      for (const snapshot of snapshots.DBSnapshots ?? []) {
        if (snapshot.DBSnapshotIdentifier && snapshot.SnapshotCreateTime && snapshot.SnapshotCreateTime.getTime() > lastSnapshotTime) {
          lastSnapshotTime = snapshot.SnapshotCreateTime.getTime();
          lastSnapshotId = snapshot.DBSnapshotIdentifier;
        }
      }
      marker = snapshots.Marker;
    } else {
      const snapshots = await rds.send(new DescribeDBClusterSnapshotsCommand({
        DBClusterIdentifier: input.databaseIdentifier,
        Marker: marker,
      }));
      for (const snapshot of snapshots.DBClusterSnapshots ?? []) {
        if (snapshot.DBClusterSnapshotIdentifier && snapshot.SnapshotCreateTime && snapshot.SnapshotCreateTime.getTime() > lastSnapshotTime) {
          lastSnapshotTime = snapshot.SnapshotCreateTime.getTime();
          lastSnapshotId = snapshot.DBClusterSnapshotIdentifier;
        }
      }
      marker = snapshots.Marker;
    }
  } while (marker);

  if (lastSnapshotId === '') {
    throw new Error('No snapshots found');
  }

  return {
    id: lastSnapshotId,
  };
};
