/* eslint-disable import/no-extraneous-dependencies */
import * as AWS from 'aws-sdk';

const sfn = new AWS.StepFunctions();

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
    const exec = await sfn.startExecution({ stateMachineArn: input.ResourceProperties.StepFunctionArn }).promise();
    return { PhysicalResourceId: exec.executionArn };
  }

  return { PhysicalResourceId: input.PhysicalResourceId };
};