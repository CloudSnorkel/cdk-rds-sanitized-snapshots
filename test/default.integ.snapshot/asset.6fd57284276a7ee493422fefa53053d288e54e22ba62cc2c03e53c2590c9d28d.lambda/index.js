"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod));

// src/test-wait.lambda.ts
var AWS = __toESM(require("aws-sdk"));
var sfn = new AWS.StepFunctions();
var rds = new AWS.RDS();
exports.handler = async function(input) {
  console.log(input.RequestType, input.PhysicalResourceId);
  if (input.RequestType == "Create" || input.RequestType == "Update") {
    const exec = await sfn.describeExecution({ executionArn: input.PhysicalResourceId }).promise();
    if (exec.status == "ABORTED" || exec.status == "FAILED" || exec.status == "TIMED_OUT") {
      throw new Error(`Step function failed with: ${exec.status}`);
    }
    if (exec.status == "RUNNING") {
      return { IsComplete: false };
    }
    if (!exec.output) {
      throw new Error("No output?");
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
  return { IsComplete: true };
};
