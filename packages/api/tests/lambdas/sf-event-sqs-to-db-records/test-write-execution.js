'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const {
  localStackConnectionEnv,
  getKnexClient,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');

const { migrationDir } = require('../../../../../lambdas/db-migration');
const Execution = require('../../../models/executions');

const sandbox = sinon.createSandbox();
const hasAsyncOpStub = sandbox.stub().resolves(true);
const hasParentExecutionStub = sandbox.stub().resolves(true);

const {
  shouldWriteExecutionToRDS,
  writeExecution,
} = proxyquire('../../../lambdas/sf-event-sqs-to-db-records/write-execution', {
  './utils': {
    hasNoAsyncOpOrExists: hasAsyncOpStub,
    hasNoParentExecutionOrExists: hasParentExecutionStub,
  },
});

test.before(async (t) => {
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });

  const executionModel = new Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  t.context.testDbName = `writeExecutions_${cryptoRandomString({ length: 10 })}`;

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();
});

test.beforeEach((t) => {
  process.env.RDS_DEPLOYMENT_CUMULUS_VERSION = '3.0.0';
  t.context.postRDSDeploymentVersion = '4.0.0';
  t.context.preRDSDeploymentVersion = '2.9.99';

  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      cumulus_version: t.context.postRDSDeploymentVersion,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'running',
    },
  };

  t.context.hasAsyncOpStub = hasAsyncOpStub;
  t.context.hasAsyncOpStub.resetHistory();

  t.context.hasParentExecutionStub = hasParentExecutionStub;
  t.context.hasParentExecutionStub.resetHistory();
});

test.after.always(async (t) => {
  const {
    executionModel,
  } = t.context;
  await executionModel.deleteTable();
  sandbox.restore();
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('shouldWriteExecutionToRDS returns false for pre-RDS deployment execution message', async (t) => {
  const { cumulusMessage, knex, preRDSDeploymentVersion } = t.context;
  t.false(await shouldWriteExecutionToRDS(
    {
      ...cumulusMessage,
      cumulus_meta: {
        ...cumulusMessage.cumulus_meta,
        cumulus_version: preRDSDeploymentVersion,
      },
    },
    1,
    knex
  ));
});

test.serial('shouldWriteExecutionToRDS returns true for post-RDS deployment execution message if all referenced objects exist', async (t) => {
  const {
    knex,
    cumulusMessage,
  } = t.context;

  t.context.hasAsyncOpStub.withArgs(cumulusMessage).resolves(true);
  t.context.hasParentExecutionStub.withArgs(cumulusMessage).resolves(true);

  t.true(
    await shouldWriteExecutionToRDS(
      cumulusMessage,
      1,
      knex
    )
  );
});

test.serial('shouldWriteExecutionToRDS returns false if error is thrown', async (t) => {
  const {
    knex,
    cumulusMessage,
    collectionCumulusId,
  } = t.context;

  t.context.hasParentExecutionStub.withArgs(cumulusMessage).throws();

  t.false(
    await shouldWriteExecutionToRDS(cumulusMessage, collectionCumulusId, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if collection cumulus_id is not defined', async (t) => {
  const {
    knex,
    cumulusMessage,
  } = t.context;

  t.false(
    await shouldWriteExecutionToRDS(cumulusMessage, undefined, knex)
  );
});

test.serial('shouldWriteExecutionToRDS returns false if any referenced objects are missing', async (t) => {
  const {
    knex,
    cumulusMessage,
    collectionCumulusId,
  } = t.context;

  t.context.hasAsyncOpStub.withArgs(cumulusMessage).resolves(false);

  t.false(
    await shouldWriteExecutionToRDS(cumulusMessage, collectionCumulusId, knex)
  );
});

test.serial('shouldWriteExecutionToRDS throws error if RDS_DEPLOYMENT_CUMULUS_VERSION env var is missing', async (t) => {
  const {
    knex,
    cumulusMessage,
    collectionCumulusId,
  } = t.context;

  delete process.env.RDS_DEPLOYMENT_CUMULUS_VERSION;
  await t.throwsAsync(
    shouldWriteExecutionToRDS(cumulusMessage, collectionCumulusId, knex)
  );
});

test('writeExecution() saves execution to Dynamo and RDS and returns cumulus_id if write to RDS is enabled', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  const executionCumulusId = await writeExecution({ cumulusMessage, knex });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(
    await doesRecordExist({
      cumulus_id: executionCumulusId,
    }, knex, tableNames.executions)
  );
});

test.serial('writeExecution() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  const fakeExecutionModel = {
    storeExecutionFromCumulusMessage: () => {
      throw new Error('execution Dynamo error');
    },
  };

  await t.throwsAsync(
    writeExecution({
      cumulusMessage,
      knex,
      executionModel: fakeExecutionModel,
    }),
    { message: 'execution Dynamo error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
});

test.serial('writeExecution() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('execution RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(
    writeExecution({ cumulusMessage, knex }),
    { message: 'execution RDS error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
});