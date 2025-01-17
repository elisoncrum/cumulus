'use strict';

/**
 * Utility functions for building Cumulus messages
 *
 * @module Build
 *
 * @example
 * const Build = require('@cumulus/message/Build');
 */

import merge from 'lodash/merge';
import { Message } from '@cumulus/types';
import { v4 as uuidv4 } from 'uuid';

import {
  WorkflowMessageTemplate,
  WorkflowMessageTemplateCumulusMeta,
  Workflow,
} from './types';

/**
 * Generate an execution name.
 *
 * @param {string} [prefix]
 * @returns {string}
 * @private
 */
const createExecutionName = (prefix?: string): string =>
  (prefix ? `${prefix}-${uuidv4()}` : uuidv4());

/**
 * Build base message.cumulus_meta for a queued execution.
 *
 * @param {Object} params
 * @param {string} params.stateMachine - State machine name
 * @param {string} [params.asyncOperationId] - Async operation ID
 * @param {string} [params.parentExecutionArn] - Parent execution ARN
 * @param {string} [params.executionNamePrefix] - Prefix to apply to the name
 *   of the enqueued execution
 * @returns {Message.CumulusMeta}
 *
 * @private
 */
export const buildCumulusMeta = ({
  stateMachine,
  asyncOperationId,
  parentExecutionArn,
  templateCumulusMeta,
  executionNamePrefix,
}: {
  stateMachine: string,
  asyncOperationId?: string,
  parentExecutionArn?: string,
  templateCumulusMeta: WorkflowMessageTemplateCumulusMeta
  executionNamePrefix?: string,
}): Message.CumulusMeta => {
  const cumulusMeta: Message.CumulusMeta = {
    ...templateCumulusMeta,
    execution_name: createExecutionName(executionNamePrefix),
    state_machine: stateMachine,
  };
  if (parentExecutionArn) cumulusMeta.parentExecutionArn = parentExecutionArn;
  if (asyncOperationId) cumulusMeta.asyncOperationId = asyncOperationId;
  return cumulusMeta;
};

/**
 * Build an SQS message from a workflow template for queueing executions.
 *
 * @param {Object} params
 * @param {Object} params.provider - A provider object
 * @param {Object} params.collection - A collection object
 * @param {string} params.parentExecutionArn - ARN for parent execution
 * @param {Object} params.messageTemplate - Message template for the workflow
 * @param {Object} params.payload - Payload for the workflow
 * @param {Object} params.workflow - workflow name & arn object
 * @param {string} [params.asyncOperationId] - Async operation ID
 * @param {Object} [params.customCumulusMeta] - Custom data for message.cumulus_meta
 * @param {Object} [params.customMeta] - Custom data for message.meta
 * @param {string} [params.executionNamePrefix] - Prefix to apply to the name
 *   of the enqueued execution
 *
 * @returns {Message.CumulusMessage} A Cumulus message object
 *
 * @alias module:Build
 */
export const buildQueueMessageFromTemplate = ({
  parentExecutionArn,
  asyncOperationId,
  messageTemplate,
  payload,
  workflow,
  customCumulusMeta = {},
  customMeta = {},
  executionNamePrefix,
}: {
  parentExecutionArn: string,
  messageTemplate: WorkflowMessageTemplate,
  payload: object
  workflow: Workflow,
  asyncOperationId?: string,
  customCumulusMeta?: object
  customMeta?: object,
  executionNamePrefix?: string
}): Message.CumulusMessage => {
  const cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    stateMachine: workflow.arn,
    templateCumulusMeta: messageTemplate.cumulus_meta,
    executionNamePrefix,
  });

  const message = {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, customMeta, {
      workflow_name: workflow.name,
    }),
    cumulus_meta: merge(customCumulusMeta, cumulusMeta),
    payload,
  };

  return message;
};
