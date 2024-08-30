import { createHash as createHashCrypto, Hash } from "node:crypto";
import { createHash as createHashCrc } from "./crc-hash.mjs";
import { BinaryToTextEncoding } from "crypto";
import { BufferSplit} from "./buffer-split.mjs";
import {pipeline} from "node:stream/promises";

export type Checksums = {
  crc32: string;
  md5: string;
  sha1: string;
  sha256: string;
};

export type HashesReport = {
  // checksums across the entire file content - in standard hex format
  // (i.e. no AWS related shenanigans)
  total: Checksums;

  // checksums as this would be represented in AWS
  aws: Checksums;
}

/**
 * For a given buffer and desired part size - calculate the checksums that would occur
 * if the object was uploaded to AWS S3. Checksums are returned both as "single" checksums
 * (i.e. the file as a single part - similar to running md5sum etc), and "multipart" checksums
 * according to AWS algorithms for multipart uploads.
 *
 * @param bufferSplit
 */
export function calcMultipleHashes(
  bufferSplit: BufferSplit,
): HashesReport {

  return {
    total: {
      crc32: "",
      md5: "",
      sha1: "",
      sha256: "",
    },
    aws: {
      crc32: "",
      md5: "",
      sha1: "",
      sha256: "",
    }

  };

  const crc32Total = createHashCrc("crc32").update(bufferSplit.buffer);
  const md5Total = createHashCrypto("md5").update(bufferSplit.buffer);
  const sha1Total = createHashCrypto("sha1").update(bufferSplit.buffer);
  const sha256Total = createHashCrypto("sha256").update(bufferSplit.buffer);

  //await pipeline(
  //    fs.createReadStream('archive.tar'),
  //    createHashCrc("crc32"),
  //    fs.createWriteStream('archive.tar.gz'),
  //);

  const total: Checksums = {
    crc32: crc32Total.copy().digest("hex"),
    md5: md5Total.copy().digest("hex"),
    sha1: sha1Total.copy().digest("hex"),
    sha256: sha256Total.copy().digest("hex"),
  }

  // single part upload
  if (bufferSplit.isSinglePart) {
    return {
      total: total,
      aws: {
        crc32: crc32Total.copy().digest("base64"),
        md5: md5Total.copy().digest("hex"),
        sha1: sha1Total.copy().digest("base64"),
        sha256: sha256Total.copy().digest("base64"),
      },
    }
  }

  // not actually a multipart - return the single hash
  // (ALSO handles if buffer is empty - we return an empty hash)
  /*if (partDetails.partCount <= 0) {
    return {
      total: total,
      single: {
        md5: md5Total.copy().digest("hex"),
        crc32: crc32Total.copy().digest("hex"),
        sha1: sha1Total.copy().digest("hex"),
        sha256: sha256Total.copy().digest("hex"),
      },
      multipart: {
        etag: md5Total.copy().digest("hex"),
        crc32: crc32Total.copy().digest("base64"),
        sha1: sha1Total.copy().digest("base64"),
        sha256: sha256Total.copy().digest("base64"),
      },
    };
  } */

  const etagHashes = [];
  const crc32Hashes = [];
  const sha1Hashes = [];
  const sha256Hashes = [];

  // note we are indexing our parts from 1 just because that is the way the
  // AWS multipart upload will also refer to them
  for (let part = 1; part <= bufferSplit.partCount; part++) {
    const partStart = (part - 1) * bufferSplit.partSize;
    const partActualSize =
      part === bufferSplit.partCount
        ? bufferSplit.partLast
        : bufferSplit.partSize;
    const partBuffer = bufferSplit.buffer.subarray(partStart, partStart + partActualSize);

    etagHashes.push(createHashCrypto("md5").update(partBuffer));
    crc32Hashes.push(createHashCrc("crc32").update(partBuffer));
    sha1Hashes.push(createHashCrypto("sha1").update(partBuffer));
    sha256Hashes.push(createHashCrypto("sha256").update(partBuffer));
  }

  const calcMulti = (hashes: Hash[], h: Hash, format: BinaryToTextEncoding) => {
    const combinedHashes = Buffer.concat(hashes.map((hash) => hash.digest()));
    return `${h.update(combinedHashes).digest(format)}-${hashes.length}`;
  };

  return {
    total: total,
    aws: {
      crc32: calcMulti(crc32Hashes, createHashCrc("crc32"), "base64"),
      md5: calcMulti(etagHashes, createHashCrypto("md5"), "hex"),
      sha1: calcMulti(sha1Hashes, createHashCrypto("sha1"), "base64"),
      sha256: calcMulti(sha256Hashes, createHashCrypto("sha256"), "base64"),
    },
  };
}

/*
(async () => {
  // STILL DEFINING WHAT THE CORRECT RESULTS HERE ARE SO THIS IS NOT REALLY
  // A TEST SUITE AT ALL
  const emptyBuffer = Buffer.alloc(0);
  const somethingBuffer = Buffer.alloc(1024, 1);

  const x = calcMultipleHashes(emptyBuffer, 64);

  console.assert(x.single.md5 === "d41d8cd98f00b204e9800998ecf8427e");
  console.assert(x.single.crc32 === "0000000");
  // when uploaded = AAAAAA==
  // sha1 = 2jmj7l5rSw0yVb/vlWAYkK/YBwk=
  // sha256 = 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=

  console.log(x);
  const y = calcMultipleHashes(somethingBuffer, 128);
  console.log(y);
})(); */
