/* eslint-disable import/no-extraneous-dependencies */
import * as AWS from 'aws-sdk';

const sfn = new AWS.StepFunctions();
const rds = new AWS.RDS();

interface Input {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId: string;
}

interface Result {
  IsComplete: boolean;
}

exports.handler = async function (input: Input): Promise<Result> {
  console.log(input.RequestType, input.PhysicalResourceId);

  if (input.RequestType == 'Create' || input.RequestType == 'Update') {
    const exec = await sfn.describeExecution({ executionArn: input.PhysicalResourceId }).promise();
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
      const snapshots = await rds.describeDBClusterSnapshots({ DBClusterSnapshotIdentifier: output.targetSnapshotId }).promise();
      if (!snapshots.DBClusterSnapshots || snapshots.DBClusterSnapshots.length != 1) {
        throw new Error(`Target cluster snapshot ${output.targetSnapshotId} does not exist`);
      }
      await rds.deleteDBClusterSnapshot({ DBClusterSnapshotIdentifier: output.targetSnapshotId }).promise();
    } else {
      const snapshots = await rds.describeDBSnapshots({ DBSnapshotIdentifier: output.targetSnapshotId }).promise();
      if (!snapshots.DBSnapshots || snapshots.DBSnapshots.length != 1) {
        throw new Error(`Target instance snapshot ${output.targetSnapshotId} does not exist`);
      }
      await rds.deleteDBSnapshot({ DBSnapshotIdentifier: output.targetSnapshotId }).promise();
    }

    return { IsComplete: true };
  }

  // delete -- we don't actually need to delete anything
  return { IsComplete: true };
};