/*
 * crc-hash
 * https://github.com/DavidAnson/crc-hash
 *
 * Copyright (c) 2014 David Anson
 * Licensed under the MIT license.
 */

"use strict";

// Imports
import { Hash } from "node:crypto";

import crc from "crc";
import { Transform } from "node:stream";
import stream from "node:stream";
import { BinaryLike, BinaryToTextEncoding, Encoding } from "crypto";

class CrcHash extends Transform {
  implementation: any;
  resultSize: number;
  value: any;

  // Constructor
  constructor(implementation: any, resultSize: number) {
    super();
    this.implementation = implementation;
    this.resultSize = resultSize;
    this.value = undefined;
  }

  private getResultBuffer() {
    var buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(this.value || 0, 0);
    buffer = buffer.slice(4 - this.resultSize);
    return buffer;
  }

  private getErrorFunction(message: string) {
    return function () {
      throw new Error(message);
    };
  }

  _transform(chunk: any, encoding: any, callback: any) {
    this.value = this.implementation(chunk, this.value);
    callback();
  }

  _flush(callback: any) {
    var buffer = this.getResultBuffer();
    this.push(buffer);
    callback();
  }

  copy(options?: stream.TransformOptions): Hash {
    const n = new CrcHash(this.implementation, this.resultSize);
    n.value = this.value;
    return n as Hash;
  }

  update(data: string | BinaryLike, encoding?: Encoding): Hash {
    // Validate data parameter
    if (typeof data !== "string" && !(data instanceof Buffer)) {
      throw new Error("Not a string or buffer");
    }
    if (!(data instanceof Buffer)) {
      // Normalize encoding parameter
      if (
        encoding !== "utf8" &&
        encoding !== "ascii" &&
        encoding !== "binary"
      ) {
        encoding = "binary";
      }
      // Create Buffer for data
      data = Buffer.from(data, encoding);
    }
    // Update hash and return
    this.value = this.implementation(data, this.value);
    return this as Hash;
  }

  digest(encoding?: BinaryToTextEncoding) {
    // TODO: hash object can not be used after digest method has been called
    //this.update = this.getErrorFunction("HashUpdate fail");
    //this.digest = this.getErrorFunction("Not initialized");

    // Unsupported encoding returns a Buffer
    if (encoding !== "hex" && encoding !== "binary" && encoding !== "base64") {
      encoding = undefined;
    }
    // Return Buffer or encoded string
    var buffer = this.getResultBuffer();
    return encoding ? buffer.toString(encoding) : buffer;
  }
}

/**
 * Creates and returns a hash object which can be used to generate CRC hash digests.
 *
 * @param {string} algorithm CRC algorithm (supported values: crc32, crc24, crc16, crc16ccitt, crc16modbus, crc8, crc81wire, crc1).
 * @return {Crypto.Hash} Duplex stream as with Crypto.Hash (including legacy update/digest methods).
 */
export const createHash = function (algorithm: string): Hash {
  if (!algorithm) {
    throw new Error("Missing algorithm.");
  }
  var size;
  switch (algorithm) {
    case "crc1":
    case "crc8":
    case "crc81wire":
      size = 1;
      break;
    case "crc16":
    case "crc16ccitt":
    case "crc16modbus":
      size = 2;
      break;
    case "crc24":
      size = 3;
      break;
    case "crc32":
      size = 4;
      break;
    default:
      throw new Error("Unsupported algorithm.");
  }
  return new CrcHash(crc[algorithm], size) as Hash;
};
