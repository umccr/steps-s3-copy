import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  GetExecutionHistoryCommand,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import { WaiterState } from "@smithy/util-waiter";
import { beforeAll, test } from "bun:test";
import assert from "node:assert";
import { basename } from "node:path";
import { makeObjectDictionaryJsonl } from "./util.mjs";
import { testSetup, type TestSetupState } from "./setup";
import { createTestObject } from "./lib/create-test-object";
import { createLargeTestObject } from "./lib/create-large-test-object";
import { MiB } from "./lib/suffixes.js";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import { assertCopiedObject } from "./lib/assert-destinations.mjs";
import {
  SMALL_SIZE_THRESHOLD_BYTES,
  MEDIUM_SIZE_THRESHOLD_BYTES,
} from "../packages/steps-s3-copy/lambda/common/constants";

/**
 * A test of the edges of the copy size tiers (small -> Lambda, medium -> high memory Lambda,
 * large -> Fargate). It creates one object on each side of each size threshold and checks that
 * each one is routed to the expected tier.
 *
 * The sizes come from the threshold constants, so this keeps working if the thresholds change.
 *
 * NOTE: this is deliberately NOT part of the regular test runs. It creates two objects at the
 * medium/large boundary (so tens of GiB in S3, built server side) and then really copies them,
 * including a Fargate copy of the largest, so it is slow and costs money. Run it when
 * working on the tiers themselves.
 */

// the real copy includes a (just over) medium sized Lambda copy and a Fargate copy
const TEST_EXPECTED_SECONDS = 30 * 60;

// building the big source objects is server side but still takes a while
const SETUP_EXPECTED_SECONDS = 15 * 60;

// objects up to this size are uploaded from memory, anything bigger is built server side in S3
const MAX_DIRECT_UPLOAD_BYTES = 256 * MiB;

type TierName = "small" | "medium" | "large";

type TierBoundaryObject = {
  // the file name of the object
  name: string;
  sizeInBytes: number;
  expectedTier: TierName;
};

// one object on each side of each threshold (a threshold is inclusive for the lower tier)
const BOUNDARY_OBJECTS: TierBoundaryObject[] = [
  {
    name: "small-at-small-threshold.bin",
    sizeInBytes: SMALL_SIZE_THRESHOLD_BYTES,
    expectedTier: "small",
  },
  {
    name: "medium-just-above-small-threshold.bin",
    sizeInBytes: SMALL_SIZE_THRESHOLD_BYTES + 1,
    expectedTier: "medium",
  },
  {
    name: "medium-at-medium-threshold.bin",
    sizeInBytes: MEDIUM_SIZE_THRESHOLD_BYTES,
    expectedTier: "medium",
  },
  {
    name: "large-just-above-medium-threshold.bin",
    sizeInBytes: MEDIUM_SIZE_THRESHOLD_BYTES + 1,
    expectedTier: "large",
  },
];

let state: TestSetupState;

const DEST = "a-destination-folder/";

beforeAll(async () => {
  state = await testSetup();

  console.info("Creating test objects");

  for (const o of BOUNDARY_OBJECTS) {
    const key = `${state.testSrcPrefix}${o.name}`;

    if (o.sizeInBytes <= MAX_DIRECT_UPLOAD_BYTES) {
      // small enough to build in memory and upload directly
      await createTestObject(state.workingBucket, key, o.sizeInBytes, 0);
    } else {
      await createLargeTestObject(
        state.workingBucket,
        key,
        o.sizeInBytes,
        `${state.testSrcPrefix}helper/${o.name}.part`,
      );
    }

    console.info(`Created ${o.sizeInBytes} byte object ${o.name}`);
  }

  console.info("Creating copy instruction JSONL");

  await makeObjectDictionaryJsonl(
    {
      [state.workingBucket]: BOUNDARY_OBJECTS.map(
        (o) => `${state.testSrcPrefix}${o.name}`,
      ),
    },
    state.workingBucket,
    state.testInstructionsAbsolute,
  );
}, SETUP_EXPECTED_SECONDS * 1000);

/**
 * Finds the copy sets that the coordinate step produced in the history of an execution.
 */
