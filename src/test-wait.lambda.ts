/* eslint-disable import/no-extraneous-dependencies */
import {
  DeleteDBClusterSnapshotCommand,
  DeleteDBSnapshotCommand,
  DescribeDBClusterSnapshotsCommand,
  DescribeDBSnapshotsCommand,
  RDSClient,
} from '@aws-sdk/client-rds';
import { DescribeExecutionCommand, SFNClient } from '@aws-sdk/client-sfn';

const sfn = new SFNClient();
const rds = new RDSClient();

interface Input {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId: string;
}

interface Result {
  IsComplete: boolean;
}

export async function handler(input: Input): Promise<Result> {
  console.log(input.RequestType, input.PhysicalResourceId);

  if (input.RequestType == 'Create' || input.RequestType == 'Update') {
    const exec = await sfn.send(new DescribeExecutionCommand({ executionArn: input.PhysicalResourceId }));
    if (exec.status == 'ABORTED' || exec.status == 'FAILED' || exec.status == 'TIMED_OUT') {
      throw new Error(`Step function failed with: ${exec.status}`);
    }
    if (exec.status == 'RUNNING') {
      return { IsComplete: false };
    }
    // exec.status == 'SUCCEEDED'
    if (!exec.output) {
      throw new Error('No output?');
    }
    const output = JSON.parse(exec.output);

    if (output.isCluster) {
      const snapshots = await rds.send(new DescribeDBClusterSnapshotsCommand({ DBClusterSnapshotIdentifier: output.targetSnapshotId }));
      if (!snapshots.DBClusterSnapshots || snapshots.DBClusterSnapshots.length != 1) {
        throw new Error(`Target cluster snapshot ${output.targetSnapshotId} does not exist`);
      }
      await rds.send(new DeleteDBClusterSnapshotCommand({ DBClusterSnapshotIdentifier: output.targetSnapshotId }));
    } else {
      const snapshots = await rds.send(new DescribeDBSnapshotsCommand({ DBSnapshotIdentifier: output.targetSnapshotId }));
      if (!snapshots.DBSnapshots || snapshots.DBSnapshots.length != 1) {
        throw new Error(`Target instance snapshot ${output.targetSnapshotId} does not exist`);
      }
      await rds.send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: output.targetSnapshotId }));
    }

    return { IsComplete: true };
  }

  // delete -- we don't actually need to delete anything
  return { IsComplete: true };
}