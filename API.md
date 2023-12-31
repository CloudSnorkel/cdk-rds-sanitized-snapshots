# CDK Construct for RDS Sanitized Snapshots

[![NPM](https://img.shields.io/npm/v/@cloudsnorkel/cdk-rds-sanitized-snapshots?label=npm&logo=npm)][2]
[![PyPI](https://img.shields.io/pypi/v/cloudsnorkel.cdk-rds-sanitized-snapshots?label=pypi&logo=pypi)][3]
[![Maven Central](https://img.shields.io/maven-central/v/com.cloudsnorkel/cdk.rds.sanitized-snapshots.svg?label=Maven%20Central&logo=java)][4]
[![Go](https://img.shields.io/github/v/tag/CloudSnorkel/cdk-rds-sanitized-snapshots?color=red&label=go&logo=go)][5]
[![Nuget](https://img.shields.io/nuget/v/CloudSnorkel.Cdk.Rds.SanitizedSnapshots?color=red&&logo=nuget)][6]
[![Release](https://github.com/CloudSnorkel/cdk-rds-sanitized-snapshots/actions/workflows/release.yml/badge.svg)](https://github.com/CloudSnorkel/cdk-rds-sanitized-snapshots/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/CloudSnorkel/cdk-rds-sanitized-snapshots/blob/main/LICENSE)

Periodically take snapshots of RDS databases, sanitize them, and share with selected accounts.

Use this to automate your development and/or QA database creation, instead of forcing them to use a database that was
created last year and was kind of kept in shape by random acts of kindness. Developers and QA love real data and this
lets you create non-production databases with sanitized production data. Use the sanitization step to delete passwords,
remove credit card numbers, eliminate PII, etc.

See [Constructs Hub][1] for installation instructions and API in all supported languages.

## Overview

![Architecture diagram](architecture.svg)

This project supplies a CDK construct that sets up a step function and a timer to execute this function. The
function will create a sanitized snapshot of a given database and share it with configured accounts. Those accounts can
then create new databases from those snapshots.

The step function does the following to create the snapshot:

1. Get a snapshot of the given database by either:
    * Finding the latest snapshot for the given database
    * Creating and waiting for a new fresh snapshot
2. Re-encrypt snapshot if KMS key is supplied
3. Create a temporary database from the snapshot
4. Wait for the database to be ready
5. Reset the master password on the temporary database to a random password
6. Wait for the password to be set
7. Use a Fargate task to connect to the temporary database and run configured SQL statements to sanitize the data
8. Take a snapshot of the temporary database
9. Optionally share the snapshot with other accounts (if you have separate accounts for developers/QA)
10. Delete temporary database and snapshot

## Usage

1. Confirm you're using CDK v2
2. Install the appropriate package
   1. [Python][3]
      ```
      pip install cloudsnorkel.cdk-rds-sanitized-snapshots
      ```
   2. [TypeScript or JavaScript][2]
      ```
      npm i @cloudsnorkel/cdk-rds-sanitized-snapshots
      ```
   3. [Java][4]
      ```xml
      <dependency>
      <groupId>com.cloudsnorkel</groupId>
      <artifactId>cdk.rds.sanitized-snapshots</artifactId>
      </dependency>
      ```
   4. [Go][5]
      ```
      go get github.com/CloudSnorkel/cdk-rds-sanitized-snapshots-go/cloudsnorkelcdkrdssanitizedsnapshots
      ```
   5. [.NET][6]
      ```
      dotnet add package CloudSnorkel.Cdk.Rds.SanitizedSnapshots
      ```
3. Use `RdsSanitizedSnapshotter` construct in your code (starting with default arguments is fine)

### Code Sample

```typescript
let vpc: ec2.Vpc;
let databaseInstance: rds.DatabaseInstance;

new RdsSanitizedSnapshotter(this, 'Snapshotter', {
  vpc: vpc,
  databaseInstance: databaseInstance,
  script: 'USE mydb; UPDATE users SET ssn = \'0000000000\'',
})
```

## Encryption

The new snapshot will be encrypted with the same key used by the original database. If the original database wasn't
encrypted, the snapshot won't be encrypted either. To add another step that changes the key, use the KMS key parameter.

See [AWS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ShareSnapshot.html) for instructions
on giving other accounts access to the key.

## Troubleshooting

* Check the status of the state machine for the step function. Click on the failed step and check out the input, output
  and exception.

## Testing

```
npm run bundle && npm run integ:default:deploy
```

[1]: https://constructs.dev/packages/@cloudsnorkel/cdk-rds-sanitized-snapshots/
[2]: https://www.npmjs.com/package/@cloudsnorkel/cdk-rds-sanitized-snapshots
[3]: https://pypi.org/project/cloudsnorkel.cdk-rds-sanitized-snapshots
[4]: https://search.maven.org/search?q=g:%22com.cloudsnorkel%22%20AND%20a:%22cdk.rds.sanitized-snapshots%22
[5]: https://pkg.go.dev/github.com/CloudSnorkel/cdk-rds-sanitized-snapshots-go/cloudsnorkelcdkrdssanitizedsnapshots
[6]: https://www.nuget.org/packages/CloudSnorkel.Cdk.Rds.SanitizedSnapshots/

# API Reference <a name="API Reference" id="api-reference"></a>

## Constructs <a name="Constructs" id="Constructs"></a>

### RdsSanitizedSnapshotter <a name="RdsSanitizedSnapshotter" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter"></a>

A process to create sanitized snapshots of RDS instance or cluster, optionally on a schedule.

The process is handled by a step function.

1. Snapshot the source database
2. Optionally re-encrypt the snapshot with a different key in case you want to share it with an account that doesn't have access to the original key
3. Create a temporary database
4. Run a Fargate task to connect to the temporary database and execute an arbitrary SQL script to sanitize it
5. Snapshot the sanitized database
6. Clean-up temporary snapshots and databases

#### Initializers <a name="Initializers" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer"></a>

```typescript
import { RdsSanitizedSnapshotter } from '@cloudsnorkel/cdk-rds-sanitized-snapshots'

new RdsSanitizedSnapshotter(scope: Construct, id: string, props: IRdsSanitizedSnapshotter)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer.parameter.scope">scope</a></code> | <code>constructs.Construct</code> | *No description.* |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer.parameter.id">id</a></code> | <code>string</code> | *No description.* |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer.parameter.props">props</a></code> | <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter">IRdsSanitizedSnapshotter</a></code> | *No description.* |

---

##### `scope`<sup>Required</sup> <a name="scope" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer.parameter.scope"></a>

- *Type:* constructs.Construct

---

##### `id`<sup>Required</sup> <a name="id" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer.parameter.id"></a>

- *Type:* string

---

##### `props`<sup>Required</sup> <a name="props" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.Initializer.parameter.props"></a>

- *Type:* <a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter">IRdsSanitizedSnapshotter</a>

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.toString">toString</a></code> | Returns a string representation of this construct. |

---

##### `toString` <a name="toString" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |

---

##### ~~`isConstruct`~~ <a name="isConstruct" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.isConstruct"></a>

```typescript
import { RdsSanitizedSnapshotter } from '@cloudsnorkel/cdk-rds-sanitized-snapshots'

RdsSanitizedSnapshotter.isConstruct(x: any)
```

Checks if `x` is a construct.

###### `x`<sup>Required</sup> <a name="x" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.property.props">props</a></code> | <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter">IRdsSanitizedSnapshotter</a></code> | *No description.* |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.property.snapshotter">snapshotter</a></code> | <code>aws-cdk-lib.aws_stepfunctions.StateMachine</code> | Step function in charge of the entire process including snapshotting, sanitizing, and cleanup. |

---

##### `node`<sup>Required</sup> <a name="node" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.property.node"></a>

```typescript
public readonly node: Node;
```

- *Type:* constructs.Node

The tree node.

---

##### `props`<sup>Required</sup> <a name="props" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.property.props"></a>

```typescript
public readonly props: IRdsSanitizedSnapshotter;
```

- *Type:* <a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter">IRdsSanitizedSnapshotter</a>

---

##### `snapshotter`<sup>Required</sup> <a name="snapshotter" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.RdsSanitizedSnapshotter.property.snapshotter"></a>

```typescript
public readonly snapshotter: StateMachine;
```

- *Type:* aws-cdk-lib.aws_stepfunctions.StateMachine

Step function in charge of the entire process including snapshotting, sanitizing, and cleanup.

Trigger this step function to get a new snapshot.

---




## Protocols <a name="Protocols" id="Protocols"></a>

### IRdsSanitizedSnapshotter <a name="IRdsSanitizedSnapshotter" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter"></a>

- *Implemented By:* <a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter">IRdsSanitizedSnapshotter</a>


#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.script">script</a></code> | <code>string</code> | SQL script used to sanitize the database. It will be executed against the temporary database. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.vpc">vpc</a></code> | <code>aws-cdk-lib.aws_ec2.IVpc</code> | VPC where temporary database and sanitizing task will be created. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseCluster">databaseCluster</a></code> | <code>aws-cdk-lib.aws_rds.IDatabaseCluster</code> | Database cluster to snapshot and sanitize. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseInstance">databaseInstance</a></code> | <code>aws-cdk-lib.aws_rds.IDatabaseInstance</code> | Database instance to snapshot and sanitize. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseKey">databaseKey</a></code> | <code>aws-cdk-lib.aws_kms.IKey</code> | KMS key used to encrypt original database, if any. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseName">databaseName</a></code> | <code>string</code> | Name of database to connect to inside the RDS cluster or instance. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.dbSubnets">dbSubnets</a></code> | <code>aws-cdk-lib.aws_ec2.SubnetSelection</code> | VPC subnets to use for temporary databases. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.fargateCluster">fargateCluster</a></code> | <code>aws-cdk-lib.aws_ecs.ICluster</code> | Cluster where sanitization task will be executed. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.sanitizeSubnets">sanitizeSubnets</a></code> | <code>aws-cdk-lib.aws_ec2.SubnetSelection</code> | VPC subnets to use for sanitization task. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.schedule">schedule</a></code> | <code>aws-cdk-lib.aws_events.Schedule</code> | The schedule or rate (frequency) that determines when the sanitized snapshot runs automatically. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.shareAccounts">shareAccounts</a></code> | <code>string[]</code> | List of accounts the sanitized snapshot should be shared with. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.snapshotHistoryLimit">snapshotHistoryLimit</a></code> | <code>number</code> | Limit the number of snapshot history. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.snapshotKey">snapshotKey</a></code> | <code>aws-cdk-lib.aws_kms.IKey</code> | Optional KMS key to encrypt target snapshot. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.snapshotPrefix">snapshotPrefix</a></code> | <code>string</code> | Prefix for sanitized snapshot name. |
| <code><a href="#@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.tempPrefix">tempPrefix</a></code> | <code>string</code> | Prefix for all temporary snapshots and databases. |

---

##### `script`<sup>Required</sup> <a name="script" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.script"></a>

```typescript
public readonly script: string;
```

- *Type:* string

SQL script used to sanitize the database. It will be executed against the temporary database.

You would usually want to start this with `USE mydatabase;`.

---

##### `vpc`<sup>Required</sup> <a name="vpc" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.vpc"></a>

```typescript
public readonly vpc: IVpc;
```

- *Type:* aws-cdk-lib.aws_ec2.IVpc

VPC where temporary database and sanitizing task will be created.

---

##### `databaseCluster`<sup>Optional</sup> <a name="databaseCluster" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseCluster"></a>

```typescript
public readonly databaseCluster: IDatabaseCluster;
```

- *Type:* aws-cdk-lib.aws_rds.IDatabaseCluster

Database cluster to snapshot and sanitize.

Only one of `databaseCluster` and `databaseInstance` can be specified.

---

##### `databaseInstance`<sup>Optional</sup> <a name="databaseInstance" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseInstance"></a>

```typescript
public readonly databaseInstance: IDatabaseInstance;
```

- *Type:* aws-cdk-lib.aws_rds.IDatabaseInstance

Database instance to snapshot and sanitize.

Only one of `databaseCluster` and `databaseInstance` can be specified.

---

##### `databaseKey`<sup>Optional</sup> <a name="databaseKey" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseKey"></a>

```typescript
public readonly databaseKey: IKey;
```

- *Type:* aws-cdk-lib.aws_kms.IKey

KMS key used to encrypt original database, if any.

---

##### `databaseName`<sup>Optional</sup> <a name="databaseName" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.databaseName"></a>

```typescript
public readonly databaseName: string;
```

- *Type:* string
- *Default:* 'postgres' for PostgreSQL and not set for MySQL

Name of database to connect to inside the RDS cluster or instance.

This database will be used to execute the SQL script.

---

##### `dbSubnets`<sup>Optional</sup> <a name="dbSubnets" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.dbSubnets"></a>

```typescript
public readonly dbSubnets: SubnetSelection;
```

- *Type:* aws-cdk-lib.aws_ec2.SubnetSelection
- *Default:* ec2.SubnetType.PRIVATE_ISOLATED

VPC subnets to use for temporary databases.

---

##### `fargateCluster`<sup>Optional</sup> <a name="fargateCluster" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.fargateCluster"></a>

```typescript
public readonly fargateCluster: ICluster;
```

- *Type:* aws-cdk-lib.aws_ecs.ICluster
- *Default:* a new cluster running on given VPC

Cluster where sanitization task will be executed.

---

##### `sanitizeSubnets`<sup>Optional</sup> <a name="sanitizeSubnets" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.sanitizeSubnets"></a>

```typescript
public readonly sanitizeSubnets: SubnetSelection;
```

- *Type:* aws-cdk-lib.aws_ec2.SubnetSelection
- *Default:* ec2.SubnetType.PRIVATE_WITH_EGRESS

VPC subnets to use for sanitization task.

---

##### `schedule`<sup>Optional</sup> <a name="schedule" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.schedule"></a>

```typescript
public readonly schedule: Schedule;
```

- *Type:* aws-cdk-lib.aws_events.Schedule

The schedule or rate (frequency) that determines when the sanitized snapshot runs automatically.

---

##### `shareAccounts`<sup>Optional</sup> <a name="shareAccounts" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.shareAccounts"></a>

```typescript
public readonly shareAccounts: string[];
```

- *Type:* string[]

List of accounts the sanitized snapshot should be shared with.

---

##### `snapshotHistoryLimit`<sup>Optional</sup> <a name="snapshotHistoryLimit" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.snapshotHistoryLimit"></a>

```typescript
public readonly snapshotHistoryLimit: number;
```

- *Type:* number

Limit the number of snapshot history.

Set this to delete old snapshots and only leave a certain number of snapshots.

---

##### `snapshotKey`<sup>Optional</sup> <a name="snapshotKey" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.snapshotKey"></a>

```typescript
public readonly snapshotKey: IKey;
```

- *Type:* aws-cdk-lib.aws_kms.IKey

Optional KMS key to encrypt target snapshot.

---

##### `snapshotPrefix`<sup>Optional</sup> <a name="snapshotPrefix" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.snapshotPrefix"></a>

```typescript
public readonly snapshotPrefix: string;
```

- *Type:* string
- *Default:* cluster identifier (which might be too long)

Prefix for sanitized snapshot name.

The current date and time will be added to it.

---

##### `tempPrefix`<sup>Optional</sup> <a name="tempPrefix" id="@cloudsnorkel/cdk-rds-sanitized-snapshots.IRdsSanitizedSnapshotter.property.tempPrefix"></a>

```typescript
public readonly tempPrefix: string;
```

- *Type:* string
- *Default:* 'sanitize'

Prefix for all temporary snapshots and databases.

The step function execution id will be added to it.

---

