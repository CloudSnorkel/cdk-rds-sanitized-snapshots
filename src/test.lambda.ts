/* eslint-disable import/no-extraneous-dependencies */
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient();

interface Input {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId: string;
  ResourceProperties: {
    StepFunctionArn: string;
  };
}

interface Result {
  PhysicalResourceId: string;
}

exports.handler = async function (input: Input): Promise<Result> {
  if (input.RequestType == 'Create' || input.RequestType == 'Update') {
    const exec = await sfn.send(new StartExecutionCommand({ stateMachineArn: input.ResourceProperties.StepFunctionArn }));
    return { PhysicalResourceId: exec.executionArn! };
  }

  return { PhysicalResourceId: input.PhysicalResourceId };
};
