/* eslint-disable import/no-extraneous-dependencies */
import { DeleteDBClusterSnapshotCommand, RDSClient } from '@aws-sdk/client-rds';
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';

const tagging = new ResourceGroupsTaggingAPIClient();
const rds = new RDSClient();

interface Input {
  tags: { Key: string; Value: string }[];
  historyLimit: number;
  resourceType: string;
}

exports.handler = async function (input: Input) {
  const snapshotsResponse = await tagging.send(new GetResourcesCommand({
    TagFilters: input.tags.map(f => {
      return { Key: f.Key, Values: [f.Value] };
    }),
    ResourceTypeFilters: [input.resourceType],
  }));
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
    await rds.send(new DeleteDBClusterSnapshotCommand({
      DBClusterSnapshotIdentifier: snapshot,
    }));
  }
};
