import { afterEach, beforeAll, test, expect } from "bun:test";
import { equal, ok } from "node:assert/strict";
import { SFNClient, TestStateCommand } from "@aws-sdk/client-sfn";
import {
  testSetup,
  type TestSetupState,
  unitTestSetup,
  type UnitTestSetupState,
} from "./setup.js";
import { type HeadObjectsLambdaInvokeEvent } from "../packages/steps-s3-copy/lambda/head-objects-lambda/head-objects-lambda";
import { createTestObject } from "./lib/create-test-object";

const sfnClient = new SFNClient({});

const DESTINATION_PREFIX = "abc/";

const FOLDER_AA = "aa/";
const FOLDER_BB = "bb/";
const FOLDER_CCC = `ccc/`;
const FOLDER_LOTS_OF = `lots/of/`;
const FOLDER_NONE = `none/`;

const FILE1 = "a-file-with-decent-name-1.bam";
const FILE2 = "file2.bam";
const FILE3 = "file3.fastq";
const FILE4 = "file4.fastq";
const FILE5 = "file5.fastq";
const FILE6 = "file6.fastq";

const PATH1 = `${FILE1}`;
const PATH2 = `${FOLDER_AA}${FILE2}`;
const PATH3 = `${FOLDER_AA}${FILE3}`;
const PATH4 = `${FOLDER_BB}${FILE4}`;
const PATH5 = `${FOLDER_BB}${FILE5}`;
const PATH6 = `${FOLDER_BB}${FOLDER_CCC}${FILE6}`;

let state: TestSetupState;
let unitState: UnitTestSetupState;

// we have some throttling issues with the SFN steps test invokes - so just slow down the testing a bit
// seems to fix that
afterEach(async () => await new Promise((r) => setTimeout(r, 500)));

// note this happens once for the entire suite - given our head objects step is read-only - we can run the
// tests against a single S3 store and the tests will not interfere with each other
beforeAll(async () => {
  state = await testSetup();
  unitState = await unitTestSetup();

  // we create a small directory tree of objects on which we will run our tests
  await createTestObject(
    state.workingBucket,
    `${state.uniqueTestId}/${PATH1}`,
    1,
    1,
    undefined,
    "STANDARD_IA",
  );
  await createTestObject(
    state.workingBucket,
    `${state.uniqueTestId}/${PATH2}`,
    2,
    1,
    undefined,
    "STANDARD",
  );
  await createTestObject(
    state.workingBucket,
    `${state.uniqueTestId}/${PATH3}`,
    3,
    1,
    undefined,
    "STANDARD",
  );
  await createTestObject(
    state.workingBucket,
    `${state.uniqueTestId}/${PATH4}`,
    4,
    1,
    undefined,
    "DEEP_ARCHIVE",
  );
  await createTestObject(
    state.workingBucket,
    `${state.uniqueTestId}/${PATH5}`,
    5,
    1,
    undefined,
    "STANDARD",
  );
  await createTestObject(
    state.workingBucket,
    `${state.uniqueTestId}/${PATH6}`,
    6,
    1,
    undefined,
    "STANDARD",
  );

  // create files to test limits of our expansion
  for (let i = 0; i < 10; i++) {
    await createTestObject(
      state.workingBucket,
      `${state.uniqueTestId}/${FOLDER_LOTS_OF}${i.toString()}.txt`,
      1,
      1,
      undefined,
      "STANDARD",
    );
  }
});

test.serial("basic functionality", async () => {
  const input: HeadObjectsLambdaInvokeEvent = {
    BatchInput: {
      destinationFolderKey: DESTINATION_PREFIX,
      maximumExpansion: 5,
    },
    Items: [
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${PATH1}`,
      },
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${PATH3}`,
      },
    ],
  };

  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smHeadObjectsLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: JSON.stringify(input),
      variables: "{}",
    }),
  );

  equal(testStateResult.status, "SUCCEEDED");
  ok(testStateResult.output);

  const outputArray = JSON.parse(testStateResult.output);

  equal(outputArray.length, 2);

  equal(outputArray[0].sourceBucket, state.workingBucket);
  equal(outputArray[0].sourceKey, `${state.uniqueTestId}/${PATH1}`);
  equal(outputArray[0].destinationKey, `${DESTINATION_PREFIX}${FILE1}`);
  equal(outputArray[0].size, 1);
  equal(outputArray[0].storageClass, "STANDARD_IA");
  equal(outputArray[0].etag, '"7b774effe4a349c6dd82ad4f4f21d34c"'); // pragma: allowlist secret
  ok(outputArray[0].lastModifiedISOString);

  equal(outputArray[1].sourceBucket, state.workingBucket);
  equal(outputArray[1].sourceKey, `${state.uniqueTestId}/${PATH3}`);
  equal(outputArray[1].destinationKey, `${DESTINATION_PREFIX}${FILE3}`);
  equal(outputArray[1].size, 3);
  equal(outputArray[1].storageClass, "STANDARD");
  equal(outputArray[1].etag, '"3bc04be24352496f56e03c2e6debaf3a"'); // pragma: allowlist secret
  ok(outputArray[1].lastModifiedISOString);
});

