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

// src/wait.lambda.ts
var AWS = __toESM(require("aws-sdk"));
var rds = new AWS.RDS();
var NotReady = class extends Error {
  constructor() {
    super("Not ready");
    this.name = "NotReady";
  }
};
function checkStatus(status, source) {
  for (const badStatus of ["stop", "delet", "fail", "incompatible", "inaccessible", "error"]) {
    if (status.indexOf(badStatus) >= 0) {
      throw new Error(`Invalid status ${status} for ${source}`);
    }
  }
  throw new NotReady();
}
function empty(obj) {
  return obj === void 0 || obj === null || Object.keys(obj).length == 0;
}
exports.handler = async function(input) {
  console.log(input);
  if (input.resourceType == "snapshot" && input.snapshotIdentifier) {
    let status;
    if (input.isCluster) {
      const snapshots = await rds.describeDBClusterSnapshots({
        DBClusterIdentifier: input.databaseIdentifier,
        DBClusterSnapshotIdentifier: input.snapshotIdentifier
      }).promise();
      console.log(snapshots);
      if (!snapshots.DBClusterSnapshots || snapshots.DBClusterSnapshots.length != 1) {
        throw new Error(`Unable to find snapshot ${input.snapshotIdentifier} of ${input.databaseIdentifier}`);
      }
      status = snapshots.DBClusterSnapshots[0].Status ?? "";
    } else {
      const snapshots = await rds.describeDBSnapshots({
        DBInstanceIdentifier: input.databaseIdentifier,
        DBSnapshotIdentifier: input.snapshotIdentifier
      }).promise();
      console.log(snapshots);
      if (!snapshots.DBSnapshots || snapshots.DBSnapshots.length != 1) {
        throw new Error(`Unable to find snapshot ${input.snapshotIdentifier} of ${input.databaseIdentifier}`);
      }
      status = snapshots.DBSnapshots[0].Status ?? "";
    }
    if (status == "available") {
      return;
    }
    checkStatus(status, input.snapshotIdentifier);
  } else if (input.resourceType == "cluster") {
    const dbs = await rds.describeDBClusters({
      DBClusterIdentifier: input.databaseIdentifier
    }).promise();
    console.log(dbs);
    if (!dbs.DBClusters || dbs.DBClusters.length != 1) {
      throw new Error(`Unable to find db clsuter ${input.databaseIdentifier}`);
    }
    const status = dbs.DBClusters[0].Status ?? "";
    if (status == "available" && empty(dbs.DBClusters[0].PendingModifiedValues)) {
      return;
    }
    checkStatus(status, input.databaseIdentifier);
  } else if (input.resourceType == "instance") {
    const instances = await rds.describeDBInstances({
      DBInstanceIdentifier: input.databaseIdentifier
    }).promise();
    console.log(instances);
    if (!instances.DBInstances || instances.DBInstances.length != 1) {
      throw new Error(`Unable to find db instance ${input.databaseIdentifier}`);
    }
    const status = instances.DBInstances[0].DBInstanceStatus ?? "";
    if (status == "available" && empty(instances.DBInstances[0].PendingModifiedValues)) {
      return;
    }
    checkStatus(status, input.databaseIdentifier);
  } else {
    throw new Error("Bad parameters");
  }
};
