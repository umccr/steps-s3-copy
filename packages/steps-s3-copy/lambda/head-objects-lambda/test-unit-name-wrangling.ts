import { suite, test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { computeDestinationKey } from "./head-objects-lambda";

suite("head objects lambda name wrangling", async () => {
  // either null or empty string or undefined for the destination paths - so should just be copied as a file
  test("empty destination prefix and relative", (t) => {
    strictEqual(
      computeDestinationKey("abcd/file.bam", null, "", null),
      "file.bam",
    );
    strictEqual(
      computeDestinationKey("abcd/bc/de/file.bam", null, "", undefined),
      "file.bam",
    );
    strictEqual(
      computeDestinationKey("abcd/bc/de/file.bam", null, "", ""),
      "file.bam",
    );
  });

  // when we have a destination prefix - we place the files into that path
  test("has destination prefix", (t) => {
    strictEqual(
      computeDestinationKey("abcd/file.bam", null, "a-folder/", null),
      "a-folder/file.bam",
    );
    strictEqual(
      computeDestinationKey(
        "abcd/bc/de/file.bam",
        null,
        "a-folder/",
        undefined,
      ),
      "a-folder/file.bam",
    );
  });

  // when we have a destination relative path - we place the files into that path as well as the prefix
  test("has destination prefix and relative", (t) => {
    strictEqual(
      computeDestinationKey("abcd/file.bam", null, "a-folder/", "sub/"),
      "a-folder/sub/file.bam",
    );
    strictEqual(
      computeDestinationKey(
        "abcd/bc/de/file.bam",
        null,
        "a-folder/",
        "sub/more-sub/",
      ),
      "a-folder/sub/more-sub/file.bam",
    );
  });

  // when we source from under a wildcard root - we want to mirror the relative directory
  // structure from the root as well as the filename
  test("has wildcard root", (t) => {
    strictEqual(
      computeDestinationKey(
        "abcd/bc/de/file.bam",
        "abcd/",
        "a-folder/",
        "sub/more-sub/",
      ),
      "a-folder/sub/more-sub/bc/de/file.bam",
    );
    strictEqual(
      computeDestinationKey(
        "abcd/bc/de/file.bam",
        "abcd/bc/",
        "a-folder/",
        "sub/more-sub/",
      ),
      "a-folder/sub/more-sub/de/file.bam",
    );
  });
});