test.serial(
  "sourceRoot places objects retaining original folder structure",
  async () => {
    const input: HeadObjectsLambdaInvokeEvent = {
      BatchInput: {
        destinationFolderKey: DESTINATION_PREFIX,
        maximumExpansion: 5,
      },
      Items: [
        {
          sourceBucket: state.workingBucket,
          sourceKey: `${state.uniqueTestId}/${PATH5}`,
          sourceRootFolderKey: `${state.uniqueTestId}/`,
        },
        {
          sourceBucket: state.workingBucket,
          sourceKey: `${state.uniqueTestId}/${PATH6}`,
          sourceRootFolderKey: `${state.uniqueTestId}/`,
        },
      ],
    };

    const testStateResult = await sfnClient.send(
      new TestStateCommand({
        definition: unitState.smHeadObjectsLambdaAslStateString,
        roleArn: unitState.smRoleArn,
        input: JSON.stringify(input),
        variables: "{}",
      }),
    );

    equal(testStateResult.status, "SUCCEEDED");
    ok(testStateResult.output);

    const outputArray = JSON.parse(testStateResult.output);

    equal(outputArray.length, 2);

    // note our array ordering here may differ from the order of the inputs (there is no requirement for inputs
    // to be sorted)

    equal(outputArray[0].sourceBucket, state.workingBucket);
    equal(outputArray[0].sourceKey, `${state.uniqueTestId}/${PATH6}`);
    equal(
      outputArray[0].destinationKey,
      `${DESTINATION_PREFIX}${FOLDER_BB}${FOLDER_CCC}${FILE6}`,
    );

    equal(outputArray[1].sourceBucket, state.workingBucket);
    equal(outputArray[1].sourceKey, `${state.uniqueTestId}/${PATH5}`);
    equal(
      outputArray[1].destinationKey,
      `${DESTINATION_PREFIX}${FOLDER_BB}${FILE5}`,
    );
  },
);

test.serial(
  "destinationRelativeFolderKey places objects in arbitrary locations",
  async () => {
    const DEST1 = "xxx/";
    const DEST2 = "yyy/";

    const input: HeadObjectsLambdaInvokeEvent = {
      BatchInput: {
        destinationFolderKey: DESTINATION_PREFIX,
        maximumExpansion: 5,
      },
      Items: [
        {
          sourceBucket: state.workingBucket,
          sourceKey: `${state.uniqueTestId}/${PATH4}`,
          destinationRelativeFolderKey: `${DEST1}`,
        },
        {
          sourceBucket: state.workingBucket,
          sourceKey: `${state.uniqueTestId}/${PATH5}`,
          destinationRelativeFolderKey: `${DEST2}`,
        },
        {
          sourceBucket: state.workingBucket,
          sourceKey: `${state.uniqueTestId}/${PATH6}`,
          destinationRelativeFolderKey: `${DEST2}${DEST1}`,
        },
      ],
    };

    const testStateResult = await sfnClient.send(
      new TestStateCommand({
        definition: unitState.smHeadObjectsLambdaAslStateString,
        roleArn: unitState.smRoleArn,
        input: JSON.stringify(input),
        variables: "{}",
      }),
    );

    equal(testStateResult.status, "SUCCEEDED");
    ok(testStateResult.output);

    const outputArray = JSON.parse(testStateResult.output);

    equal(outputArray.length, 3);

    equal(outputArray[0].sourceKey, `${state.uniqueTestId}/${PATH4}`);
    equal(
      outputArray[0].destinationKey,
      `${DESTINATION_PREFIX}${DEST1}${FILE4}`,
    );

    equal(outputArray[1].sourceKey, `${state.uniqueTestId}/${PATH5}`);
    equal(
      outputArray[1].destinationKey,
      `${DESTINATION_PREFIX}${DEST2}${FILE5}`,
    );

    equal(outputArray[2].sourceKey, `${state.uniqueTestId}/${PATH6}`);
    equal(
      outputArray[2].destinationKey,
      `${DESTINATION_PREFIX}${DEST2}${DEST1}${FILE6}`,
    );
  },
);

