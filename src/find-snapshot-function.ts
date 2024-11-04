// ~~ Generated by projen. To modify, edit .projenrc.js and run "npx projen".
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Props for FindSnapshotFunction
 */
export interface FindSnapshotFunctionProps extends lambda.FunctionOptions {
}

/**
 * An AWS Lambda function which executes src/find-snapshot.
 */
export class FindSnapshotFunction extends lambda.Function {
  constructor(scope: Construct, id: string, props?: FindSnapshotFunctionProps) {
    super(scope, id, {
      description: 'src/find-snapshot.lambda.ts',
      ...props,
      runtime: new lambda.Runtime('nodejs18.x', lambda.RuntimeFamily.NODEJS),
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets/find-snapshot.lambda')),
    });
    this.addEnvironment('AWS_NODEJS_CONNECTION_REUSE_ENABLED', '1', { removeInEdge: true });
  }
}