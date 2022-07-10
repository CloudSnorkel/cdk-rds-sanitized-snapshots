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

// src/parameters.lambda.ts
var crypto = __toESM(require("crypto"));
var AWS = __toESM(require("aws-sdk"));
var rds = new AWS.RDS();
function getDockerImage(engine) {
  if (engine.match(/(^aurora$|mysql|mariadb)/)) {
    return "mysql";
  } else if (engine.match(/postgres/)) {
    return "postgres";
  } else {
    throw new Error(`"${engine}" is not a supported database engine`);
  }
}
function confirmLength(name, value) {
  let error;
  if (value.length > 63) {
    error = "is too long";
  }
  if (!value.charAt(0).match(/[a-z]/i)) {
    error = "does not start with a letter";
  }
  if (value.indexOf("--") >= 0) {
    error = "contains two consecutive hyphens";
  }
  if (error) {
    throw new Error(`"${name}" ${error}. Try adjusting 'tempPrefix' and/or 'snapshotPrefix'. Current value: ${value}`);
  }
}
exports.handler = async function(input) {
  var _a, _b;
  let port;
  let user;
  let engine;
  let kmsKeyId;
  let instanceClass;
  if (input.isCluster) {
    const origDb = await rds.describeDBClusters({ DBClusterIdentifier: input.databaseIdentifier }).promise();
    if (!origDb.DBClusters || origDb.DBClusters.length != 1) {
      throw new Error(`Unable to find ${input.databaseIdentifier}`);
    }
    const cluster = origDb.DBClusters[0];
    if (!cluster.Port || !cluster.MasterUsername || !cluster.DBClusterMembers) {
      throw new Error(`Database missing some required parameters: ${JSON.stringify(cluster)}`);
    }
    const origInstances = await rds.describeDBInstances({ DBInstanceIdentifier: cluster.DBClusterMembers[0].DBInstanceIdentifier }).promise();
    if (!origInstances.DBInstances || origInstances.DBInstances.length < 1) {
      throw new Error(`Unable to find instances for ${input.databaseIdentifier}`);
    }
    const instance = origInstances.DBInstances[0];
    if (!instance.DBInstanceClass) {
      throw new Error(`Database instance missing class: ${JSON.stringify(instance)}`);
    }
    port = cluster.Port;
    user = cluster.MasterUsername;
    engine = cluster.Engine;
    kmsKeyId = cluster.KmsKeyId;
    instanceClass = instance.DBInstanceClass;
  } else {
    const origDb = await rds.describeDBInstances({ DBInstanceIdentifier: input.databaseIdentifier }).promise();
    if (!origDb.DBInstances || origDb.DBInstances.length != 1) {
      throw new Error(`Unable to find ${input.databaseIdentifier}`);
    }
    const instance = origDb.DBInstances[0];
    if (!((_a = instance.Endpoint) == null ? void 0 : _a.Address) || !((_b = instance.Endpoint) == null ? void 0 : _b.Port) || !instance.MasterUsername) {
      throw new Error(`Database missing some required parameters: ${JSON.stringify(instance)}`);
    }
    port = instance.Endpoint.Port;
    user = instance.MasterUsername;
    engine = instance.Engine;
    kmsKeyId = instance.KmsKeyId;
    instanceClass = instance.DBInstanceClass ?? "db.m5.large";
  }
  if (input.databaseKey && input.databaseKey !== "") {
    if (input.databaseKey !== kmsKeyId) {
      throw new Error(`Database key (${kmsKeyId}) doesn't match databaseKey parameter (${input.databaseKey})`);
    }
  }
  const timestamp = new Date();
  const snapshotSuffix = `-${timestamp.getUTCFullYear()}${timestamp.getUTCMonth().toString().padStart(2, "0")}${timestamp.getUTCDay().toString().padStart(2, "0")}${timestamp.getUTCHours().toString().padStart(2, "0")}${timestamp.getUTCMinutes().toString().padStart(2, "0")}`;
  const targetSnapshotId = `${input.snapshotPrefix}${snapshotSuffix}`;
  const tempSuffix = crypto.randomBytes(8).toString("hex");
  const result = {
    databaseIdentifier: input.databaseIdentifier,
    isCluster: input.isCluster,
    engine: engine ?? "unknown",
    tempSnapshotId: `${input.tempPrefix}-${tempSuffix}`,
    tempEncSnapshotId: `${input.tempPrefix}-enc-${tempSuffix}`,
    tempDbId: `${input.tempPrefix}-${tempSuffix}`,
    tempDbInstanceId: `${input.tempPrefix}-inst-${tempSuffix}`,
    tempDbInstanceClass: instanceClass,
    targetSnapshotId,
    dockerImage: getDockerImage(engine ?? ""),
    tempDb: {
      host: {
        endpoint: "NOT KNOWN YET"
      },
      port: port.toString(),
      user,
      password: crypto.randomBytes(16).toString("hex")
    }
  };
  confirmLength("tempSnapshotId", result.tempSnapshotId);
  confirmLength("tempEncSnapshotId", result.tempEncSnapshotId);
  confirmLength("tempDbId", result.tempDbId);
  confirmLength("tempDbInstanceId", result.tempDbInstanceId);
  confirmLength("targetSnapshotId", result.targetSnapshotId);
  return result;
};