test.serial("wildcard expansion with destination prefix", async () => {
  const input: HeadObjectsLambdaInvokeEvent = {
    BatchInput: {
      destinationFolderKey: DESTINATION_PREFIX,
      maximumExpansion: 5,
    },
    Items: [
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${FOLDER_BB}*`,
      },
      // note that file 5 is also in the wildcard expansion - so we expect to see two entries of it in
      // the output
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${PATH5}`,
      },
    ],
  };

  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smHeadObjectsLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: JSON.stringify(input),
      variables: "{}",
    }),
  );

  equal(testStateResult.status, "SUCCEEDED");
  ok(testStateResult.output);

  const outputArray = JSON.parse(testStateResult.output);

  equal(outputArray.length, 4);

  equal(outputArray[0].sourceBucket, state.workingBucket);
  equal(outputArray[0].sourceKey, `${state.uniqueTestId}/${PATH6}`);
  equal(
    outputArray[0].destinationKey,
    `${DESTINATION_PREFIX}${FOLDER_CCC}${FILE6}`,
  );
  // we need to make sure outputs generated from wildcards have information just the same as those
  // explicitly listed
  equal(outputArray[0].size, 6);
  equal(outputArray[0].storageClass, "STANDARD");
  equal(outputArray[0].etag, '"92daea91dc4f0f60df59fa33f8d46d99"'); // pragma: allowlist secret

  equal(outputArray[1].sourceBucket, state.workingBucket);
  equal(outputArray[1].sourceKey, `${state.uniqueTestId}/${PATH4}`);
  equal(outputArray[1].destinationKey, `${DESTINATION_PREFIX}${FILE4}`);

  // NOTE that this FILE5 is listed twice - once from the wildcard expansion and once from the explicit listing
  equal(outputArray[2].sourceBucket, state.workingBucket);
  equal(outputArray[2].sourceKey, `${state.uniqueTestId}/${PATH5}`);
  equal(outputArray[2].destinationKey, `${DESTINATION_PREFIX}${FILE5}`);

  equal(outputArray[3].sourceBucket, state.workingBucket);
  equal(outputArray[3].sourceKey, `${state.uniqueTestId}/${PATH5}`);
  equal(outputArray[3].destinationKey, `${DESTINATION_PREFIX}${FILE5}`);
});

test.serial("sums data is passed through", async () => {
  const input: HeadObjectsLambdaInvokeEvent = {
    BatchInput: {
      destinationFolderKey: DESTINATION_PREFIX,
      maximumExpansion: 5,
    },
    Items: [
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${PATH1}`,
        sums: "{v:1}",
      },
    ],
  };

  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smHeadObjectsLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: JSON.stringify(input),
      variables: "{}",
    }),
  );

  equal(testStateResult.status, "SUCCEEDED");
  ok(testStateResult.output);

  const outputArray = JSON.parse(testStateResult.output);

  equal(outputArray.length, 1);

  equal(outputArray[0].sourceKey, `${state.uniqueTestId}/${PATH1}`);
  equal(outputArray[0].destinationKey, `${DESTINATION_PREFIX}${FILE1}`);
  equal(outputArray[0].sums, `{v:1}`);
});

test.serial("missing object will fail", async () => {
  const input: HeadObjectsLambdaInvokeEvent = {
    BatchInput: {
      destinationFolderKey: DESTINATION_PREFIX,
      maximumExpansion: 5,
    },
    Items: [
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/a-name-we-made-up`,
      },
    ],
  };

  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smHeadObjectsLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: JSON.stringify(input),
      variables: "{}",
    }),
  );

  equal(testStateResult.status, "FAILED");
  equal(testStateResult.error, "SourceObjectNotFound");
});

test("wildcard expansion will fail if too many", async () => {
  const input: HeadObjectsLambdaInvokeEvent = {
    BatchInput: {
      destinationFolderKey: DESTINATION_PREFIX,
      maximumExpansion: 5,
    },
    Items: [
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${FOLDER_LOTS_OF}*`,
      },
    ],
  };

  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smHeadObjectsLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: JSON.stringify(input),
      variables: "{}",
    }),
  );

  equal(testStateResult.status, "FAILED");
  equal(testStateResult.error, "WildcardExpansionMaximumError");
});

test.serial("wildcard expansion will fail if none", async () => {
  const input: HeadObjectsLambdaInvokeEvent = {
    BatchInput: {
      destinationFolderKey: DESTINATION_PREFIX,
      maximumExpansion: 5,
    },
    Items: [
      {
        sourceBucket: state.workingBucket,
        sourceKey: `${state.uniqueTestId}/${FOLDER_NONE}*`,
      },
    ],
  };

  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smHeadObjectsLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: JSON.stringify(input),
      variables: "{}",
    }),
  );

  equal(testStateResult.status, "FAILED");
  equal(testStateResult.error, "WildcardExpansionEmptyError");
});
