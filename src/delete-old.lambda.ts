/* eslint-disable import/no-extraneous-dependencies */
import * as AWS from 'aws-sdk';

const tagging = new AWS.ResourceGroupsTaggingAPI();
const rds = new AWS.RDS();

interface Input {
  tags: { Key: string; Value: string }[];
  historyLimit: number;
  resourceType: string;
}

exports.handler = async function (input: Input) {
  const snapshotsResponse = await tagging.getResources({
    TagFilters: input.tags.map(f => {
      return { Key: f.Key, Values: [f.Value] };
    }),
    ResourceTypeFilters: [input.resourceType],
  }).promise();
  if (!snapshotsResponse.ResourceTagMappingList) {
    console.error('No snapshots found');
  }

  const snapshots: string[] = [];

  snapshotsResponse.ResourceTagMappingList!.forEach(r => {
    const id = r.ResourceARN?.split(':').pop();
    if (id) {
      snapshots.push(id);
    } else {
      console.error(`Bad response from tagging API: ${r}`);
    }
  });

  snapshots.sort();
  const toDelete = snapshots.slice(0, -1 * input.historyLimit);

  for (const snapshot of toDelete) {
    console.log(`Deleting old snapshot: ${snapshot}`);
    await rds.deleteDBClusterSnapshot({
      DBClusterSnapshotIdentifier: snapshot,
    }).promise();
  }
};