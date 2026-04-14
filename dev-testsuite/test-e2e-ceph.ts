import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { WaiterState } from "@smithy/util-waiter";
import { makeObjectDictionaryJsonl } from "./util.mjs";
import { testSetup, type TestSetupState } from "./setup";
import { beforeAll, test } from "bun:test";
import { createTestObject } from "./lib/create-test-object";
import {
  REALISTIC_SOURCE_OBJECTS,
  REALISTIC_WILDCARD_PREFIX,
} from "./lib/realistic-source-objects";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import assert from "node:assert";
import { assertDestinations } from "./lib/assert-destinations.mjs";
import type { BucketDefinition } from "../packages/steps-s3-copy/src/steps-s3-copy-input";
import { buildS3Client } from "../packages/steps-s3-copy/lambda/common/s3-client-builder";

const TEST_EXPECTED_SECONDS = 60 * 15;

const S3_ENDPOINT_URL =
  process.env.STEPS_TEST_ENDPOINT_URL ??
  "https://objects.storage.unimelb.edu.au";
const S3_SECRET_NAME =
  process.env.STEPS_TEST_SECRET_NAME ?? "ceph-5690-guardians-dev";
const S3_BUCKET = process.env.STEPS_TEST_BUCKET ?? "5690-guardians-dev";
const S3_REGION = process.env.STEPS_TEST_REGION ?? "ap-southeast-2";

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();
});

const cephBucketDefinition: BucketDefinition = {
  credentialProvider: "aws-secret",
  secret: S3_SECRET_NAME,
  endpointUrl: S3_ENDPOINT_URL,
  s3Compatible: true,
  ...(S3_REGION && { region: S3_REGION }),
};

/**
 * A test of copying from native S3 to an S3-compatible endpoint.
 */
test(
  "s3compatible",
  async () => {
    const sfnClient = new SFNClient({});

    const sourceObjects = REALISTIC_SOURCE_OBJECTS;

    for (const [n, params] of Object.entries(sourceObjects)) {
      await createTestObject(
        state.workingBucket,
        `${state.testSrcPrefix}${n}`,
        params.sizeInBytes,
        0,
        params.partSizeInBytes,
        params.storageClass,
      );
    }

    {
      const testObjectKeys = Object.keys(sourceObjects)
        .filter((n) => !n.startsWith(REALISTIC_WILDCARD_PREFIX))
        .map((n) => `${state.testSrcPrefix}${n}`);

      testObjectKeys.push(
        `${state.testSrcPrefix}${REALISTIC_WILDCARD_PREFIX}*`,
      );

      await makeObjectDictionaryJsonl(
        {
          [state.workingBucket]: testObjectKeys,
        },
        state.workingBucket,
        state.testInstructionsAbsolute,
      );
    }

    const DEST = "steps_s3_copy_destination/";
    console.info("Copying to S3 endpoint");

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: state.uniqueTestId,
        input: JSON.stringify({
          copyInstructionsKey: state.testInstructionsRelative,
          destinationBucket: S3_BUCKET,
          destinationFolderKey: `${state.testDestPrefix}${DEST}`,
          // the destination is not in AWS so disable the region check
          destinationRequiredRegion: "",
          maxItemsPerBatch: 3,
          bucketDefinitions: {
            [S3_BUCKET]: cephBucketDefinition,
          },
        }),
      }),
    );

    console.info("Waiting for copy to complete");

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    assert(
      executionResult.state === WaiterState.SUCCESS,
      `Orchestration did not succeed, got ${executionResult.state}`,
    );

    const s3CompatClient = await buildS3Client(S3_BUCKET, {
      [S3_BUCKET]: cephBucketDefinition,
    });
    await assertDestinations(
      S3_BUCKET,
      `${state.testDestPrefix}${DEST}`,
      sourceObjects,
      s3CompatClient as any,
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
