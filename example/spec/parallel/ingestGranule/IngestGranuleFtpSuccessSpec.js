'use strict';

const fs = require('fs-extra');
const pMap = require('p-map');
const mime = require('mime-types');

const { models: { Granule } } = require('@cumulus/api');
const { headObject } = require('@cumulus/aws-client/S3');
const { randomStringFromRegex } = require('@cumulus/common/test-utils');
const {
  addCollections,
  api: apiTestUtils,
  cleanupCollections,
} = require('@cumulus/integration-tests');
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
const { getGranule, deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { buildFtpProvider, createProvider } = require('../../helpers/Providers');
const workflowName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

describe('The FTP Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranuleFtp.input.payload.json';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let config;
  let granuleModel;
  let inputPayload;
  let pdrFilename;
  let provider;
  let testSuffix;
  let workflowExecution;
  let ingestGranuleExecutionArn;
  let beforeAllFailed;
  let testGranule;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'IngestGranuleFtpSuccess');
      testSuffix = createTestSuffix(testId);
      const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      provider = await buildFtpProvider(testSuffix);

      process.env.GranulesTable = `${config.stackName}-GranulesTable`;
      granuleModel = new Granule();

      // populate collections, providers and test data
      const promiseResults = await Promise.all([
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        createProvider(config.stackName, provider),
      ]);

      const createdProvider = JSON.parse(promiseResults[1].body).record;

      console.log('\nStarting ingest test');
      inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename, 'utf8'));
      inputPayload.granules[0].dataType += testSuffix;
      inputPayload.granules[0].granuleId = randomStringFromRegex(granuleRegex);
      pdrFilename = inputPayload.pdr.name;

      console.log(`Granule id is ${inputPayload.granules[0].granuleId}`);

      // delete the granule record from DynamoDB if exists
      await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, createdProvider, inputPayload
      );

      ingestGranuleExecutionArn = workflowExecution.executionArn;

      await waitForApiStatus(
        getExecution,
        {
          prefix: config.stackName,
          arn: ingestGranuleExecutionArn,
        },
        'completed'
      );
      testGranule = await waitForApiStatus(
        getGranule,
        {
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId,
        },
        'completed'
      );
    } catch (error) {
      beforeAllFailed = error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });

    await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleExecutionArn });

    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      deleteProvider({ prefix: config.stackName, provider: provider.id }),
    ]);
  });

  describe('the execution', () => {
    afterAll(async () => {
      // clean up granule
      await deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
      });
    });

    it('completes execution with success status', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(workflowExecution.status).toEqual('completed');
    });

    it('makes the granule available through the Cumulus API', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(testGranule.granuleId).toEqual(inputPayload.granules[0].granuleId);
    });

    it('uploaded the granules with correct ContentType', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const objectTests = await pMap(
        testGranule.files,
        async ({ bucket, key }) => {
          const headObjectResponse = await headObject(
            bucket, key, { retries: 5 }
          );

          return [
            headObjectResponse.ContentType,
            mime.lookup(key) || 'application/octet-stream',
          ];
        }
      );

      objectTests.forEach(
        ([actual, expected]) => expect(actual).toEqual(expected)
      );
    });
  });
});
