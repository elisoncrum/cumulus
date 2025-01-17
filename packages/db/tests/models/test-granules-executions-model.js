const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  TableNames,
  migrationDir,
  createRejectableTransaction,
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const collectionPgModel = new CollectionPgModel();
  [t.context.collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );

  t.context.executionPgModel = new ExecutionPgModel();
});

test.beforeEach(async (t) => {
  const [executionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  t.context.executionCumulusId = executionCumulusId;
  const [granuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.collectionCumulusId,
    })
  );
  t.context.granuleCumulusId = granuleCumulusId;
  t.context.joinRecord = {
    execution_cumulus_id: executionCumulusId,
    granule_cumulus_id: Number(granuleCumulusId),
  };
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('GranulesExecutionsPgModel.create() creates a new granule/execution join record', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const records = await trx(TableNames.granulesExecutions).where(joinRecord);
    t.is(
      records.length,
      1
    );
  });
});

test('GranulesExecutionsPgModel.exists() correctly returns true', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    t.true(
      await granulesExecutionsPgModel.exists(trx, joinRecord)
    );
  });
});

test.serial('GranulesExecutionsPgModel.exists() correctly returns false', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    t.false(
      await granulesExecutionsPgModel.exists(trx, {
        execution_cumulus_id: 5,
        granule_cumulus_id: 5,
      })
    );
  });
});

test('GranulesExecutionsPgModel.upsert() creates a new granule/execution join record', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.upsert(trx, joinRecord);
    const records = await trx(TableNames.granulesExecutions).where(joinRecord);
    t.is(
      records.length,
      1
    );
  });
});

test('GranulesExecutionsPgModel.upsert() overwrites a new granule/execution join record', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(2);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.upsert(trx, joinRecord);
    t.true(await granulesExecutionsPgModel.exists(trx, joinRecord));
    await granulesExecutionsPgModel.upsert(trx, joinRecord);
    t.true(await granulesExecutionsPgModel.exists(trx, joinRecord));
  });
});

test('GranulesExecutionsPgModel.search() returns all granule/execution join records matching query', async (t) => {
  const {
    knex,
    executionPgModel,
    granulesExecutionsPgModel,
    executionCumulusId,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const [newExecutionCumulusId] = await executionPgModel.create(
      trx,
      fakeExecutionRecordFactory()
    );

    await granulesExecutionsPgModel.create(trx, {
      ...joinRecord,
      execution_cumulus_id: newExecutionCumulusId,
    });

    t.deepEqual(
      await granulesExecutionsPgModel.search(trx, {
        granule_cumulus_id: joinRecord.granule_cumulus_id,
      }),
      [executionCumulusId, newExecutionCumulusId].map((executionId) => ({
        execution_cumulus_id: executionId,
        granule_cumulus_id: joinRecord.granule_cumulus_id,
      }))
    );
  });
});

test('GranulesExecutionsPgModel.searchByGranuleCumulusIds() returns correct values', async (t) => {
  const {
    knex,
    executionPgModel,
    granulesExecutionsPgModel,
    executionCumulusId,
    joinRecord,
  } = t.context;
  let newExecutionCumulusId;
  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    [newExecutionCumulusId] = await executionPgModel.create(
      trx,
      fakeExecutionRecordFactory()
    );

    await granulesExecutionsPgModel.create(trx, {
      ...joinRecord,
      execution_cumulus_id: newExecutionCumulusId,
    });
  });

  const results = await granulesExecutionsPgModel
    .searchByGranuleCumulusIds(knex, [joinRecord.granule_cumulus_id]);

  t.deepEqual(results.sort(), [executionCumulusId, newExecutionCumulusId].sort());
});

test('GranulesExecutionsPgModel.searchByGranuleCumulusIds() works with a transaction', async (t) => {
  const {
    knex,
    executionPgModel,
    granulesExecutionsPgModel,
    executionCumulusId,
    joinRecord,
  } = t.context;
  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const [newExecutionCumulusId] = await executionPgModel.create(
      trx,
      fakeExecutionRecordFactory()
    );

    await granulesExecutionsPgModel.create(trx, {
      ...joinRecord,
      execution_cumulus_id: newExecutionCumulusId,
    });

    const results = await granulesExecutionsPgModel
      .searchByGranuleCumulusIds(trx, [joinRecord.granule_cumulus_id]);

    t.deepEqual(results.sort(), [executionCumulusId, newExecutionCumulusId].sort());
  });
});

test('GranulesExecutionsPgModel.delete() correctly deletes records', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  let actual;
  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    await granulesExecutionsPgModel.delete(trx, joinRecord);
    actual = await granulesExecutionsPgModel.search(trx, joinRecord);
  });

  t.deepEqual(actual, []);
});