async function findCopySets(
  sfnClient: SFNClient,
  executionArn: string,
): Promise<Record<string, { bucket: string; key: string }>> {
  let nextToken: string | undefined;

  do {
    const page = await sfnClient.send(
      new GetExecutionHistoryCommand({
        executionArn,
        includeExecutionData: true,
        nextToken,
      }),
    );

    for (const e of page.events ?? []) {
      const output =
        e.taskSucceededEventDetails?.output ??
        e.lambdaFunctionSucceededEventDetails?.output;

      if (!output) continue;

      const parsed = JSON.parse(output);
      const result = parsed?.Payload ?? parsed;

      if (result?.copySets) return result.copySets;
    }

    nextToken = page.nextToken;
  } while (nextToken);

  throw new Error(
    "Could not find the coordinate copy results in the execution",
  );
}

/**
 * Reads the source keys that a copy set assigned to a tier.
 */
async function readCopySetSourceKeys(
  s3Client: S3Client,
  copySet: { bucket: string; key: string },
): Promise<string[]> {
  const r = await s3Client.send(
    new GetObjectCommand({ Bucket: copySet.bucket, Key: copySet.key }),
  );

  const content = (await r.Body!.transformToString()).trim();

  if (content.length === 0) return [];

  return content.split("\n").map((l) => JSON.parse(l).sourceKey as string);
}

async function runExecution(
  sfnClient: SFNClient,
  nameSuffix: string,
  dryRun: boolean,
) {
  const executionStartResult = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: state.smArn,
      name: `${state.uniqueTestId}-${nameSuffix}`,
      input: JSON.stringify({
        instructionsPrefix: state.testInstructionsFolder,
        instructionsKey: state.testInstructionsKey,
        destinationBucket: state.workingBucket,
        destinationPrefix: `${state.testDestPrefix}${DEST}`,
        dryRun: dryRun,
      }),
    }),
  );

  const executionResult = await waitUntilStateMachineFinishes(
    { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
    { executionArn: executionStartResult.executionArn! },
  );

  assert(
    executionResult.state === WaiterState.SUCCESS,
    `Orchestration did not succeed as expected - it got ${executionResult.state} rather than ${WaiterState.SUCCESS}`,
  );

  return executionStartResult.executionArn!;
}

// A dry run does no copying, but still sorts the objects into copy sets so this checks
// the routing without paying for the (slow) copies
test(
  "objects either side of each size threshold are routed to the expected tier",
  async () => {
    const sfnClient = new SFNClient({});
    const s3Client = new S3Client({});

    const executionArn = await runExecution(sfnClient, "dry-run", true);

    const copySets = await findCopySets(sfnClient, executionArn);

    for (const tier of ["small", "medium", "large"] as const) {
      const copySet = copySets[tier];
      assert(copySet, `The coordinate step produced no copy set for ${tier}`);

      const sourceKeys = await readCopySetSourceKeys(s3Client, copySet);

      for (const o of BOUNDARY_OBJECTS) {
        const inThisTier = sourceKeys.includes(
          `${state.testSrcPrefix}${o.name}`,
        );

        assert.equal(
          inThisTier,
          o.expectedTier === tier,
          `${o.name} (${o.sizeInBytes} bytes) ${
            inThisTier ? "was" : "was not"
          } in the ${tier} copy set, expected it to be in ${o.expectedTier}`,
        );
      }

      console.info(`✅ ${tier} copy set holds the expected objects`);
    }
  },
  TEST_EXPECTED_SECONDS * 1000,
);

// The real copy checks that every tier can actually copy the biggest object it is meant to handle
// (in particular the Lambda timeout and bandwidth at the top of the medium tier)
test(
  "objects either side of each size threshold copy successfully",
  async () => {
    await runExecution(new SFNClient({}), "copy", false);

    for (const o of BOUNDARY_OBJECTS) {
      await assertCopiedObject(
        state.workingBucket,
        `${state.testDestPrefix}${DEST}${basename(o.name)}`,
        o.sizeInBytes,
      );
    }
  },
  TEST_EXPECTED_SECONDS * 1000,
);
