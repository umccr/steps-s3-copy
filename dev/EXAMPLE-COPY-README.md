How to do a full scale invoke test.

Go to "elsa-data-tmp" bucket in dev.
It probably will be empty as objects auto-expire.
Make a folder "copy-out-test-working".
Copy "example-copy-manifest.csv" to that folder.

THE FOLDER MUST BE EXACTLY AS SPECIFIED AS THAT PERMISSION IS BAKED INTO
THE DEV DEPLOYMENT (IN ORDER TO TEST PERMISSIONS!)

Invoke the dev Steps with the input (feel free to change the "0_" prefixes
relative key inputs if you
want to run multiple experiments without overriding the results)

```json
{
  "sourceFilesCsvBucket": "elsa-data-tmp",
  "sourceFilesCsvKey": "example-copy-manifest.csv",
  "destinationBucket": "elsa-data-copy-target-sydney",
  "maxItemsPerBatch": 2,
  "destinationStartCopyRelativeKey": "0_STARTED_COPY.txt",
  "destinationEndCopyRelativeKey": "0_ENDED_COPY.csv"
}
```

For a test of AG (in the AG account - with public/made up data files)

```json
{
  "sourceFilesCsvBucket": "elsa-data-copy-working",
  "sourceFilesCsvKey": "example-copy-manifest-ag.csv",
  "destinationBucket": "elsa-data-copy-target-sydney",
  "maxItemsPerBatch": 1,
  "destinationStartCopyRelativeKey": "AG_STARTED_COPY.txt",
  "destinationEndCopyRelativeKey": "AG_ENDED_COPY.csv"
}
```
